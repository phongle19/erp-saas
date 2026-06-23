import { pgTable, uuid, text, date, timestamp, integer, bigint, boolean, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { salesDocStatus, goodsIssueReason } from './enums.js';
import { companies } from './companies.js';
import { businessPartners } from './sales.js';
import { accountingPeriods } from './periods.js';
import { materials } from './inventory.js';

export const purchaseInvoices = pgTable('purchase_invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  partnerId: uuid('partner_id').notNull().references(() => businessPartners.id),     // vendor
  invoiceNo: integer('invoice_no').notNull(),
  vendorInvoiceNo: text('vendor_invoice_no'),
  invoiceDate: date('invoice_date').notNull(),
  periodId: uuid('period_id').notNull().references(() => accountingPeriods.id),
  fiscalYear: integer('fiscal_year').notNull(),
  description: text('description'),
  nonCashPayment: boolean('non_cash_payment').notNull().default(false),  // ≥5M input-VAT credit rule (Law 48/2024)
  status: salesDocStatus('status').notNull().default('draft'),
  journalEntryId: uuid('journal_entry_id'),
  subtotalMinor: bigint('subtotal_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  vatMinor: bigint('vat_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  createdBy: uuid('created_by'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: unique('purchase_invoice_no_uq').on(t.companyId, t.fiscalYear, t.invoiceNo) }));

export const purchaseInvoiceLines = pgTable('purchase_invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull().references(() => purchaseInvoices.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  materialId: uuid('material_id').notNull().references(() => materials.id),
  quantity: bigint('quantity', { mode: 'bigint' }).notNull(),
  unitCostMinor: bigint('unit_cost_minor', { mode: 'bigint' }).notNull(),
  lineCostMinor: bigint('line_cost_minor', { mode: 'bigint' }).notNull(),
  vatRuleType: text('vat_rule_type').notNull(),
  vatRatePct: integer('vat_rate_pct').notNull(),
  vatMinor: bigint('vat_minor', { mode: 'bigint' }).notNull(),
  inventoryAccountCode: text('inventory_account_code').notNull().default('156'),
}, (t) => ({ uq: unique('purchase_invoice_line_no_uq').on(t.invoiceId, t.lineNo) }));

export const goodsIssues = pgTable('goods_issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  issueNo: integer('issue_no').notNull(),
  issueDate: date('issue_date').notNull(),
  periodId: uuid('period_id').notNull().references(() => accountingPeriods.id),
  fiscalYear: integer('fiscal_year').notNull(),
  reason: goodsIssueReason('reason').notNull().default('sale'),
  description: text('description'),
  status: salesDocStatus('status').notNull().default('draft'),
  journalEntryId: uuid('journal_entry_id'),
  totalCostMinor: bigint('total_cost_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  createdBy: uuid('created_by'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: unique('goods_issue_no_uq').on(t.companyId, t.fiscalYear, t.issueNo) }));

export const goodsIssueLines = pgTable('goods_issue_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  issueId: uuid('issue_id').notNull().references(() => goodsIssues.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  materialId: uuid('material_id').notNull().references(() => materials.id),
  quantity: bigint('quantity', { mode: 'bigint' }).notNull(),
  costMinor: bigint('cost_minor', { mode: 'bigint' }).notNull(),       // weighted-avg cost out
  cogsAccountCode: text('cogs_account_code').notNull().default('632'),
}, (t) => ({ uq: unique('goods_issue_line_no_uq').on(t.issueId, t.lineNo) }));

export const vendorPayments = pgTable('vendor_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  partnerId: uuid('partner_id').notNull().references(() => businessPartners.id),    // vendor
  paymentNo: integer('payment_no').notNull(),
  paymentDate: date('payment_date').notNull(),
  periodId: uuid('period_id').notNull().references(() => accountingPeriods.id),
  fiscalYear: integer('fiscal_year').notNull(),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  settlementAccountCode: text('settlement_account_code').notNull(),   // '111' | '112'
  description: text('description'),
  status: salesDocStatus('status').notNull().default('draft'),
  journalEntryId: uuid('journal_entry_id'),
  createdBy: uuid('created_by'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: unique('vendor_payment_no_uq').on(t.companyId, t.fiscalYear, t.paymentNo) }));
