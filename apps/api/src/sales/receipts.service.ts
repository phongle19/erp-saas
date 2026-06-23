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

/** AR control account (Phải thu khách hàng) — Circular 133. */
const AR_ACCOUNT = '131';

export interface CreateReceiptInput {
  partnerId: string;
  receiptDate: string; // ISO 'YYYY-MM-DD'
  periodId: string;
  /** Integer string > 0 (minor units). */
  amountMinor: string;
  /** '111' (cash) or '112' (bank) — Circular 133. */
  settlementAccountCode: '111' | '112';
  description?: string | undefined;
}

type Receipt = typeof schema.customerReceipts.$inferSelect;

@Injectable()
export class ReceiptsService {
  constructor(private readonly posting: DocumentPostingService) {}

  /**
   * Create AND post a customer receipt in one request transaction (Phase 2a A6).
   *
   * Posts Dr settlementAccountCode / Cr 131 (with partnerId) so the customer's
   * AR sub-ledger balance decreases by amountMinor.
   *
   * The whole operation runs in the request tenant tx: if posting fails the
   * receipt row rolls back too.
   */
  async createAndPost(
    companyId: string,
    input: CreateReceiptInput,
  ): Promise<Receipt> {
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

    // 3. Verify the partner belongs to companyId (RLS-scoped; 422 if not).
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
        'customer not found for this company',
      );
    }

    const amount = BigInt(input.amountMinor);

    // 4. Post via DocumentPostingService:
    //    Dr settlementAccountCode (111 cash or 112 bank) / Cr 131 AR (with partnerId)
    //    entryDate = receiptDate.
    const description =
      input.description ?? `Phiếu thu ${input.receiptDate}`;

    const { journalEntryId } = await this.posting.postDocument({
      companyId,
      periodId: input.periodId,
      entryDate: input.receiptDate,
      description,
      lines: [
        {
          accountCode: input.settlementAccountCode,
          debitMinor: amount.toString(),
          creditMinor: '0',
        },
        {
          accountCode: AR_ACCOUNT,
          debitMinor: '0',
          creditMinor: amount.toString(),
          partnerId: input.partnerId,
        },
      ],
    });

    // 5. Assign receiptNo = MAX+1 per (companyId, fiscalYear) and insert the row.
    const maxRows = await db
      .select({
        maxNo: sql<number>`COALESCE(MAX(${schema.customerReceipts.receiptNo}), 0)`,
      })
      .from(schema.customerReceipts)
      .where(
        and(
          eq(schema.customerReceipts.companyId, companyId),
          eq(schema.customerReceipts.fiscalYear, fiscalYear),
        ),
      );
    const receiptNo = Number(maxRows[0]?.maxNo ?? 0) + 1;

    const [receipt] = await db
      .insert(schema.customerReceipts)
      .values({
        companyId,
        partnerId: input.partnerId,
        receiptNo,
        receiptDate: input.receiptDate,
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

    return receipt!;
  }

  /** RLS-scoped receipt lookup, or 404 if not found / hidden. */
  async get(receiptId: string): Promise<Receipt> {
    const { db } = currentTx();
    const rows = await db
      .select()
      .from(schema.customerReceipts)
      .where(eq(schema.customerReceipts.id, receiptId))
      .limit(1);
    const receipt = rows[0];
    if (!receipt) throw new NotFoundException('customer receipt not found');
    return receipt;
  }

  /**
   * Cancel a posted receipt: reverse its journal entry (the reversal carries
   * partnerId, so the customer's AR nets back up) and mark it cancelled.
   */
  async cancel(receiptId: string): Promise<Receipt> {
    const { db } = currentTx();
    const current = await this.get(receiptId);

    if (current.status !== 'posted') {
      throw new UnprocessableEntityException(
        `only posted receipts can be cancelled (status: ${current.status})`,
      );
    }
    if (!current.journalEntryId) {
      throw new UnprocessableEntityException(
        'receipt has no journal entry to reverse',
      );
    }

    await this.posting.reverseDocument(current.journalEntryId);

    await db
      .update(schema.customerReceipts)
      .set({ status: 'cancelled' })
      .where(eq(schema.customerReceipts.id, receiptId));

    return this.get(receiptId);
  }
}
