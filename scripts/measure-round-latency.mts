import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { SCORING_MODEL, TRANSCRIPTION_MODEL } from "../lib/ai/models.ts";
import { openAiRoundFeedbackGenerator } from "../lib/ai/round-feedback.ts";
import { openAiAnswerScorer } from "../lib/ai/score.ts";
import { openAiTranscriber } from "../lib/ai/transcribe.ts";
import { openAiClient } from "../lib/ai/upstream.ts";
import { pace } from "../lib/round/measures.ts";
import { EN_1_0 } from "../lib/rubric/en-1.0.ts";

// The round loop's model latencies (#42, 03 §4, 06 2026-09-27), measured against OpenAI with synthetic
// answers — the way #20 measured CV extraction. Hand-run, never in CI:
//
//   OPENAI_API_KEY=… node --import ./scripts/resolve-ts.mts scripts/measure-round-latency.mts
//
// Scoring and round feedback run through the real ports and prompts. Follow-up and question
// generation have no port yet (#44, #47), so they run **draft** prompts below, of the size the real
// ones will have; a draft is not a prompt version and nothing here is stored. Transcription reads a
// take synthesised by TTS and re-encoded to webm/opus by ffmpeg, the browser's format. TTS is timed
// to the first audio byte (when playback can start) and to the last.
//
// Prints timings, token counts and counts only — never a prompt, an answer or a model's output.

const RUNS = Number(process.env.RUNS ?? 5);
const TTS_MODEL = "gpt-4o-mini-tts-2025-12-15"; // measured, not pinned: #45 pins the speech model
const EMBEDDING_MODEL = "text-embedding-3-small";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
const client = openAiClient({ apiKey });

// Three synthetic answers at the lengths a realistic round produces: about one, two and three and a
// half minutes spoken at ~140 wpm. Invented, and no one's CV.
const ANSWERS = [
  {
    prompt: "Could you start by introducing yourself?",
    text: `Sure. I'm a backend engineer with about eight years of experience, mostly in payments. I started at a small logistics company, um, where I built the invoicing service from scratch, and then I moved to a payments provider where I've been for the last five years. There I led the migration of our settlement system from a nightly batch to an event-driven design, which cut the time for a merchant to see their money from two days to about four hours. I like work where correctness matters and the numbers have to add up. Outside of work I, uh, I mentor two junior engineers and I write about database migrations. I'm looking for a role where I can own a system end to end and help a team grow.`,
  },
  {
    prompt: "Tell me about a time you disagreed with your manager. What did you do?",
    text: `Last year my manager wanted to ship a new refunds flow before the holiday freeze. I thought it was too risky, because our reconciliation job didn't yet handle partial refunds, and if we shipped, finance would have to fix mismatches by hand during our busiest weeks. So, um, instead of just saying no, I pulled the data. I found that about three percent of refunds in the previous quarter were partial, which at holiday volume would have meant roughly four thousand manual corrections. I wrote a one-page note with that number, two options, and what each would cost. Option one was to ship on time with a manual workaround and a dedicated person from finance. Option two was to ship two weeks after the freeze with reconciliation support. My manager was, well, not happy at first, because the date had been promised to sales. We talked it through, and she took the note to her director. In the end we shipped a smaller version before the freeze, full refunds only, and the partial refunds after. There were zero manual corrections. What I learned is that a disagreement goes better when it is about a number both sides can check, not about who is more careful. I also learned to raise it earlier; if I had pulled that data a month before, the conversation would have been much easier, and sales would not have heard a date we then had to change.`,
  },
  {
    prompt: "How do you decide what to work on when everything is urgent?",
    text: `I start by asking what happens if each thing waits a week. Usually most urgent things are urgent to one person, and only one or two are urgent to the business. So, um, I write the list down, and next to each item I write who is waiting, what it costs them per day, and whether anything gets worse over time, like data that gets harder to fix. Then I sort by that. For example, in my current team we once had, at the same time, a failing partner integration, a security patch, a sales demo, and a performance problem on the checkout page. The security patch went first, because the risk grew every day it waited. The partner integration was second, because it was losing us transactions, about two hundred an hour. The checkout performance problem looked urgent, but when I measured it, it only affected one browser version with a tiny share of traffic, so it waited. For the demo, I asked sales what they really needed, and it turned out a recorded video from staging was fine, which took one hour instead of two days. After that week, I proposed we keep a short, shared list with those three columns, so the next time the team would not need me to sort it. We still use it. I think the key is, uh, to make the cost of waiting visible, so the decision is not about who shouts the loudest. And I tell people early when their item is going to wait, and why, so they can plan around it rather than finding out at the deadline. Sometimes the answer changes when someone brings a cost I didn't know about, and that's fine; the list is there so that we can change it for a reason. The last thing I do is protect a little time for the work nobody calls urgent, like the monitoring gaps, because those are usually what makes next month's list so long.`,
  },
];

function spokenMs(text: string) {
  return (text.split(/\s+/u).length / 140) * 60_000;
}

const timings: Record<string, number[]> = {};
const tokens: Record<string, { in: number; out: number }[]> = {};

async function timed<T>(job: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await work();
  } finally {
    (timings[job] ??= []).push(performance.now() - started);
  }
}

function recordTokens(job: string, tokensIn: number | null | undefined, tokensOut: number | null | undefined) {
  (tokens[job] ??= []).push({ in: tokensIn ?? 0, out: tokensOut ?? 0 });
}

function quantile(sorted: number[], q: number) {
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  return sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low);
}

// --- Draft prompts (no port yet) -------------------------------------------------------------------

const DRAFT_FOLLOW_UP = `You are the interviewer in a job-interview practice round, in English. You receive the question you
asked and the candidate's answer. Ask exactly one follow-up question that digs into the weakest or
vaguest part of the answer: a missing number, an unclear role, a claim without an example. One
sentence, at most 30 words, spoken naturally. Do not evaluate the answer.`;

const DRAFT_QUESTIONS = `You write interview questions for a candidate practising job interviews in English. You receive the
round type and how many questions are needed. Write that many distinct questions a real interviewer of
that type would ask, each one sentence, answerable in two to four minutes, none a yes/no question, and
none repeating another's topic. Vary them: experience, judgement, conflict, learning, motivation.`;

async function followUp(answer: (typeof ANSWERS)[number]) {
  const response = await client.responses.parse({
    model: SCORING_MODEL,
    instructions: DRAFT_FOLLOW_UP,
    input: `Question: ${answer.prompt}\n\nAnswer:\n${answer.text}`,
    text: { format: zodTextFormat(z.object({ follow_up: z.string() }), "follow_up") },
  });
  recordTokens("follow-up generation (draft)", response.usage?.input_tokens, response.usage?.output_tokens);
}

async function questions(count: number) {
  const response = await client.responses.parse({
    model: SCORING_MODEL,
    instructions: DRAFT_QUESTIONS,
    input: `Round type: HR (culture fit, motivation, how the candidate works with others).\nQuestions needed: ${count}.`,
    text: { format: zodTextFormat(z.object({ questions: z.array(z.object({ body: z.string() })) }), "questions") },
  });
  recordTokens(`question generation, ${count} (draft)`, response.usage?.input_tokens, response.usage?.output_tokens);
  return response.output_parsed?.questions.map((question) => question.body) ?? [];
}

// --- The measured jobs ------------------------------------------------------------------------------

const scorer = openAiAnswerScorer({ apiKey });
const generator = openAiRoundFeedbackGenerator({ apiKey });
const transcriber = openAiTranscriber({ apiKey });

async function measureScoring() {
  const scored = [];
  for (let run = 0; run < RUNS; run += 1) {
    for (const answer of ANSWERS) {
      const durationMs = spokenMs(answer.text);
      const result = await timed("answer scoring", () =>
        scorer.score({ rubric: EN_1_0, prompt: answer.prompt, answer: answer.text, durationMs, pace: pace("en", answer.text, durationMs) }),
      );
      recordTokens("answer scoring", result.tokensIn, result.tokensOut);
      if (run === 0) scored.push(result.scores.map((score) => ({ dimension: score.dimension, value: score.value })));
    }
  }
  return scored;
}

async function measureFeedback(scored: { dimension: string; value: number }[][]) {
  for (let run = 0; run < RUNS; run += 1) {
    const result = await timed("round feedback", () =>
      generator.generate({
        rubric: EN_1_0,
        answers: ANSWERS.map((answer, index) => {
          const durationMs = spokenMs(answer.text);
          return {
            position: index + 1,
            prompt: answer.prompt,
            answer: answer.text,
            durationMs,
            pace: pace("en", answer.text, durationMs),
            scores: scored[index],
          };
        }),
      }),
    );
    recordTokens("round feedback", result.tokensIn, result.tokensOut);
  }
}

async function measureGeneration() {
  for (let run = 0; run < RUNS; run += 1) {
    for (const answer of ANSWERS) await timed("follow-up generation (draft)", () => followUp(answer));
    for (const count of [3, 7]) {
      const bodies = await timed(`question generation, ${count} (draft)`, () => questions(count));
      if (bodies.length > 0) {
        await timed(`embeddings, ${count} questions`, () => client.embeddings.create({ model: EMBEDDING_MODEL, input: bodies }));
      }
    }
  }
}

/** TTS: first byte (when playback could start) and the whole of it, for a question-length text. */
async function measureSpeech() {
  for (let run = 0; run < RUNS; run += 1) {
    const started = performance.now();
    const response = await client.audio.speech.create({
      model: TTS_MODEL,
      voice: "marin",
      input: ANSWERS[run % ANSWERS.length].prompt,
      response_format: "mp3",
    });
    const reader = response.body!.getReader();
    let first: number | null = null;
    for (;;) {
      const { done } = await reader.read();
      first ??= performance.now() - started;
      if (done) break;
    }
    (timings["TTS, question, first byte"] ??= []).push(first);
    (timings["TTS, question, whole"] ??= []).push(performance.now() - started);
  }
}

/** One take per answer, spoken by TTS and re-encoded as the browser records it, then transcribed. */
async function measureTranscription() {
  const dir = mkdtempSync(join(tmpdir(), "suburi-latency-"));
  try {
    const takes: { audio: Uint8Array; seconds: number }[] = [];
    // TTS speaks faster than a candidate, so the three answers run together make the near-cap take.
    const texts = [...ANSWERS.map((answer) => answer.text), ANSWERS.map((answer) => answer.text).join(" ")];
    for (const [index, text] of texts.entries()) {
      const speech = await client.audio.speech.create({ model: TTS_MODEL, voice: "cedar", input: text, response_format: "wav" });
      const wav = join(dir, `${index}.wav`);
      const webm = join(dir, `${index}.webm`);
      writeFileSync(wav, Buffer.from(await speech.arrayBuffer()));
      execFileSync("ffmpeg", ["-loglevel", "error", "-i", wav, "-c:a", "libopus", "-b:a", "32k", webm]);
      const seconds = Number(
        execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav]).toString().trim(),
      );
      takes.push({ audio: new Uint8Array(readFileSync(webm)), seconds });
    }
    for (let run = 0; run < RUNS; run += 1) {
      for (const take of takes) {
        const job = `transcription, ${Math.round(take.seconds)} s take`;
        await timed(job, () => transcriber.transcribe({ audio: take.audio, contentType: "audio/webm", language: "en" }));
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`Measuring ${RUNS} run(s) of each: ${SCORING_MODEL}, ${TRANSCRIPTION_MODEL}, ${TTS_MODEL}, ${EMBEDDING_MODEL}.`);
const scored = await measureScoring();
await measureFeedback(scored);
await measureGeneration();
await measureSpeech();
await measureTranscription();

console.log("\n| Job | n | min | median | p90 | max | tokens in / out (median) |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const [job, values] of Object.entries(timings)) {
  const sorted = [...values].sort((a, b) => a - b);
  const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const counts = tokens[job];
  const median = (key: "in" | "out") => (counts ? quantile(counts.map((c) => c[key]).sort((a, b) => a - b), 0.5).toFixed(0) : "");
  console.log(
    `| ${job} | ${sorted.length} | ${s(sorted[0])} | ${s(quantile(sorted, 0.5))} | ${s(quantile(sorted, 0.9))} | ${s(sorted.at(-1)!)} | ${counts ? `${median("in")} / ${median("out")}` : "—"} |`,
  );
}
