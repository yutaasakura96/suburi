import { configuredBackup } from "@/lib/backup/run";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { createCronRoute } from "@/lib/monitor/cron-route";

// Hobby's maximum and default, stated because the daily dump runs inside this call (06, #56).
export const maxDuration = 300;

// 07 §5.17: called by Vercel Cron (vercel.json), authenticated with CRON_SECRET, never a session.
export function GET(request: Request) {
  const config = getConfig();
  const db = getDb();
  return createCronRoute("self-check", {
    secret: config.CRON_SECRET,
    db,
    transaction: (work) => db.transaction((tx) => work(tx)),
    backup: configuredBackup(config),
  })(request);
}
