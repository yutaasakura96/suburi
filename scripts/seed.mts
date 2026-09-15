import { drizzle } from "drizzle-orm/node-postgres";
import { seedUser } from "../db/seed.ts";
import { getConfig } from "../lib/config.ts";

// Hand-run: `npm run db:seed`. Logs the outcome, never the email.
const { DATABASE_URL_UNPOOLED, ALLOWED_EMAIL } = getConfig();
const db = drizzle(DATABASE_URL_UNPOOLED);

try {
  const inserted = await seedUser(db, ALLOWED_EMAIL);
  console.log(inserted ? "Seeded the user row." : "User row already present; nothing changed.");
} finally {
  await db.$client.end();
}
