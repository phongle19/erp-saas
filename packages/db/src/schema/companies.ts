import { pgTable, uuid, text, timestamp, integer, smallint, date, bigint, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { accountingRegime, householdTier, controlType, einvoiceProvider } from './enums.js';
import { currencies } from './currencies.js';
import { owner } from './org.js';

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => owner.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  mst: text('mst'),
  regime: accountingRegime('regime').notNull(),
  functionalCurrency: text('functional_currency').notNull().references(() => currencies.code),
  householdTier: householdTier('household_tier'),
  status: text('status').notNull().default('active'),
  fiscalYearStartMonth: smallint('fiscal_year_start_month').notNull().default(1), // 1=Jan … 12=Dec
  einvoiceProvider: einvoiceProvider('einvoice_provider').notNull().default('viettel'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ownershipLinks = pgTable(
  'ownership_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentCompanyId: uuid('parent_company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    childCompanyId: uuid('child_company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    // ownershipPct stored as BASIS POINTS (0–10000 = 0.00%–100.00%) for 2-decimal integer precision.
    ownershipPct: integer('ownership_pct').notNull(),
    controlType: controlType('control_type').notNull(),
    acquisitionDate: date('acquisition_date'),
    goodwillMinor: bigint('goodwill_minor', { mode: 'bigint' }),
  },
  (t) => ({
    uq: unique('ownership_link_parent_child_uq').on(t.parentCompanyId, t.childCompanyId),
    ownershipPctRange: check('ownership_pct_bp_range', sql`${t.ownershipPct} BETWEEN 0 AND 10000`),
  }),
);
