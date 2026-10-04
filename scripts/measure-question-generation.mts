import { readFileSync } from "node:fs";
import { openAiEmbedder } from "../lib/ai/embed.ts";
import { openAiQuestionGenerator, type GenerationLanguage, type GenerationRoleContext } from "../lib/ai/generate-questions.ts";
import { EMBEDDING_MODEL, QUESTION_GENERATION_MODEL } from "../lib/ai/models.ts";
import { characterLength } from "../lib/cv/spans.ts";

// Round-start question generation, measured against OpenAI through the real ports and prompts (#47,
// 03 §4) — the way #20 measured CV extraction and #42 the round's other calls. Hand-run, never in CI:
//
//   OPENAI_API_KEY=… node --import ./scripts/resolve-ts.mts scripts/measure-question-generation.mts
//
// Two things are measured. **The round-start wait**: generating 3 and 7 questions for each role
// context, and embedding them, since both sit beside the preflight (07 §5.4) — `COUNTS=5,9` for what
// a round with an empty bank really asks for, its length and the spare candidates. **The posting's size**:
// the same call with the posting repeated up to and past the cap, which is where
// `lib/round/limits.ts`'s number comes from (07 §5.3).
//
// Synthetic input only (11 §8): the invented CVs in `lib/cv/test/`, read as their sentence lines in
// place of claims, and the invented postings in `lib/round/test/`. Prints timings, token counts and
// sizes — never a prompt, a posting or a model's output.

const RUNS = Number(process.env.RUNS ?? 5);

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
const generator = openAiQuestionGenerator({ apiKey });
const embedder = openAiEmbedder({ apiKey });

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** A CV's assertion-length lines, standing in for its claims: about as many, about as long. */
function claimsOf(text: string, minimum: number) {
  return text.split("\n").filter((line) => characterLength(line) >= minimum);
}

const CLAIMS: Record<GenerationLanguage, string[]> = {
  en: claimsOf(read("../lib/cv/test/synthetic-en-cv.txt"), 60),
  ja: claimsOf([read("../lib/cv/test/synthetic-ja-rirekisho.txt"), read("../lib/cv/test/synthetic-ja-shokumu.txt")].join("\n"), 20),
};

const POSTINGS: Record<GenerationLanguage, { companyName: string; roleTitle: string; body: string }> = {
  en: { companyName: "Tidewater Logistics Systems", roleTitle: "Senior Backend Engineer, Routing Platform", body: read("../lib/round/test/synthetic-posting-en.txt") },
  ja: { companyName: "株式会社サンプル物流システムズ", roleTitle: "バックエンドエンジニア", body: read("../lib/round/test/synthetic-posting-ja.txt") },
};

const EXISTING = [
  "Could you start by introducing yourself?",
  "Tell me about a time you disagreed with your manager. What did you do?",
  "How do you decide what to work on when everything is urgent?",
];

interface Sample {
  readonly ms: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly returned: number;
}
const samples: Record<string, Sample[]> = {};
const embedMs: Record<string, number[]> = {};

async function measure(job: string, language: GenerationLanguage, count: number, roleContext: GenerationRoleContext, embed = false) {
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now();
    const result = await generator.generate({ language, roundType: "behavioural", count, roleContext, claims: CLAIMS[language], existing: EXISTING });
    (samples[job] ??= []).push({
      ms: performance.now() - started,
      tokensIn: result.tokensIn ?? 0,
      tokensOut: result.tokensOut ?? 0,
      returned: result.questions.length,
    });
    if (embed) {
      const embedStarted = performance.now();
      await embedder.embed(result.questions);
      (embedMs[`embeddings, ${count} questions`] ??= []).push(performance.now() - embedStarted);
    }
  }
}

function quantile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  return sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low);
}

/** The posting repeated until it is at least `chars` code points long, then cut to exactly that. */
function sized(body: string, chars: number) {
  const repeats = Math.ceil(chars / characterLength(body));
  return [...Array.from({ length: repeats }, () => body).join("\n\n")].slice(0, chars).join("");
}

console.log(`Measuring ${RUNS} run(s) of each: ${QUESTION_GENERATION_MODEL}, ${EMBEDDING_MODEL}.`);
console.log(`Claims: en ${CLAIMS.en.length}, ja ${CLAIMS.ja.length}. Postings: en ${characterLength(POSTINGS.en.body)}, ja ${characterLength(POSTINGS.ja.body)} code points.`);

// The round-start wait.
const COUNTS = (process.env.COUNTS ?? "3,7").split(",").filter(Boolean).map(Number);
for (const language of ["en", "ja"] as const) {
  for (const count of COUNTS) {
    await measure(`${language}, general practice, ${count} questions`, language, count, { kind: "general" }, language === "en");
    await measure(`${language}, posting as written, ${count} questions`, language, count, { kind: "posting", ...POSTINGS[language] });
  }
}

// The posting's size, seven questions each: the longest round, so the largest output.
const SIZES = (process.env.SIZES ?? "10000,20000,40000").split(",").filter(Boolean).map(Number);
for (const language of ["en", "ja"] as const) {
  for (const chars of SIZES) {
    await measure(`${language}, posting of ${chars} code points, 7 questions`, language, 7, {
      kind: "posting",
      ...POSTINGS[language],
      body: sized(POSTINGS[language].body, chars),
    });
  }
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
console.log("\n| Job | n | median | p90 | slowest | tokens in / out (median) | questions returned (min) |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const [job, rows] of Object.entries(samples)) {
  const ms = rows.map((row) => row.ms);
  console.log(
    `| ${job} | ${rows.length} | ${seconds(quantile(ms, 0.5))} | ${seconds(quantile(ms, 0.9))} | ${seconds(Math.max(...ms))} | ${quantile(rows.map((row) => row.tokensIn), 0.5).toFixed(0)} / ${quantile(rows.map((row) => row.tokensOut), 0.5).toFixed(0)} | ${Math.min(...rows.map((row) => row.returned))} |`,
  );
}
for (const [job, ms] of Object.entries(embedMs)) {
  console.log(`| ${job} | ${ms.length} | ${seconds(quantile(ms, 0.5))} | ${seconds(quantile(ms, 0.9))} | ${seconds(Math.max(...ms))} | — | — |`);
}
