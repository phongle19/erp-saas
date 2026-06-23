/**
 * Goods Issue service — Phase 2b Task B6.
 *
 * Posts a goods issue (xuất kho) that debits COGS account 632 and credits
 * the material's inventory account (156 / 152). Cost-out is computed by the
 * weighted-average (moving-average) inventory engine (InventoryService.applyIssue).
 *
 * Accounting basis: VAS 02 / Circular 133/2016/TT-BTC, Article 12 — perpetual
 * moving-average cost method; COGS account 632 per Circular 133, Chart of Accounts.
 *
 * Sequence (all in the ONE request tenant tx — atomic):
 *   1. Validate access (403) + period open/ownership (422).
 *   2. Per line: resolve material, call applyIssue → costOut (inserts movement).
 *      applyIssue throws 422 on over-issue → tx rolls back, nothing persists.
 *   3. Post the journal entry Dr 632 / Cr inventory (grouped by account) via
 *      DocumentPostingService.
 *   4. Insert goods_issues + goods_issue_lines rows.
 *   5. Back-fill journalEntryId on the movement rows (UPDATE WHERE sourceDocId IS
 *      the goods_issue id we just inserted) — movements were inserted in step 2
 *      with a placeholder; now we link them.
 *
 * Cancel (reverse):
 *   - Reverse the journal entry (Cr 632 / Dr inventory).
 *   - Per line call applyReceipt (adds stock back at the ORIGINAL issued cost,
 *     which mirrors the COGS exactly) — sourceDocType 'goods_issue_cancel'.
 *   - Mark status 'cancelled'.
 */

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
import { InventoryService } from '../inventory/inventory.service.js';

// COGS — Giá vốn hàng bán — Circular 133/2016/TT-BTC, Chart of Accounts, Account 632.
const DEFAULT_COGS_ACCOUNT = '632';

export interface GoodsIssueLineInput {
  materialId: string;
  /** Whole-unit integer string. */
  quantity: string;
}

export interface CreateGoodsIssueInput {
  issueDate: string; // ISO 'YYYY-MM-DD'
  periodId: string;
  reason?: 'sale' | 'consumption' | 'adjustment' | undefined;
  description?: string | undefined;
  lines: GoodsIssueLineInput[];
}

type Issue = typeof schema.goodsIssues.$inferSelect;
type IssueLine = typeof schema.goodsIssueLines.$inferSelect;

export interface GoodsIssueWithLines extends Issue {
  lines: IssueLine[];
}

@Injectable()
export class GoodsIssueService {
  constructor(
    private readonly posting: DocumentPostingService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Create AND post a goods issue in one request transaction.
   *
   * Weighted-average cost-out is computed by InventoryService.applyIssue (which
   * also inserts the movement row). The journal entry and the goods_issue rows
   * are inserted in the same tx, so the whole thing is atomic.
   */
  async createAndPost(
    companyId: string,
    input: CreateGoodsIssueInput,
  ): Promise<GoodsIssueWithLines> {
    const tx = currentTx();
    const { db } = tx;

    // 1. App-layer access gate.
    if (!tx.isAdmin && !tx.accessibleCompanies.includes(companyId)) {
      throw new ForbiddenException('access to company denied');
    }

    // Period must be open AND belong to companyId; read fiscalYear.
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

    if (input.lines.length === 0) {
      throw new UnprocessableEntityException(
        'goods issue must have at least one line',
      );
    }

    // 2. Per-line: resolve material → inventoryAccountCode; call applyIssue to get
    //    costOut and insert the movement. applyIssue throws 422 on insufficient stock;
    //    the tx auto-rolls-back so nothing persists.
    //
    //    We use a sentinel sourceDocId (nil UUID) for the movement at this point
    //    because the goods_issue row doesn't exist yet. After inserting the issue
    //    we UPDATE the movements to set the real sourceDocId and journalEntryId.
    const SENTINEL_DOC_ID = '00000000-0000-0000-0000-000000000000';

    interface ComputedLine {
      lineNo: number;
      materialId: string;
      quantity: bigint;
      costMinor: bigint; // weighted-average cost-out
      inventoryAccountCode: string;
      cogsAccountCode: string;
    }

    const computed: ComputedLine[] = [];
    let lineNo = 0;

    for (const line of input.lines) {
      lineNo += 1;

      // Resolve the material: must belong to THIS company (defense in depth + RLS).
      const matRows = await db
        .select({
          inventoryAccountCode: schema.materials.inventoryAccountCode,
        })
        .from(schema.materials)
        .where(
          and(
            eq(schema.materials.id, line.materialId),
            eq(schema.materials.companyId, companyId),
          ),
        )
        .limit(1);
      if (!matRows[0]) {
        throw new UnprocessableEntityException(
          'material not found for this company',
        );
      }
      const inventoryAccountCode = matRows[0].inventoryAccountCode;

      // Call applyIssue: computes weighted-avg costOut AND inserts the movement row.
      // journalEntryId is unknown here — we patch it after posting.
      // sourceDocId is a sentinel — we patch it after inserting the goods_issue row.
      const { costOut } = await this.inventory.applyIssue({
        materialId: line.materialId,
        quantity: BigInt(line.quantity),
        sourceDocType: 'goods_issue',
        sourceDocId: SENTINEL_DOC_ID,
        journalEntryId: SENTINEL_DOC_ID, // patched below
        periodId: input.periodId,
        movementDate: input.issueDate,
        companyId,
      });

      computed.push({
        lineNo,
        materialId: line.materialId,
        quantity: BigInt(line.quantity),
        costMinor: costOut,
        inventoryAccountCode,
        cogsAccountCode: DEFAULT_COGS_ACCOUNT,
      });
    }

    // 3. Total COGS = Σ costOut.
    const totalCostMinor = computed.reduce((s, l) => s + l.costMinor, 0n);

    // 4. Build the journal: Dr 632 (total COGS); Cr inventory account(s) grouped.
    //    This is balanced: Σ Dr 632 = Σ Cr inventory = totalCostMinor.
    //    COGS — Giá vốn hàng bán: Circular 133/2016/TT-BTC, Account 632.
    const inventoryByAccount = new Map<string, bigint>();
    for (const l of computed) {
      inventoryByAccount.set(
        l.inventoryAccountCode,
        (inventoryByAccount.get(l.inventoryAccountCode) ?? 0n) + l.costMinor,
      );
    }

    const journalLines: {
      accountCode: string;
      debitMinor: string;
      creditMinor: string;
    }[] = [];

    // Dr 632 (COGS) — total.
    journalLines.push({
      accountCode: DEFAULT_COGS_ACCOUNT,
      debitMinor: totalCostMinor.toString(),
      creditMinor: '0',
    });

    // Cr inventory (grouped by inventoryAccountCode).
    for (const [code, cost] of inventoryByAccount) {
      journalLines.push({
        accountCode: code,
        debitMinor: '0',
        creditMinor: cost.toString(),
      });
    }

    const description =
      input.description ?? `Xuất kho ${input.issueDate}`;

    const { journalEntryId } = await this.posting.postDocument({
      companyId,
      periodId: input.periodId,
      entryDate: input.issueDate,
      description,
      lines: journalLines,
    });

    // 5. Persist goods_issues: issueNo = MAX+1 per (companyId, fiscalYear).
    const maxRows = await db
      .select({
        maxNo: sql<number>`COALESCE(MAX(${schema.goodsIssues.issueNo}), 0)`,
      })
      .from(schema.goodsIssues)
      .where(
        and(
          eq(schema.goodsIssues.companyId, companyId),
          eq(schema.goodsIssues.fiscalYear, fiscalYear),
        ),
      );
    const issueNo = Number(maxRows[0]?.maxNo ?? 0) + 1;

    const [issue] = await db
      .insert(schema.goodsIssues)
      .values({
        companyId,
        issueNo,
        issueDate: input.issueDate,
        periodId: input.periodId,
        fiscalYear,
        reason: input.reason ?? 'sale',
        description: input.description ?? null,
        status: 'posted',
        journalEntryId,
        totalCostMinor,
        createdBy: tx.userId,
        postedAt: new Date(),
      })
      .returning();

    // Persist goods_issue_lines.
    const lineValues = computed.map((l) => ({
      issueId: issue!.id,
      companyId,
      lineNo: l.lineNo,
      materialId: l.materialId,
      quantity: l.quantity,
      costMinor: l.costMinor,
      cogsAccountCode: l.cogsAccountCode,
    }));
    const lines = await db
      .insert(schema.goodsIssueLines)
      .values(lineValues)
      .returning();

    // 6. Back-fill sourceDocId and journalEntryId on the movement rows that were
    //    inserted with the sentinel. We match by (companyId, sourceDocType,
    //    sourceDocId sentinel, movementDate) — which is safe because no other
    //    goods_issue in this tx can have the same sentinel.
    await db
      .update(schema.inventoryMovements)
      .set({
        sourceDocId: issue!.id,
        journalEntryId,
      })
      .where(
        and(
          eq(schema.inventoryMovements.companyId, companyId),
          eq(schema.inventoryMovements.sourceDocType, 'goods_issue'),
          eq(schema.inventoryMovements.sourceDocId, SENTINEL_DOC_ID),
        ),
      );

    return { ...issue!, lines };
  }

  /** RLS-scoped goods issue + lines, or 404 if not found / hidden. */
  async get(issueId: string): Promise<GoodsIssueWithLines> {
    const { db } = currentTx();

    const rows = await db
      .select()
      .from(schema.goodsIssues)
      .where(eq(schema.goodsIssues.id, issueId))
      .limit(1);
    const issue = rows[0];
    if (!issue) throw new NotFoundException('goods issue not found');

    const lines = await db
      .select()
      .from(schema.goodsIssueLines)
      .where(eq(schema.goodsIssueLines.issueId, issueId))
      .orderBy(schema.goodsIssueLines.lineNo);

    return { ...issue, lines };
  }

  /**
   * Cancel a posted goods issue:
   *   - Reverse the journal entry (Cr 632 / Dr inventory).
   *   - Per line, add stock back at the ORIGINAL issued cost via applyReceipt
   *     (sourceDocType 'goods_issue_cancel'). This mirrors the issued COGS exactly.
   *   - Mark status 'cancelled'.
   *
   * All in the one request tx (atomic).
   */
  async cancel(issueId: string): Promise<GoodsIssueWithLines> {
    const { db } = currentTx();
    const current = await this.get(issueId);

    if (current.status !== 'posted') {
      throw new UnprocessableEntityException(
        `only posted goods issues can be cancelled (status: ${current.status})`,
      );
    }
    if (!current.journalEntryId) {
      throw new UnprocessableEntityException(
        'goods issue has no journal entry to reverse',
      );
    }

    const { reversalEntryId } = await this.posting.reverseDocument(
      current.journalEntryId,
    );

    // Add stock back per line at the original issued cost.
    // VAS 02 / Circular 133/2016/TT-BTC, Article 12 — cancel restores
    // the exact qty and value that were removed.
    for (const l of current.lines) {
      await this.inventory.applyReceipt({
        materialId: l.materialId,
        quantity: l.quantity,
        cost: l.costMinor,
        sourceDocType: 'goods_issue_cancel',
        sourceDocId: current.id,
        journalEntryId: reversalEntryId,
        periodId: current.periodId,
        movementDate: current.issueDate,
        companyId: current.companyId,
      });
    }

    await db
      .update(schema.goodsIssues)
      .set({ status: 'cancelled' })
      .where(eq(schema.goodsIssues.id, issueId));

    return this.get(issueId);
  }
}
