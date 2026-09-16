import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getConfig } from "./config";

let db: NodePgDatabase | undefined;

// One pool per server instance, over the pooled URL (06, node-postgres everywhere). Created on first
// use so importing this module never reads configuration.
export function getDb() {
  db ??= drizzle(getConfig().DATABASE_URL);
  return db;
}
