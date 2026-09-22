import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { users } from "../db/schema.ts";
import { seedSyntheticCv } from "../db/seed-cv.ts";
import { seedUser } from "../db/seed.ts";
import { getConfig } from "../lib/config.ts";

// Hand-run against Neon `develop` only: `npm run db:seed:develop`. The user row, then the synthetic CV
// in each language (docs/12-deployment.md §1). Production runs `db:seed`, which never writes a CV.
// Logs outcomes, never the email or any CV text.
const { DATABASE_URL_UNPOOLED, ALLOWED_EMAIL } = getConfig();
const db = drizzle(DATABASE_URL_UNPOOLED);

try {
  const inserted = await seedUser(db, ALLOWED_EMAIL);
  console.log(inserted ? "Seeded the user row." : "User row already present; nothing changed.");

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, ALLOWED_EMAIL));
  for (const language of ["ja", "en"] as const) {
    const seeded = await db.transaction((tx) => seedSyntheticCv(tx, user.id, language));
    console.log(
      seeded
        ? `Seeded the synthetic ${language} CV as v1.`
        : `The ${language} CV already has a version; nothing changed. Reset the branch to reseed.`,
    );
  }
} finally {
  await db.$client.end();
}
