import { readFileSync } from "node:fs";
import type { GenerationRoleContext } from "../lib/ai/generate-questions.ts";
import { openAiModelAnswerGenerator, type ModelAnswerInput, type ModelAnswerResult } from "../lib/ai/model-answer.ts";
import { MODEL_ANSWER_MODEL } from "../lib/ai/models.ts";
import { characterLength } from "../lib/cv/spans.ts";
import { locatedModelAnswer } from "../lib/round/model-answer-spans.ts";
import { paceUnits } from "../lib/round/measures.ts";
import { EN_1_0 } from "../lib/rubric/en-1.0.ts";
import { JA_1_0 } from "../lib/rubric/ja-1.0.ts";
import type { RubricLanguage } from "../lib/rubric/types.ts";

// A round's model answers, measured against OpenAI through the real port and prompts (#74, 03 §4) —
// the way #42 measured the round's other calls. Hand-run, never in CI:
//
//   OPENAI_API_KEY=… node --import ./scripts/resolve-ts.mts scripts/measure-model-answers.mts
//
// `complete` sends one call per answer, side by side (07 §5.12), so that is what a run is: a round of
// three questions and their three follow-ups, six calls at once. Each call's own time is recorded, and
// the time the whole round took, which is what the user waits for. What comes back is run through
// `lib/round/model-answer-spans.ts`, so the marks the server would keep and drop are counted too.
//
// Synthetic input only (11 §8): the invented CVs in `lib/cv/test/`, read as their lines in place of
// claims, the invented postings in `lib/round/test/`, and invented answers. Prints timings, token
// counts, lengths and counts — never a prompt, an answer or a model's output, unless `SHOW=1` asks for
// the model answers of the first run, to read them. Nothing here is anyone's CV.

const RUNS = Number(process.env.RUNS ?? 5);
const LANGUAGES = (process.env.LANGUAGES ?? "en,ja").split(",") as RubricLanguage[];
const SHOW = process.env.SHOW === "1";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
const generator = openAiModelAnswerGenerator({ apiKey });

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** A CV's assertion-length lines, standing in for its claims: about as many, about as long. */
function claimsOf(text: string, minimum: number) {
  return text.split("\n").filter((line) => characterLength(line) >= minimum);
}

const CVS: Record<RubricLanguage, string> = {
  en: read("../lib/cv/test/synthetic-en-cv.txt"),
  ja: [read("../lib/cv/test/synthetic-ja-rirekisho.txt"), read("../lib/cv/test/synthetic-ja-shokumu.txt")].join("\n"),
};
const CLAIMS: Record<RubricLanguage, string[]> = {
  en: claimsOf(CVS.en, 60),
  ja: claimsOf(CVS.ja, 20),
};

const POSTINGS: Record<RubricLanguage, GenerationRoleContext> = {
  en: { kind: "posting", companyName: "Tidewater Logistics Systems", roleTitle: "Senior Backend Engineer, Routing Platform", body: read("../lib/round/test/synthetic-posting-en.txt") },
  ja: { kind: "posting", companyName: "株式会社サンプル物流システムズ", roleTitle: "バックエンドエンジニア", body: read("../lib/round/test/synthetic-posting-ja.txt") },
};

interface Exchange {
  readonly prompt: string;
  readonly answer: string;
  readonly followUp: { readonly prompt: string; readonly answer: string };
}

// Invented answers, spoken-length and imperfect, each with one thing in it the invented CV does not
// hold — what the marks are for. No one's answers.
const ROUNDS: Record<RubricLanguage, Exchange[]> = {
  en: [
    {
      prompt: "Tell me about a time you had to make a system more reliable. What did you do?",
      answer:
        "Um, so at my last job we had this service that kept falling over, and, like, I was the one who got paged most. So I, uh, I started looking at why. It turned out the retries were piling up when a downstream thing was slow. I added a queue in front of it and, um, some backoff, and it got a lot better. I think the pages went down by, like, half? And I also wrote a runbook so the other three people on the rota could handle it. Yeah. That's basically it.",
      followUp: {
        prompt: "How did you measure that the pages went down by half?",
        answer: "Uh, I just looked at the on-call tool, the count per week before and after. It was about twenty a week before and around ten after, over, um, a couple of months.",
      },
    },
    {
      prompt: "Why do you want this role?",
      answer:
        "I've been doing backend work for a while and I want something bigger. Your posting talks about routing, and I think that's interesting, um, because it's a hard problem. I like hard problems. And I've heard the team is good. I also want to work somewhere where I can, you know, own a thing end to end, which I haven't really had so far, except for one internal tool I built on my own.",
      followUp: {
        prompt: "What was the internal tool you built on your own?",
        answer: "It was a little dashboard for the support team, so they could see where a shipment was stuck without asking us. I built it in about two weeks and, um, they still use it.",
      },
    },
    {
      prompt: "Describe a disagreement with a colleague about a technical decision. How did it end?",
      answer:
        "So there was this one time, a colleague wanted to rewrite our importer in a new language, and I thought, no, that's too much. We argued a bit in the pull request, which, um, wasn't great. Then I suggested we just measure where the time went, and it was mostly the database, not the language. So we fixed two queries instead. He was fine with it in the end. I think I should have talked to him directly first, instead of in the review, honestly.",
      followUp: {
        prompt: "What did fixing the two queries change?",
        answer: "The import went from about forty minutes to, um, around twelve, I think. So nobody asked about the rewrite again.",
      },
    },
  ],
  ja: [
    {
      prompt: "これまでで最も困難だった業務と、どのように対応したかを教えてください。",
      answer:
        "えー、前職で、配送管理のシステムの移行を担当したんですけど、あのー、古いシステムの仕様書がほとんどなくて、それが一番大変でした。で、まず現場の人に話を聞いて、実際の動きを一つずつ確認していきました。それから、えっと、新旧のシステムを並行で動かして、結果を比べるっていうことをやりました。3か月くらいかかりましたが、大きな障害なく切り替えられました。5人のチームで、私が取りまとめをしていました。",
      followUp: {
        prompt: "新旧のシステムを並行で動かした際、結果の違いはどのように確認されたのですか。",
        answer: "えー、毎晩、両方の出力をファイルに出して、差分を取るスクリプトを書きました。違いが出たら、次の日の朝に原因を調べる、という流れでした。最初は1日に20件くらい差分が出ていました。",
      },
    },
    {
      prompt: "当社を志望された理由をお聞かせください。",
      answer:
        "はい、御社は物流のシステムを自社で開発されていて、そこに魅力を感じました。私はこれまでバックエンドの開発をやってきたので、その経験を活かせると思っています。あと、えっと、求人票に書いてあった配送ルートの最適化っていうのに興味があります。前の会社では、そういう難しい問題に取り組む機会があまりなかったので、挑戦したいと思いました。",
      followUp: {
        prompt: "これまでのバックエンド開発の経験のうち、当社で特に活かせるとお考えのものは何ですか。",
        answer: "そうですね、あのー、大量のデータを扱うバッチ処理の経験だと思います。前職で、夜間のバッチの処理時間を半分くらいにしたことがあります。",
      },
    },
  ],
};

const RUBRICS = { en: EN_1_0, ja: JA_1_0 };

function inputsOf(language: RubricLanguage): ModelAnswerInput[] {
  const shared = { rubric: RUBRICS[language], roundType: "behavioural" as const, roleContext: POSTINGS[language], claims: CLAIMS[language] };
  return ROUNDS[language].flatMap((exchange) => [
    { ...shared, prompt: exchange.prompt, answer: exchange.answer, parent: null },
    { ...shared, prompt: exchange.followUp.prompt, answer: exchange.followUp.answer, parent: { prompt: exchange.prompt, answer: exchange.answer } },
  ]);
}

interface Sample {
  readonly ms: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly units: number;
}
const samples: Record<string, Sample[]> = {};
const roundMs: Record<string, number[]> = {};
const counts: Record<string, number> = {};
function count(name: string, by: number) {
  counts[name] = (counts[name] ?? 0) + by;
}

function record(language: RubricLanguage, input: ModelAnswerInput, result: ModelAnswerResult, ms: number) {
  const job = `${language}, ${input.parent ? "follow-up" : "question"}`;
  (samples[job] ??= []).push({ ms, tokensIn: result.tokensIn ?? 0, tokensOut: result.tokensOut ?? 0, units: paceUnits(language, result.answer) });
  const evidence = [input.answer, input.parent?.answer ?? ""].join("\n");
  const own = locatedModelAnswer(result, CVS[language], evidence);
  count(`${language}: marks kept`, own.spans.length);
  count(`${language}: marks dropped`, own.dropped);
  if (result.translated) {
    const translated = locatedModelAnswer(result.translated, CVS[language], evidence);
    count(`${language}: translation's marks kept`, translated.spans.length);
    count(`${language}: translation's marks dropped`, translated.dropped);
  }
}

function show(input: ModelAnswerInput, result: ModelAnswerResult) {
  const marks = (text: { answer: string; unsupported: readonly { quote: string }[] }) => text.unsupported.map((mark) => JSON.stringify(mark.quote)).join(" ");
  console.log(`\n--- ${input.parent ? "follow-up" : "question"}: ${input.prompt}\n${result.answer}\nmarked: ${marks(result) || "(nothing)"}`);
  if (result.translated) console.log(`\n${result.translated.answer}\nmarked: ${marks(result.translated) || "(nothing)"}`);
}

console.log(`Measuring ${RUNS} round(s) per language: ${MODEL_ANSWER_MODEL}.`);
for (const language of LANGUAGES) {
  const inputs = inputsOf(language);
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now();
    const outcomes = await Promise.allSettled(
      inputs.map(async (input) => {
        const callStarted = performance.now();
        const result = await generator.generate(input);
        record(language, input, result, performance.now() - callStarted);
        return result;
      }),
    );
    (roundMs[`${language}, a round of ${inputs.length} calls`] ??= []).push(performance.now() - started);
    outcomes.forEach((outcome, index) => {
      if (outcome.status === "rejected") count(`${language}: calls failed (${(outcome.reason as { errorClass?: string }).errorClass ?? "unexpected"})`, 1);
      else if (SHOW && run === 0) show(inputs[index], outcome.value);
    });
  }
}

function quantile(sorted: number[], q: number) {
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  return sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low);
}
const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const median = (values: number[]) => quantile([...values].sort((a, b) => a - b), 0.5);

console.log("\n| Job | n | median | p90 | slowest | tokens in / out (median) | length (median) |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const [job, rows] of Object.entries(samples)) {
  const sorted = rows.map((row) => row.ms).sort((a, b) => a - b);
  const unit = job.startsWith("ja") ? "字" : "words";
  console.log(
    `| ${job} | ${rows.length} | ${s(quantile(sorted, 0.5))} | ${s(quantile(sorted, 0.9))} | ${s(sorted.at(-1)!)} | ${median(rows.map((row) => row.tokensIn)).toFixed(0)} / ${median(rows.map((row) => row.tokensOut)).toFixed(0)} | ${median(rows.map((row) => row.units)).toFixed(0)} ${unit} |`,
  );
}
for (const [job, values] of Object.entries(roundMs)) {
  const sorted = [...values].sort((a, b) => a - b);
  console.log(`| ${job} | ${sorted.length} | ${s(quantile(sorted, 0.5))} | ${s(quantile(sorted, 0.9))} | ${s(sorted.at(-1)!)} | — | — |`);
}

console.log("\nTokens per round, summed over its calls (median of the runs' calls × calls per round):");
for (const language of LANGUAGES) {
  const rows = Object.entries(samples).filter(([job]) => job.startsWith(language)).flatMap(([, values]) => values);
  const perRound = (pick: (row: Sample) => number) => Math.round((rows.reduce((sum, row) => sum + pick(row), 0) / rows.length) * inputsOf(language).length);
  console.log(`- ${language}: ${perRound((row) => row.tokensIn)} in / ${perRound((row) => row.tokensOut)} out, ${CLAIMS[language].length} claims`);
}

console.log("\nThe marks, as the server would store them:");
for (const [name, value] of Object.entries(counts)) console.log(`- ${name}: ${value}`);
