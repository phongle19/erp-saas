import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import { schema } from '@erp/db';
import { currentTx } from '../db/tx-context.js';

export interface CreatePartnerInput {
  code: string;
  name: string;
  taxCode?: string | undefined;
  partnerType?: 'customer' | 'vendor' | 'both' | undefined;
  address?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
}

@Injectable()
export class PartnersService {
  /** RLS WITH CHECK scopes INSERT to accessible companies; throw 403 for denied. */
  async create(companyId: string, input: CreatePartnerInput) {
    const tx = currentTx();
    // App-layer access gate mirroring PostingEngine: fail fast with a friendly 403.
    if (!tx.isAdmin && !tx.accessibleCompanies.includes(companyId)) {
      throw new ForbiddenException('access to company denied');
    }

    try {
      const [row] = await tx.db
        .insert(schema.businessPartners)
        .values({
          companyId,
          code: input.code,
          name: input.name,
          ...(input.taxCode !== undefined ? { taxCode: input.taxCode } : {}),
          partnerType: input.partnerType ?? 'customer',
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
        } as typeof schema.businessPartners.$inferInsert)
        .returning();
      return row!;
    } catch (err: unknown) {
      // PostgreSQL unique violation: 23505
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === '23505'
      ) {
        throw new ConflictException(
          `partner with code '${input.code}' already exists for this company`,
        );
      }
      throw err;
    }
  }

  /** RLS-filtered: users only see partners for their accessible companies. */
  list(companyId: string) {
    return currentTx()
      .db.select()
      .from(schema.businessPartners)
      .where(eq(schema.businessPartners.companyId, companyId))
      .orderBy(asc(schema.businessPartners.code));
  }

  /** RLS-hidden rows surface as 404. */
  async get(id: string) {
    const rows = await currentTx()
      .db.select()
      .from(schema.businessPartners)
      .where(eq(schema.businessPartners.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('business partner not found');
    return rows[0];
  }
}
