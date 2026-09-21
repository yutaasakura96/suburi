import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { seedUser } from "../db/seed";
import { getConfig } from "../lib/config";
import { E2E_DATABASE, E2E_URL } from "./database";

// A fresh database per run, built by the real migrations and holding only the seeded user — so the
// CV screen's empty state is real, and nothing Playwright saves lands in the local dev database.
export default async function setup() {
  const admin = new Client({ connectionString: E2E_URL.replace(`/${E2E_DATABASE}`, "/postgres") });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${E2E_DATABASE} with (force)`);
    await admin.query(`create database ${E2E_DATABASE}`);
  } finally {
    await admin.end();
  }

  const db = drizzle(E2E_URL);
  try {
    await migrate(db, { migrationsFolder: "db/migrations" });
    await seedUser(db, getConfig().ALLOWED_EMAIL);
  } finally {
    await db.$client.end();
  }
}
