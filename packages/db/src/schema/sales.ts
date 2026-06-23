import { pgTable, uuid, text, date, timestamp, integer, bigint, boolean, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { partnerType, salesDocStatus } from './enums.js';
import { companies } from './companies.js';
import { accountingPeriods } from './periods.js';

export const businessPartners = pgTable('business_partners', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  taxCode: text('tax_code'),            // MST
  partnerType: partnerType('partner_type').notNull().default('customer'),
  address: text('address'),
  email: text('email'),
  phone: text('phone'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: unique('business_partner_code_uq').on(t.companyId, t.code) }));

export const salesInvoices = pgTable('sales_invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  partnerId: uuid('partner_id').notNull().references(() => businessPartners.id),
  invoiceNo: integer('invoice_no').notNull(),
  invoiceDate: date('invoice_date').notNull(),
  periodId: uuid('period_id').notNull().references(() => accountingPeriods.id),
  fiscalYear: integer('fiscal_year').notNull(),
  description: text('description'),
  status: salesDocStatus('status').notNull().default('draft'),
  journalEntryId: uuid('journal_entry_id'),   // set on post (FK journal_entries; plain uuid — avoids import cycle)
  subtotalMinor: bigint('subtotal_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  vatMinor: bigint('vat_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  createdBy: uuid('created_by'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: unique('sales_invoice_no_uq').on(t.companyId, t.fiscalYear, t.invoiceNo) }));

export const salesInvoiceLines = pgTable('sales_invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull().references(() => salesInvoices.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  description: text('description').notNull(),
  // Fractional quantity deferred to a future phase; whole units sufficient for Phase 2a.
  quantity: bigint('quantity', { mode: 'bigint' }).notNull(),
  unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
  lineNetMinor: bigint('line_net_minor', { mode: 'bigint' }).notNull(),
  vatRuleType: text('vat_rule_type').notNull(),   // 'vat_rate'|'vat_rate_reduced'|'vat_rate_5'|'vat_zero'|'vat_exempt'
  vatRatePct: integer('vat_rate_pct').notNull(),  // resolved percent, stored for audit trail
  vatMinor: bigint('vat_minor', { mode: 'bigint' }).notNull(),
  revenueAccountCode: text('revenue_account_code').notNull().default('511'),
}, (t) => ({ uq: unique('sales_invoice_line_no_uq').on(t.invoiceId, t.lineNo) }));

export const customerReceipts = pgTable('customer_receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  partnerId: uuid('partner_id').notNull().references(() => businessPartners.id),
  receiptNo: integer('receipt_no').notNull(),
  receiptDate: date('receipt_date').notNull(),
  periodId: uuid('period_id').notNull().references(() => accountingPeriods.id),
  fiscalYear: integer('fiscal_year').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  settlementAccountCode: text('settlement_account_code').notNull(),  // '111' | '112'
  description: text('description'),
  status: salesDocStatus('status').notNull().default('draft'),
  journalEntryId: uuid('journal_entry_id'),  // plain uuid — avoids import cycle with journals
  createdBy: uuid('created_by'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: unique('customer_receipt_no_uq').on(t.companyId, t.fiscalYear, t.receiptNo) }));
