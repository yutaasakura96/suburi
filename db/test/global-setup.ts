import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { ADMIN_URL, TEST_DATABASE, TEST_URL } from "./database";

// A fresh database per run, built only by the real migrations.
export default async function setup() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${TEST_DATABASE} with (force)`);
    await admin.query(`create database ${TEST_DATABASE}`);
  } finally {
    await admin.end();
  }

  const db = drizzle(TEST_URL);
  try {
    await migrate(db, { migrationsFolder: "db/migrations" });
  } finally {
    await db.$client.end();
  }
}
