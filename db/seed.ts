import { randomUUID } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { users } from "./schema.ts";

// The single user row (docs/04-database-schema.md §2). email_verified = true is load-bearing: Better
// Auth links a first Google sign-in only to a verified row. Idempotent on email.
export async function seedUser(db: NodePgDatabase, email: string): Promise<boolean> {
  const inserted = await db
    .insert(users)
    .values({
      id: randomUUID(),
      name: email.slice(0, email.indexOf("@")),
      email,
      emailVerified: true,
    })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });
  return inserted.length > 0;
}
