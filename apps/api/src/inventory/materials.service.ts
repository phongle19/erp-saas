import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import { schema } from '@erp/db';
import { currentTx } from '../db/tx-context.js';

export interface CreateMaterialInput {
  code: string;
  name: string;
  unit?: string | undefined;
  inventoryAccountCode?: string | undefined;
}

@Injectable()
export class MaterialsService {
  /** RLS WITH CHECK scopes INSERT to accessible companies; throw 403 for denied. */
  async create(companyId: string, input: CreateMaterialInput) {
    const tx = currentTx();
    // App-layer access gate mirroring PartnersService: fail fast with a friendly 403.
    if (!tx.isAdmin && !tx.accessibleCompanies.includes(companyId)) {
      throw new ForbiddenException('access to company denied');
    }

    try {
      const [row] = await tx.db
        .insert(schema.materials)
        .values({
          companyId,
          code: input.code,
          name: input.name,
          unit: input.unit ?? 'cái',
          inventoryAccountCode: input.inventoryAccountCode ?? '156',
        } as typeof schema.materials.$inferInsert)
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
          `material with code '${input.code}' already exists for this company`,
        );
      }
      throw err;
    }
  }

  /** RLS-filtered: users only see materials for their accessible companies. */
  list(companyId: string) {
    return currentTx()
      .db.select()
      .from(schema.materials)
      .where(eq(schema.materials.companyId, companyId))
      .orderBy(asc(schema.materials.code));
  }

  /** RLS-hidden rows surface as 404. */
  async get(id: string) {
    const rows = await currentTx()
      .db.select()
      .from(schema.materials)
      .where(eq(schema.materials.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('material not found');
    return rows[0];
  }
}
