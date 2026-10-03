import { spawnSync } from "node:child_process";
import { acceptedAdvisory, auditRefusals } from "./audit-gate.ts";

// `npm run audit:ci`, CI's last step (11 §7). Fails on every high or critical advisory except the
// the one scripts/audit-gate.ts accepts by name.

// npm exits 1 whenever it reports anything, so the report decides, not the status.
const audit = spawnSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

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
