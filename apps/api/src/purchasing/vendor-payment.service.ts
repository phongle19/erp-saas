import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { schema } from '@erp/db';
import { currentTx } from '../db/tx-context.js';
import { DocumentPostingService } from '../documents/document-posting.js';

/** AP control account (Phải trả người bán) — Circular 133. */
const AP_ACCOUNT = '331';

export interface CreateVendorPaymentInput {
  partnerId: string;
  paymentDate: string; // ISO 'YYYY-MM-DD'
  periodId: string;
  /** Integer string > 0 (minor units). */
  amountMinor: string;
  /** '111' (cash) or '112' (bank) — Circular 133. */
  settlementAccountCode: '111' | '112';
  description?: string | undefined;
}

type VendorPayment = typeof schema.vendorPayments.$inferSelect;

@Injectable()
export class VendorPaymentService {
  constructor(private readonly posting: DocumentPostingService) {}

  /**
   * Create AND post a vendor payment in one request transaction (Phase 2b B8).
   *
   * Posts Dr 331 AP (with partnerId) / Cr settlementAccountCode so the vendor's
   * AP sub-ledger balance decreases by amountMinor.
   *
   * The whole operation runs in the request tenant tx: if posting fails the
   * payment row rolls back too.
   */
  async createAndPost(
    companyId: string,
    input: CreateVendorPaymentInput,
  ): Promise<VendorPayment> {
    const tx = currentTx();
    const { db } = tx;

    // 1. App-layer access gate (mirrors RLS / the engine; fail fast with 403).
    if (!tx.isAdmin && !tx.accessibleCompanies.includes(companyId)) {
      throw new ForbiddenException('access to company denied');
    }

    // 2. Verify period is open AND belongs to companyId; read fiscalYear.
    const periodRows = await db
      .select({
        companyId: schema.accountingPeriods.companyId,
        fiscalYear: schema.accountingPeriods.fiscalYear,
        status: schema.accountingPeriods.status,
      })
      .from(schema.accountingPeriods)
      .where(eq(schema.accountingPeriods.id, input.periodId))
      .limit(1);
    const period = periodRows[0];
    if (!period || period.companyId !== companyId) {
      throw new UnprocessableEntityException(
        'period does not belong to company',
      );
    }
    if (period.status !== 'open') {
      throw new UnprocessableEntityException(
        `period is not open (status: ${period.status})`,
      );
    }
    const fiscalYear = period.fiscalYear;

    // 3. Verify the vendor partner belongs to companyId (RLS-scoped; 422 if not).
    const partnerRows = await db
      .select({ id: schema.businessPartners.id })
      .from(schema.businessPartners)
      .where(
        and(
          eq(schema.businessPartners.id, input.partnerId),
          eq(schema.businessPartners.companyId, companyId),
        ),
      )
      .limit(1);
    if (!partnerRows[0]) {
      throw new UnprocessableEntityException(
        'vendor not found for this company',
      );
    }

    const amount = BigInt(input.amountMinor);

    // 4. Post via DocumentPostingService:
    //    Dr 331 AP (with partnerId) / Cr settlementAccountCode (111 cash or 112 bank)
    //    entryDate = paymentDate.
    const description =
      input.description ?? `Phiếu chi ${input.paymentDate}`;

    const { journalEntryId } = await this.posting.postDocument({
      companyId,
      periodId: input.periodId,
      entryDate: input.paymentDate,
      description,
      lines: [
        {
          accountCode: AP_ACCOUNT,
          debitMinor: amount.toString(),
          creditMinor: '0',
          partnerId: input.partnerId,
        },
        {
          accountCode: input.settlementAccountCode,
          debitMinor: '0',
          creditMinor: amount.toString(),
        },
      ],
    });

    // 5. Assign paymentNo = MAX+1 per (companyId, fiscalYear) and insert the row.
    const maxRows = await db
      .select({
        maxNo: sql<number>`COALESCE(MAX(${schema.vendorPayments.paymentNo}), 0)`,
      })
      .from(schema.vendorPayments)
      .where(
        and(
          eq(schema.vendorPayments.companyId, companyId),
          eq(schema.vendorPayments.fiscalYear, fiscalYear),
        ),
      );
    const paymentNo = Number(maxRows[0]?.maxNo ?? 0) + 1;

    const [payment] = await db
      .insert(schema.vendorPayments)
      .values({
        companyId,
        partnerId: input.partnerId,
        paymentNo,
        paymentDate: input.paymentDate,
        periodId: input.periodId,
        fiscalYear,
        amountMinor: amount,
        settlementAccountCode: input.settlementAccountCode,
        description: input.description ?? null,
        status: 'posted',
        journalEntryId,
        createdBy: tx.userId,
        postedAt: new Date(),
      })
      .returning();

    return payment!;
  }

  /** RLS-scoped vendor payment lookup, or 404 if not found / hidden. */
  async get(paymentId: string): Promise<VendorPayment> {
    const { db } = currentTx();
    const rows = await db
      .select()
      .from(schema.vendorPayments)
      .where(eq(schema.vendorPayments.id, paymentId))
      .limit(1);
    const payment = rows[0];
    if (!payment) throw new NotFoundException('vendor payment not found');
    return payment;
  }

  /**
   * Cancel a posted vendor payment: reverse its journal entry (the reversal
   * carries partnerId, so the vendor's AP nets back up) and mark it cancelled.
   */
  async cancel(paymentId: string): Promise<VendorPayment> {
    const { db } = currentTx();
    const current = await this.get(paymentId);

    if (current.status !== 'posted') {
      throw new UnprocessableEntityException(
        `only posted payments can be cancelled (status: ${current.status})`,
      );
    }
    if (!current.journalEntryId) {
      throw new UnprocessableEntityException(
        'payment has no journal entry to reverse',
      );
    }

    await this.posting.reverseDocument(current.journalEntryId);

    await db
      .update(schema.vendorPayments)
      .set({ status: 'cancelled' })
      .where(eq(schema.vendorPayments.id, paymentId));

    return this.get(paymentId);
  }
}
