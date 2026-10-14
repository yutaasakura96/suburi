import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { users } from "../db/schema.ts";
import { seedSetPieceEnglish } from "../db/seed-questions.ts";
import { seedUser } from "../db/seed.ts";
import { getConfig } from "../lib/config.ts";

// Hand-run: `npm run db:seed`. The user row, then the Japanese set pieces' hand-written English beside
// whichever set pieces the bank holds (12 §1) — no model call. Logs outcomes, never the email.
const { DATABASE_URL_UNPOOLED, ALLOWED_EMAIL } = getConfig();
const db = drizzle(DATABASE_URL_UNPOOLED);

try {
  const inserted = await seedUser(db, ALLOWED_EMAIL);
  console.log(inserted ? "Seeded the user row." : "User row already present; nothing changed.");

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, ALLOWED_EMAIL));
  console.log(`Seeded ${await seedSetPieceEnglish(db, user.id)} set piece English(es).`);
} finally {
  await db.$client.end();
}
