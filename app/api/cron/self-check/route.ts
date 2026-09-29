import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { createCronRoute } from "@/lib/monitor/cron-route";

// 07 §5.17: called by Vercel Cron (vercel.json), authenticated with CRON_SECRET, never a session.
export function GET(request: Request) {
  const db = getDb();
  return createCronRoute("self-check", {
    secret: getConfig().CRON_SECRET,
    db,
    transaction: (work) => db.transaction((tx) => work(tx)),
  })(request);
}
