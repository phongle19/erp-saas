import { pgTable, uuid, integer, text, date, timestamp, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { periodType, periodStatus } from './enums.js';
import { companies } from './companies.js';

export const accountingPeriods = pgTable('accounting_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  fiscalYear: integer('fiscal_year').notNull(),
  periodNo: integer('period_no').notNull(),           // 1–12 regular, 13+ special
  periodType: periodType('period_type').notNull(),
  purpose: text('purpose'),                            // 'closing'|'audit'|'retrospective'|free text (special)
  nameVi: text('name_vi').notNull(),
  startDate: date('start_date'),                       // null for special
  endDate: date('end_date'),                           // null for special
  status: periodStatus('status').notNull().default('open'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: uuid('closed_by'),
}, (t) => ({
  uq: unique('accounting_period_uq').on(t.companyId, t.fiscalYear, t.periodNo),
  periodNoChk: check('period_no_positive', sql`${t.periodNo} >= 1`),
}));
