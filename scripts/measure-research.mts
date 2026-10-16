import { openAiCompanyResearcher } from "../lib/ai/research.ts";
import { RESEARCH_MODEL } from "../lib/ai/models.ts";
import { version } from "../lib/prompts/research-1.0.ts";

// Company research, measured against OpenAI through the real port and `research-1.0` (#134, 03 §4),
// the way #125 measured the Japanese follow-up: this is what the research route's timeout is set
// from (07 §5.22). Hand-run, never in CI:
//
//   OPENAI_API_KEY=… node --import ./scripts/resolve-ts.mts scripts/measure-research.mts
//
// Three well-known public companies, one written in Japanese, and one invented company no search can
// find, so the fallback to the model's knowledge is exercised too. No one's CV, no one's posting.
// Prints timings, token counts and counts only — never a prompt, a note or a model's output.

const RUNS = Number(process.env.RUNS ?? 3);

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
const researcher = openAiCompanyResearcher({ apiKey });

const COMPANIES = [
  { label: "Mercari, en", companyName: "Mercari", roleTitle: "Site Reliability Engineer" },
  { label: "Toyota, ja", companyName: "トヨタ自動車株式会社", roleTitle: "データエンジニア" },
  { label: "Rakuten, en", companyName: "Rakuten Group", roleTitle: "Backend Engineer" },
  { label: "invented, ja", companyName: "株式会社ミナトハ架空商事", roleTitle: "経理マネージャー" },
];

interface Row {
  readonly ms: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly searched: boolean;
  readonly web: number;
  readonly modelKnowledge: number;
  readonly dropped: number;
}

const rows: Record<string, Row[]> = {};
const failures: Record<string, string[]> = {};

for (let run = 0; run < RUNS; run += 1) {
  for (const { label, companyName, roleTitle } of COMPANIES) {
    const started = performance.now();
    try {
      const result = await researcher.research({ companyName, roleTitle });
      (rows[label] ??= []).push({
        ms: performance.now() - started,
        tokensIn: result.tokensIn ?? 0,
        tokensOut: result.tokensOut ?? 0,
        searched: result.searched,
        web: result.facts.web,
        modelKnowledge: result.facts.modelKnowledge,
        dropped: result.facts.dropped,
      });
    } catch (error) {
      const errorClass = (error as { errorClass?: string }).errorClass ?? "unexpected";
      (failures[label] ??= []).push(errorClass);
      console.log(`${label}: call failed after ${((performance.now() - started) / 1000).toFixed(1)} s: ${errorClass}`);
    }
  }
}

function quantile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  return sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low);
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
console.log(`\nMeasured ${RUNS} run(s) of ${COMPANIES.length} companies: ${RESEARCH_MODEL}, ${version}.`);
console.log("| Company | n | median | p90 | slowest | tokens in / out (median) | searched | web / model-knowledge facts (median) | dropped links (total) | failed |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const { label } of COMPANIES) {
  const measured = rows[label] ?? [];
  const failed = failures[label] ?? [];
  if (measured.length === 0) {
    console.log(`| ${label} | 0 | — | — | — | — | — | — | — | ${failed.join(", ")} |`);
    continue;
  }
  const ms = measured.map((row) => row.ms);
  const median = (pick: (row: Row) => number) => quantile(measured.map(pick), 0.5).toFixed(0);
  console.log(
    `| ${label} | ${measured.length} | ${seconds(quantile(ms, 0.5))} | ${seconds(quantile(ms, 0.9))} | ${seconds(Math.max(...ms))} | ${median((row) => row.tokensIn)} / ${median((row) => row.tokensOut)} | ${measured.filter((row) => row.searched).length} of ${measured.length} | ${median((row) => row.web)} / ${median((row) => row.modelKnowledge)} | ${measured.reduce((sum, row) => sum + row.dropped, 0)} | ${failed.length === 0 ? "none" : failed.join(", ")} |`,
  );
}
const all = Object.values(rows).flat().map((row) => row.ms);
if (all.length > 0) console.log(`\nAll calls: n ${all.length}, median ${seconds(quantile(all, 0.5))}, p90 ${seconds(quantile(all, 0.9))}, slowest ${seconds(Math.max(...all))}.`);
