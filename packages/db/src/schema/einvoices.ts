import { pgTable, uuid, text, timestamp, bigint, jsonb, unique } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { einvoiceStatus, einvoiceProvider } from './enums.js';
import { companies } from './companies.js';
import { salesInvoices } from './sales.js';

export const einvoices = pgTable('einvoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  salesInvoiceId: uuid('sales_invoice_id').notNull().references(() => salesInvoices.id, { onDelete: 'cascade' }),
  provider: einvoiceProvider('provider').notNull(),
  mauSo: text('mau_so'),            // form code (mẫu số)
  kyHieu: text('ky_hieu'),          // serial symbol (ký hiệu)
  soHoaDon: text('so_hoa_don'),     // invoice number assigned at issue (số hóa đơn)
  sellerMst: text('seller_mst'),
  buyerMst: text('buyer_mst'),
  buyerName: text('buyer_name'),
  buyerAddress: text('buyer_address'),
  currency: text('currency').notNull().default('VND'),
  subtotalMinor: bigint('subtotal_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  vatMinor: bigint('vat_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull().default(sql`0`),
  status: einvoiceStatus('status').notNull().default('pending'),
  providerCode: text('provider_code'),
  gdtMessageId: text('gdt_message_id'),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Decree 123/2020/ND-CP: an issued e-invoice serial (mẫu số + ký hiệu + số) is unique per
  // taxpayer. NULLs are distinct in Postgres, so multiple 'pending' rows (null số) are allowed;
  // uniqueness only bites once a number is assigned at issue.
  serialUq: unique('einvoice_serial_uq').on(t.companyId, t.mauSo, t.kyHieu, t.soHoaDon),
}));
