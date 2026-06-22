import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { schema } from '@erp/db';
import { currentTx } from '../db/tx-context.js';

export interface CreateGroupInput {
  name: string;
  type: 'STATUTORY' | 'MANAGEMENT';
  reportingCurrency: string;
}

@Injectable()
export class GroupsService {
  /** groups are owner-global: any authenticated user may read (RLS USING true). */
  list() {
    return currentTx().db.select().from(schema.groups);
  }

  async create(input: CreateGroupInput) {
    const owners = await currentTx().db.select().from(schema.owner).limit(1);
    const owner = owners[0];
    if (!owner) {
      throw new InternalServerErrorException('no owner — bootstrap first');
    }
    const [row] = await currentTx()
      .db.insert(schema.groups)
      .values({ ...input, ownerId: owner.id } as typeof schema.groups.$inferInsert)
      .returning();
    return row;
  }
}
