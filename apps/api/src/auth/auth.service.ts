import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { makeDb, schema } from '@erp/db';
import { hashPassword, verifyPassword } from './crypto.util.js';
import { hashToken } from './session.util.js';

@Injectable()
export class AuthService {
  // Dedicated connection: auth tables have no RLS and these methods may be
  // called before the request tenant tx/GUCs are established.
  private db = makeDb();

  async bootstrap(
    email: string,
    password: string,
    displayName: string,
    ownerName: string,
  ): Promise<void> {
    // Check if any users exist; if so, the system is already bootstrapped.
    const existingUsers = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .limit(1);
    if (existingUsers.length > 0) {
      throw new ConflictException('already bootstrapped');
    }

    await this.db
      .insert(schema.owner)
      .values({ name: ownerName })
      .onConflictDoNothing();

    await this.db.insert(schema.users).values({
      email,
      passwordHash: await hashPassword(password),
      displayName,
      isAdmin: true,
    });
  }

  async login(email: string, password: string): Promise<string> {
    const userRows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    const user = userRows[0];

    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      throw new UnauthorizedException();
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

    await this.db.insert(schema.sessions).values({
      id: hashToken(token),
      userId: user.id,
      expiresAt,
    });

    return token;
  }

  async logout(token: string): Promise<void> {
    await this.db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, hashToken(token)));
  }
}
