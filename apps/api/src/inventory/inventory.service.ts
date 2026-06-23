/**
 * Weighted-average (moving-average) inventory valuation engine — Phase 2b Task B3.
 *
 * Accounting basis: VAS 02 / Circular 133/2016/TT-BTC, Article 12 — perpetual
 * moving-average cost method for inventory valuation.
 *
 * Concurrency note:
 *   The latest-movement read + insert is not atomic against concurrent movements
 *   for the SAME material under high concurrency. For Phase 2b (single-tenant,
 *   low-volume) this is acceptable. For a high-concurrency deployment, add a
 *   per-(company,material) advisory lock at the start of applyReceipt/applyIssue:
 *
 *     await tx.db.execute(sql`
 *       SELECT pg_advisory_xact_lock(
 *         hashtextextended(${companyId} || ':' || ${materialId}, 0)
 *       )
 *     `);
 *
 *   This serialises concurrent movements for the same material within the
 *   transaction and is released automatically at commit/rollback — no explicit
 *   unlock needed. The advisory lock is added here (see below) as it is cheap
 *   and future-proofs the engine.
 */

import { Injectable, UnprocessableEntityException, ForbiddenException } from '@nestjs/common';
import { desc, eq, and, sql } from 'drizzle-orm';
import { schema } from '@erp/db';
import { receiptBalance, issueCost } from '@erp/domain';
import { currentTx } from '../db/tx-context.js';

export interface ApplyReceiptInput {
  materialId: string;
  quantity: bigint;
  /** Total cost of the receipt in minor units (bigint, integer-exact). */
  cost: bigint;
  sourceDocType: string;
  sourceDocId: string;
  journalEntryId: string;
  periodId: string;
  movementDate: string;
  companyId: string;
}

export interface ApplyIssueInput {
  materialId: string;
  quantity: bigint;
  sourceDocType: string;
  sourceDocId: string;
  journalEntryId: string;
  periodId: string;
  movementDate: string;
  companyId: string;
}

export interface InventoryBalance {
  balanceQty: bigint;
  balanceValue: bigint;
}

export interface IssueBalance extends InventoryBalance {
  costOut: bigint;
}

export interface OnHandResult {
  qty: bigint;
  value: bigint;
  avgUnitCost: bigint;
}

export interface ValuationRow {
  materialId: string;
  code: string;
  name: string;
  qty: string;
  value: string;
  avgUnitCost: string;
}

export interface ValuationReport {
  rows: ValuationRow[];
  totalValue: string;
}

@Injectable()
export class InventoryService {
  /**
   * Load the current on-hand balance for a material (the latest movement row).
   * Returns {0n, 0n} if no movements exist yet.
   *
   * Called within an existing tenant tx (currentTx().db is the RLS-scoped handle).
   */
  private async latestBalance(
    companyId: string,
    materialId: string,
  ): Promise<{ qty: bigint; value: bigint }> {
    const tx = currentTx();
    const rows = await tx.db
      .select({
        balanceQtyAfter: schema.inventoryMovements.balanceQtyAfter,
        balanceValueAfter: schema.inventoryMovements.balanceValueAfter,
      })
      .from(schema.inventoryMovements)
      .where(
        and(
          eq(schema.inventoryMovements.companyId, companyId),
          eq(schema.inventoryMovements.materialId, materialId),
        ),
      )
      .orderBy(
        desc(schema.inventoryMovements.createdAt),
        desc(schema.inventoryMovements.id),
      )
      .limit(1);

    if (!rows[0]) return { qty: 0n, value: 0n };
    return {
      qty: rows[0].balanceQtyAfter,
      value: rows[0].balanceValueAfter,
    };
  }

  /**
   * Acquire a per-(company,material) advisory lock for the duration of the
   * current transaction. This serialises concurrent movements for the same
   * material. The lock is released automatically at commit/rollback.
   *
   * Uses pg_advisory_xact_lock (integer variant via hashtextextended) so no
   * explicit unlock is needed and the lock is transaction-scoped.
   */
  private async acquireMaterialLock(companyId: string, materialId: string): Promise<void> {
    const tx = currentTx();
    // Lock key: hash of "<companyId>:<materialId>" — 64-bit integer, unique per pair.
    await tx.db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${companyId || ''} || ':' || ${materialId || ''}, 0))`,
    );
  }

  /**
   * Apply a goods receipt: add `quantity` units at total cost `cost`.
   *
   * Must be called inside an existing tenant tx (e.g., from the purchase-invoice
   * service, B5). The movement + journal entry commit atomically with the caller's tx.
   *
   * VAS 02 / Circular 133/2016/TT-BTC, Article 12 — receipt increases
   * both qty and value; new weighted-average cost is value / qty.
   */
  async applyReceipt(input: ApplyReceiptInput): Promise<InventoryBalance> {
    const tx = currentTx();

    if (!tx.isAdmin && !tx.accessibleCompanies.includes(input.companyId)) {
      throw new ForbiddenException('access to company denied');
    }

    // Serialise concurrent movements for the same material (advisory lock).
    await this.acquireMaterialLock(input.companyId, input.materialId);

    const prev = await this.latestBalance(input.companyId, input.materialId);
    const { qty, value } = receiptBalance(prev.qty, prev.value, input.quantity, input.cost);

    // unitCostMinor is derived/display-only; for q=0 guard is in receiptBalance.
    const unitCostMinor = qty > 0n ? value / qty : 0n;

    await tx.db.insert(schema.inventoryMovements).values({
      companyId: input.companyId,
      materialId: input.materialId,
      movementType: 'receipt',
      quantity: input.quantity,
      unitCostMinor,
      totalCostMinor: input.cost,
      balanceQtyAfter: qty,
      balanceValueAfter: value,
      sourceDocType: input.sourceDocType,
      sourceDocId: input.sourceDocId,
      journalEntryId: input.journalEntryId,
      movementDate: input.movementDate,
      periodId: input.periodId,
    });

    return { balanceQty: qty, balanceValue: value };
  }

  /**
   * Reverse a prior goods receipt by removing the ORIGINAL received quantity at
   * the ORIGINAL line cost (NOT the current weighted-average cost). Used when a
   * posted purchase invoice is cancelled (B5): the compensating movement restores
   * the exact qty and value the receipt added.
   *
   * Inserts an 'issue'-type movement with totalCostMinor = original lineCost and
   * balances = prev − qty / prev − lineCost.
   *
   * Caveat (Phase 2b, best-effort): exact value restoration assumes no intervening
   * movement consumed below the received quantity. If later issues drew the balance
   * down past this receipt, subtracting the original cost can over/undershoot the
   * moving-average value (and even drive the balance negative). For Phase 2b
   * (low-volume, cancel-soon-after-post) this is acceptable; a full restatement
   * engine is deferred.
   *
   * Must be called inside an existing tenant tx so the reversal movement commits
   * atomically with the journal reversal.
   */
  async applyReversal(input: ApplyReceiptInput): Promise<InventoryBalance> {
    const tx = currentTx();

    if (!tx.isAdmin && !tx.accessibleCompanies.includes(input.companyId)) {
      throw new ForbiddenException('access to company denied');
    }

    // Serialise concurrent movements for the same material (advisory lock).
    await this.acquireMaterialLock(input.companyId, input.materialId);

    const prev = await this.latestBalance(input.companyId, input.materialId);
    const qty = prev.qty - input.quantity;
    const value = prev.value - input.cost;
    const unitCostMinor = input.quantity > 0n ? input.cost / input.quantity : 0n;

    await tx.db.insert(schema.inventoryMovements).values({
      companyId: input.companyId,
      materialId: input.materialId,
      movementType: 'issue',
      quantity: input.quantity,
      unitCostMinor,
      totalCostMinor: input.cost,
      balanceQtyAfter: qty,
      balanceValueAfter: value,
      sourceDocType: input.sourceDocType,
      sourceDocId: input.sourceDocId,
      journalEntryId: input.journalEntryId,
      movementDate: input.movementDate,
      periodId: input.periodId,
    });

    return { balanceQty: qty, balanceValue: value };
  }

  /**
   * Apply a goods issue: remove `quantity` units at the current weighted-average cost.
   *
   * Throws UnprocessableEntityException (422) on over-issue.
   *
   * Must be called inside an existing tenant tx (e.g., from the goods-issue
   * service, B6). The movement + journal entry commit atomically.
   *
   * VAS 02 / Circular 133/2016/TT-BTC, Article 12 — moving-average COGS.
   */
  async applyIssue(input: ApplyIssueInput): Promise<IssueBalance> {
    const tx = currentTx();

    if (!tx.isAdmin && !tx.accessibleCompanies.includes(input.companyId)) {
      throw new ForbiddenException('access to company denied');
    }

    // Serialise concurrent movements for the same material (advisory lock).
    await this.acquireMaterialLock(input.companyId, input.materialId);

    const prev = await this.latestBalance(input.companyId, input.materialId);

    // Resolve the material code for a human-readable error message.
    let materialCode = input.materialId;
    try {
      const mRows = await tx.db
        .select({ code: schema.materials.code })
        .from(schema.materials)
        .where(eq(schema.materials.id, input.materialId))
        .limit(1);
      if (mRows[0]) materialCode = mRows[0].code;
    } catch {
      // Non-fatal: fall back to UUID in error message.
    }

    let issueResult: ReturnType<typeof issueCost>;
    try {
      issueResult = issueCost(prev.qty, prev.value, input.quantity);
    } catch {
      throw new UnprocessableEntityException(
        `insufficient stock for material ${materialCode}: on-hand ${prev.qty}, requested ${input.quantity}`,
      );
    }

    const { costOut, qty, value } = issueResult;
    const unitCostMinor = input.quantity > 0n ? costOut / input.quantity : 0n;

    await tx.db.insert(schema.inventoryMovements).values({
      companyId: input.companyId,
      materialId: input.materialId,
      movementType: 'issue',
      quantity: input.quantity,
      unitCostMinor,
      totalCostMinor: costOut,
      balanceQtyAfter: qty,
      balanceValueAfter: value,
      sourceDocType: input.sourceDocType,
      sourceDocId: input.sourceDocId,
      journalEntryId: input.journalEntryId,
      movementDate: input.movementDate,
      periodId: input.periodId,
    });

    return { costOut, balanceQty: qty, balanceValue: value };
  }

  /**
   * Return the current on-hand balance for a single material.
   * avgUnitCost = value / qty (0n when qty = 0 to avoid divide-by-zero).
   */
  async onHand(companyId: string, materialId: string): Promise<OnHandResult> {
    const tx = currentTx();
    if (!tx.isAdmin && !tx.accessibleCompanies.includes(companyId)) {
      throw new ForbiddenException('access to company denied');
    }

    const { qty, value } = await this.latestBalance(companyId, materialId);
    const avgUnitCost = qty > 0n ? value / qty : 0n;
    return { qty, value, avgUnitCost };
  }

  /**
   * Valuation report: for each material with at least one movement, its latest
   * on-hand balance and average unit cost. totalValue = Σ value (should reconcile
   * to the GL 156/152 balance — verified in B7 tests).
   *
   * bigint fields are serialised to strings in the controller layer via the
   * AuditInterceptor / JSON replacer.
   */
  async valuationReport(companyId: string): Promise<ValuationReport> {
    const tx = currentTx();
    if (!tx.isAdmin && !tx.accessibleCompanies.includes(companyId)) {
      throw new ForbiddenException('access to company denied');
    }

    // Fetch all materials for the company.
    const mats = await tx.db
      .select({
        id: schema.materials.id,
        code: schema.materials.code,
        name: schema.materials.name,
      })
      .from(schema.materials)
      .where(eq(schema.materials.companyId, companyId));

    // For each material, get the latest balance (only those with movements).
    const rows: ValuationRow[] = [];
    let totalValue = 0n;

    for (const mat of mats) {
      const { qty, value } = await this.latestBalance(companyId, mat.id);
      if (qty === 0n && value === 0n) {
        // Check if there are ANY movements — if none, skip.
        const anyMovement = await tx.db
          .select({ id: schema.inventoryMovements.id })
          .from(schema.inventoryMovements)
          .where(
            and(
              eq(schema.inventoryMovements.companyId, companyId),
              eq(schema.inventoryMovements.materialId, mat.id),
            ),
          )
          .limit(1);
        if (!anyMovement[0]) continue;
      }
      const avgUnitCost = qty > 0n ? value / qty : 0n;
      totalValue += value;
      rows.push({
        materialId: mat.id,
        code: mat.code,
        name: mat.name,
        qty: qty.toString(),
        value: value.toString(),
        avgUnitCost: avgUnitCost.toString(),
      });
    }

    return { rows, totalValue: totalValue.toString() };
  }

  /**
   * Movement ledger for a single material, ordered by createdAt / id ascending.
   */
  async movements(companyId: string, materialId: string) {
    const tx = currentTx();
    if (!tx.isAdmin && !tx.accessibleCompanies.includes(companyId)) {
      throw new ForbiddenException('access to company denied');
    }

    const rows = await tx.db
      .select()
      .from(schema.inventoryMovements)
      .where(
        and(
          eq(schema.inventoryMovements.companyId, companyId),
          eq(schema.inventoryMovements.materialId, materialId),
        ),
      )
      .orderBy(
        schema.inventoryMovements.createdAt,
        schema.inventoryMovements.id,
      );

    // Serialise bigint fields to strings.
    return rows.map((r) => ({
      ...r,
      quantity: r.quantity.toString(),
      unitCostMinor: r.unitCostMinor.toString(),
      totalCostMinor: r.totalCostMinor.toString(),
      balanceQtyAfter: r.balanceQtyAfter.toString(),
      balanceValueAfter: r.balanceValueAfter.toString(),
    }));
  }
}
