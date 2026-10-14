import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createPutSettings } from "@/lib/settings/settings";

export function PUT(request: Request) {
  const db = getDb();
  return createPutSettings({
    auth: getAuth(),
    db,
    transaction: (work) => db.transaction((tx) => work(tx)),
  })(request);
}
