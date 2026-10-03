import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptedAdvisory, auditRefusals } from "./audit-gate.ts";

// `npm run audit:ci`, CI's last step (11 §7). Fails on every high or critical advisory except
// the one scripts/audit-gate.ts accepts by name.

// npm exits 1 whenever it reports anything, so the report decides, not the status.
// An empty cache each run: npm caches an advisory and, while its range is unchanged, reports the
// cached severity over the registry's, so a warm ~/.npm (CI restores one) hides a reclassification.
const cache = mkdtempSync(join(tmpdir(), "audit-ci-"));
const audit = spawnSync("npm", ["audit", "--json", "--cache", cache], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
rmSync(cache, { recursive: true, force: true });

let report: unknown;
try {
  report = JSON.parse(audit.stdout);
} catch {
  report = undefined;
}

const refusals = auditRefusals(report);
if (refusals.length > 0) {
  console.error("audit:ci refused:");
  for (const reason of refusals) console.error(`  - ${reason}`);
  if (audit.error) console.error(audit.error.message);
  if (audit.stderr) console.error(audit.stderr.trim());
  process.exit(1);
}

console.log("No high or critical advisory outside the one scripts/audit-gate.ts accepts.");
const { id, package: name, severity, range } = acceptedAdvisory;
console.log(`  - accepted: ${id}, ${name} ${range} (${severity})`);
