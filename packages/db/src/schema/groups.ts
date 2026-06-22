import { pgTable, uuid, text, timestamp, integer, unique } from 'drizzle-orm/pg-core';
import { groupType } from './enums';
import { companies } from './companies';
import { currencies } from './currencies';

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
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
  (t) => ({ uq: unique('group_membership_uq').on(t.groupId, t.companyId) }),
);
