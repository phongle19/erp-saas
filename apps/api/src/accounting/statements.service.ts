import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@erp/db';
import {
  getStatementTemplates,
  type StatementLine,
  type StatementTemplate,
} from '@erp/config-regimes';
import { currentTx } from '../db/tx-context.js';
import { LedgerService } from './ledger.service.js';

export interface StatementLineOut {
  code: string;
  label_vi: string;
  level: number;
  /** bigint as string */
  amount: string;
}

export interface StatementOut {
  id: StatementTemplate['id'];
  title_vi: string;
  lines: StatementLineOut[];
}

/**
 * Circular 133 financial-statement engine (B01-DNN Balance Sheet, B02-DNN
 * Income Statement). Read-only, deterministic, bigint-exact.
 *
 * Evaluation model:
 *  - Leaf line (`accounts`): sum the per-account net (debit − credit) over
 *    accounts whose code starts with any prefix, then present on the line's
 *    nature: 'debit' → Σ(net); 'credit' → Σ(−net) = Σ(credit − debit). So a
 *    credit-side line (liabilities, revenue, accumulated depreciation) shows
 *    its natural balance as a positive number.
 *  - Subtotal line (`subtotalOf`): sum referenced children. A child ref ending
 *    in `_neg` is subtracted (strip `_neg`, negate); others are added. Children
 *    may themselves be subtotals — evaluated with memoized recursion and a
 *    cycle guard.
 */
@Injectable()
export class StatementsService {
  constructor(private readonly ledger: LedgerService) {}

  async statement(
    companyId: string,
    fiscalYear: number,
    throughPeriodNo: number,
    templateId: StatementTemplate['id'],
  ): Promise<StatementOut> {
    const { db } = currentTx();

    // 1. Read the company's regime (RLS-scoped) and load its templates.
    const companies = await db
      .select({ regime: schema.companies.regime })
      .from(schema.companies)
      .where(eq(schema.companies.id, companyId))
      .limit(1);
    if (!companies[0]) throw new NotFoundException('company not found');
    const { regime } = companies[0];

    const template = getStatementTemplates(regime).find((t) => t.id === templateId);
    if (!template) {
      throw new NotFoundException('statement not available for this regime');
    }

    // 2. Account balances via the trial balance → map code → net (debit − credit).
    const tb = await this.ledger.trialBalance(companyId, fiscalYear, throughPeriodNo);
    const netByCode = new Map<string, bigint>();
    for (const row of tb.rows) {
      netByCode.set(row.code, BigInt(row.balance)); // balance is debit − credit
    }

    // 3. Evaluate every line into a code → amount(bigint) map.
    const lineByCode = new Map<string, StatementLine>();
    for (const line of template.lines) lineByCode.set(line.code, line);

    const cache = new Map<string, bigint>();
    const inProgress = new Set<string>();

    const leafAmount = (line: StatementLine): bigint => {
      const { prefixes, nature } = line.accounts!;
      let sum = 0n;
      for (const [code, net] of netByCode) {
        if (prefixes.some((p) => code.startsWith(p))) {
          // nature='debit' → +net (debit-positive); 'credit' → −net (credit-positive)
          sum += nature === 'debit' ? net : -net;
        }
      }
      return sum;
    };

    const evaluate = (code: string): bigint => {
      const cached = cache.get(code);
      if (cached !== undefined) return cached;

      const line = lineByCode.get(code);
      if (!line) {
        throw new Error(`statement template ${templateId}: line '${code}' referenced but not defined`);
      }

      if (inProgress.has(code)) {
        throw new Error(`statement template ${templateId}: cycle detected at line '${code}'`);
      }
      inProgress.add(code);

      let value: bigint;
      if (line.accounts) {
        value = leafAmount(line);
      } else if (line.subtotalOf) {
        value = 0n;
        for (const ref of line.subtotalOf) {
          const neg = ref.endsWith('_neg');
          const childCode = neg ? ref.slice(0, -'_neg'.length) : ref;
          const childValue = evaluate(childCode);
          value += neg ? -childValue : childValue;
        }
      } else {
        // Neither accounts nor subtotalOf — a structural/empty line is 0.
        value = 0n;
      }

      inProgress.delete(code);
      cache.set(code, value);
      return value;
    };

    // 4. Build output preserving template line order.
    const lines: StatementLineOut[] = template.lines.map((line) => ({
      code: line.code,
      label_vi: line.label_vi,
      level: line.level,
      amount: evaluate(line.code).toString(),
    }));

    return { id: template.id, title_vi: template.title_vi, lines };
  }
}
