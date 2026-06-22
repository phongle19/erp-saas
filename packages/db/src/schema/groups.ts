import { pgTable, uuid, text, timestamp, integer, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { groupType } from './enums.js';
import { companies } from './companies.js';
import { currencies } from './currencies.js';
import { owner } from './org.js';

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => owner.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: groupType('type').notNull(),
  reportingCurrency: text('reporting_currency').notNull().references(() => currencies.code),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const groupMemberships = pgTable(
  'group_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    weightBp: integer('weight_bp').notNull().default(10000),
  },
  (t) => ({
    uq: unique('group_membership_uq').on(t.groupId, t.companyId),
    weightRange: check('weight_bp_range', sql`${t.weightBp} BETWEEN 0 AND 10000`),
  }),
);
