import { z } from "zod";

// CI's audit (11 §7): `npm audit --audit-level=high`, less the advisories accepted by name below
// (06, 2026-10-03). npm audit has no flag that ignores one advisory, so its report is read here.

type AcceptedAdvisory = { id: string; package: string; range: string };

/**
 * The high advisories CI lets through. Each is held to the package and the vulnerable range it was
 * accepted at, and the audit fails once npm reports another range or stops reporting it, so an
 * entry cannot outlive its reason.
 */
export const acceptedAdvisories: AcceptedAdvisory[] = [
  // braces, stack exhaustion on deeply nested patterns, published 2026-09-18. No patched release
  // exists: 3.0.3 is the latest and is inside the range. It arrives only through micromatch →
  // fast-glob under @next/eslint-plugin-next, ts-morph and shadcn's CLI, which expand globs written
  // in this repository and never request input. Remove this entry when a patched braces ships
  // (update to it in the same change) or the advisory is withdrawn.
  { id: "GHSA-vfj7-8cjw-p6xm", package: "braces", range: "<=3.0.3" },
];

const severity = z.enum(["info", "low", "moderate", "high", "critical"]);
const advisory = z.object({ name: z.string(), url: z.string(), severity, range: z.string() });
// `npm audit --json`, report version 2. A package's `via` holds its own advisories, and the names
// of the vulnerable packages it depends on.
const auditReport = z.object({
  auditReportVersion: z.literal(2),
  vulnerabilities: z.record(
    z.string(),
    z.object({ severity, via: z.array(z.union([z.string(), advisory])) }),
  ),
});

type Advisory = z.infer<typeof advisory>;

// --audit-level=high.
const failing = new Set(["high", "critical"]);

/** Why the audit fails, one line per reason. Empty means it passes. */
export function auditRefusals(report: unknown, accepted = acceptedAdvisories): string[] {
  const parsed = auditReport.safeParse(report);
  if (!parsed.success) return ["npm audit did not return a report this gate can read."];
  const packages = new Map(Object.entries(parsed.data.vulnerabilities));

  function advisoriesOf(name: string, seen = new Set<string>()): Advisory[] {
    if (seen.has(name)) return [];
    seen.add(name);
    const via = packages.get(name)?.via ?? [];
    return via
      .flatMap((entry) => (typeof entry === "string" ? advisoriesOf(entry, seen) : [entry]))
      .filter((entry) => failing.has(entry.severity));
  }

  const reasons = new Set<string>();
  const reported = new Set<AcceptedAdvisory>();

  for (const [name, entry] of packages) {
    if (!failing.has(entry.severity)) continue;
    const advisories = advisoriesOf(name);
    // Nothing to compare against the list, so nothing here can be called accepted.
    if (advisories.length === 0) {
      reasons.add(`${name} is ${entry.severity}, but the report names no advisory for it.`);
    }

    for (const found of advisories) {
      const match = accepted.find(
        (candidate) =>
          found.url === `https://github.com/advisories/${candidate.id}` && found.name === candidate.package,
      );
      if (!match) {
        reasons.add(`${found.name} ${found.range} is ${found.severity}: ${found.url}`);
        continue;
      }
      reported.add(match);
      if (found.range === match.range) continue;
      reasons.add(
        `${match.id} now covers ${match.package} ${found.range}, not the ${match.range} that was accepted. ` +
          `A patched ${match.package} has probably shipped: update to it and remove the entry from scripts/audit-gate.ts.`,
      );
    }
  }

  for (const entry of accepted) {
    if (reported.has(entry)) continue;
    reasons.add(
      `${entry.id} is no longer reported against ${entry.package}. Remove its entry from scripts/audit-gate.ts.`,
    );
  }

  return [...reasons];
}
