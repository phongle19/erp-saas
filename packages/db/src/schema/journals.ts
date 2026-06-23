import { pgTable, uuid, integer, text, date, timestamp, bigint, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { journalStatus } from './enums.js';
import { companies } from './companies.js';
import { accountingPeriods } from './periods.js';
import { chartOfAccounts } from './coa.js';
import { businessPartners } from './sales.js';

export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  periodId: uuid('period_id').notNull().references(() => accountingPeriods.id),
  fiscalYear: integer('fiscal_year').notNull(),
  entryNo: integer('entry_no').notNull(),
  entryDate: date('entry_date').notNull(),
  description: text('description').notNull(),
  status: journalStatus('status').notNull().default('draft'),
  reversesEntryId: uuid('reverses_entry_id'),          // self-ref (no FK thunk needed; nullable)
  createdBy: uuid('created_by'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: unique('journal_entry_no_uq').on(t.companyId, t.fiscalYear, t.entryNo),
}));

export const journalLines = pgTable('journal_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  entryId: uuid('entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }), // denormalized for RLS
  accountId: uuid('account_id').notNull().references(() => chartOfAccounts.id),
  debitMinor: bigint('debit_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  creditMinor: bigint('credit_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  icCounterpartyCompanyId: uuid('ic_counterparty_company_id'),  // reserved for Phase 2 eliminations
  partnerId: uuid('partner_id').references(() => businessPartners.id),  // AR/AP partner dimension; nullable
  lineMemo: text('line_memo'),
}, (t) => ({
  nonNeg: check('line_amounts_non_negative', sql`${t.debitMinor} >= 0 AND ${t.creditMinor} >= 0`),
  oneSide: check('line_not_both_sides', sql`NOT (${t.debitMinor} > 0 AND ${t.creditMinor} > 0)`),
}));
