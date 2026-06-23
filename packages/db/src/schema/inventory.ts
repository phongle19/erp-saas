import { pgTable, uuid, text, date, timestamp, bigint, boolean, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { movementType } from './enums.js';
import { companies } from './companies.js';
import { accountingPeriods } from './periods.js';

export const materials = pgTable('materials', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  unit: text('unit').notNull().default('cái'),          // đvt
  inventoryAccountCode: text('inventory_account_code').notNull().default('156'),  // '156' goods | '152' raw materials
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: unique('material_code_uq').on(t.companyId, t.code) }));

export const inventoryMovements = pgTable('inventory_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  materialId: uuid('material_id').notNull().references(() => materials.id),
  movementType: movementType('movement_type').notNull(),
  quantity: bigint('quantity', { mode: 'bigint' }).notNull(),
  unitCostMinor: bigint('unit_cost_minor', { mode: 'bigint' }).notNull().default(sql`0`),  // derived, display
  totalCostMinor: bigint('total_cost_minor', { mode: 'bigint' }).notNull(),
  balanceQtyAfter: bigint('balance_qty_after', { mode: 'bigint' }).notNull(),
  balanceValueAfter: bigint('balance_value_after', { mode: 'bigint' }).notNull(),
  sourceDocType: text('source_doc_type'),     // 'purchase_invoice' | 'goods_issue' | ...
  sourceDocId: uuid('source_doc_id'),
  journalEntryId: uuid('journal_entry_id'),
  movementDate: date('movement_date').notNull(),
  periodId: uuid('period_id').references(() => accountingPeriods.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ idx: index('inventory_movement_company_material_idx').on(t.companyId, t.materialId, t.createdAt) }));
