import { Injectable, ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@erp/db';
import { currentTx } from '../db/tx-context.js';
import { hashPassword } from '../auth/crypto.util.js';

export interface CreateUserInput {
  email: string;
  password: string;
  displayName: string;
}

export interface CreateGrantInput {
  userId: string;
  companyId: string;
  role: string;
}

@Injectable()
export class AccessService {
  /** Create a NON-admin accountant user. `users` has no RLS. */
  async createUser(input: CreateUserInput) {
    const existing = await currentTx()
      .db.select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, input.email))
      .limit(1);
    if (existing[0]) throw new ConflictException('email already exists');

    const [row] = await currentTx()
      .db.insert(schema.users)
      .values({
        email: input.email,
        passwordHash: await hashPassword(input.password),
        displayName: input.displayName,
        isAdmin: false,
      })
      .returning({
        id: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
      });
    return row;
  }

  /** Grant a user access to a company. `company_access` has no RLS; admin-only via guard. */
  async grant(input: CreateGrantInput) {
    const [row] = await currentTx()
      .db.insert(schema.companyAccess)
      .values({
        userId: input.userId,
        companyId: input.companyId,
        role: input.role,
      })
      .returning();
    return row;
  }
}
