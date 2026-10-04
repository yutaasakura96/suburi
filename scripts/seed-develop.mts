import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { users } from "../db/schema.ts";
import { seedSyntheticCv } from "../db/seed-cv.ts";
import { seedRubrics, seedSetPieces, seedSyntheticQuestions } from "../db/seed-questions.ts";
import { seedSyntheticRounds } from "../db/seed-rounds.ts";
import { seedUser } from "../db/seed.ts";
import { getConfig } from "../lib/config.ts";

// Hand-run against Neon `develop` only: `npm run db:seed:develop`. The user row, the synthetic CV in
// each language, the rubrics and set pieces, the synthetic generated-origin bank questions, and the
// synthetic rounds History shows (docs/12-deployment.md §1). Production runs `db:seed`, which never writes a CV or a synthetic
// question. Logs outcomes, never the email or any CV text.
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

  console.log(`Seeded ${await seedRubrics(db)} rubric version(s).`);
  console.log(`Seeded ${await seedSetPieces(db, user.id)} set piece(s).`);
  console.log(`Seeded ${await seedSyntheticQuestions(db, user.id)} synthetic bank question(s).`);
  console.log(`Seeded ${await db.transaction((tx) => seedSyntheticRounds(tx, user.id))} synthetic round(s).`);
} finally {
  await db.$client.end();
}
