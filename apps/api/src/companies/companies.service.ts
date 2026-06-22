import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@erp/db';
import { currentTx } from '../db/tx-context.js';

export interface CreateCompanyInput {
  name: string;
  mst?: string | undefined;
  regime: string;
  functionalCurrency: string;
  householdTier?: string | undefined;
}

@Injectable()
export class CompaniesService {
  /** RLS-filtered: admin sees all, scoped users see only granted companies. */
  list() {
    return currentTx().db.select().from(schema.companies);
  }

  /** RLS-hidden rows surface as 404 (the row simply isn't returned). */
  async get(id: string) {
    const rows = await currentTx()
      .db.select()
      .from(schema.companies)
      .where(eq(schema.companies.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  async create(input: CreateCompanyInput) {
    // `owner` has no RLS, so the singleton SELECT succeeds in any context.
    const owners = await currentTx().db.select().from(schema.owner).limit(1);
    const owner = owners[0];
    if (!owner) {
      throw new InternalServerErrorException('no owner — bootstrap first');
    }
    const [row] = await currentTx()
      .db.insert(schema.companies)
      .values({ ...input, ownerId: owner.id } as typeof schema.companies.$inferInsert)
      .returning();
    return row;
  }
}
