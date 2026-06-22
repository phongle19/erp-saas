import { pgTable, uuid, text, timestamp, integer, date, bigint } from 'drizzle-orm/pg-core';
import { accountingRegime, householdTier, controlType } from './enums.js';
import { currencies } from './currencies.js';

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  mst: text('mst'),
  regime: accountingRegime('regime').notNull(),
  functionalCurrency: text('functional_currency').notNull().references(() => currencies.code),
  householdTier: householdTier('household_tier'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ownershipLinks = pgTable('ownership_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentCompanyId: uuid('parent_company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  childCompanyId: uuid('child_company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  // ownershipPct stored as BASIS POINTS (0–10000 = 0.00%–100.00%) for 2-decimal integer precision.
  ownershipPct: integer('ownership_pct').notNull(),
  controlType: controlType('control_type').notNull(),
  acquisitionDate: date('acquisition_date'),
  goodwillMinor: bigint('goodwill_minor', { mode: 'bigint' }),
});
