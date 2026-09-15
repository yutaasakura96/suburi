import { defineConfig } from "drizzle-kit";
import { getConfig } from "./lib/config";

// Generate, read the SQL, then migrate by hand (docs/12-deployment.md §4). Never push.
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: getConfig().DATABASE_URL_UNPOOLED },
  strict: true,
  verbose: true,
});
