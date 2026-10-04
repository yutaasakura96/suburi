import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TTS_MODEL, TTS_VOICE } from "../lib/ai/models.ts";
import { openAiSpeechSynthesizer, type SpeechInput } from "../lib/ai/tts.ts";

// 11 §5's ear check, made listenable (#45): whether the pinned speech model pronounces a question
// correctly — 役職 and company names included, in both languages — is a judgement only an ear makes
// (11 §9). Hand-run, never in CI:
//
//   OPENAI_API_KEY=… npm run ear-check
//
// It speaks the synthetic questions below through the real port (`lib/ai/tts.ts`), so what is heard
// is exactly what a realistic round plays, and writes each as an MP3 beside one page that lists the
// text next to its player. Open `private/ear-check/index.html` and listen. Nothing here is a real
// question from a real round: the samples are invented, and `/private/` is gitignored.
//
// Prints file names, sizes and timings only.

const SAMPLES: readonly SpeechInput[] = [
  { language: "en", text: "Could you start by introducing yourself?" },
  { language: "en", text: "You were an engineering manager at Mitsubishi UFJ Bank. What did you change in your first ninety days?" },
  { language: "en", text: "Why do you want to move from Toyota Motor Corporation to a role as Principal Engineer here?" },
  { language: "en", text: "As Deputy General Manager at Hitachi, how did you handle a disagreement with the Chief Technology Officer?" },
  { language: "ja", text: "まず、簡単に自己紹介をお願いします。" },
  { language: "ja", text: "前職の株式会社日立製作所では、主任としてどのような業務を担当されていましたか。" },
  { language: "ja", text: "課長代理に昇進された際、部下の育成で最も苦労されたことは何ですか。" },
  { language: "ja", text: "トヨタ自動車から楽天グループへ転職された理由をお聞かせください。" },
  { language: "ja", text: "三菱UFJ銀行向けの決済基盤の刷新で、プロジェクトマネージャーとして下した最も難しい判断は何でしたか。" },
  { language: "ja", text: "弊社の執行役員や部長と意見が分かれたとき、どのように合意形成を進めますか。" },
];

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("ear-check needs OPENAI_API_KEY.");
  process.exit(1);
}

const dir = resolve("private/ear-check");
mkdirSync(dir, { recursive: true });
const speech = openAiSpeechSynthesizer({ apiKey });
console.log(`Speaking ${SAMPLES.length} sample question(s) with ${TTS_MODEL}, voice ${TTS_VOICE}.`);

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const rows: string[] = [];
for (const [index, sample] of SAMPLES.entries()) {
  const file = `${sample.language}-${index + 1}.mp3`;
  const started = performance.now();
  const audio = new Uint8Array(await new Response(await speech.synthesize(sample)).arrayBuffer());
  writeFileSync(join(dir, file), audio);
  console.log(`${file}: ${audio.byteLength} bytes in ${Math.round(performance.now() - started)} ms`);
  rows.push(`<li lang="${sample.language}"><p>${escape(sample.text)}</p><audio controls preload="none" src="${file}"></audio></li>`);
}

writeFileSync(
  join(dir, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Suburi ear check</title>
<style>body{font:15px/1.8 system-ui;max-width:760px;margin:40px auto}li{margin-bottom:22px}p{margin:0 0 6px}</style>
<h1>Ear check: ${TTS_MODEL}, voice ${TTS_VOICE}</h1>
<p>Play each one and read along. Is every word said as written, 役職 and company names included?</p>
<ol>${rows.join("")}</ol>\n`,
);
console.log(`Open ${join(dir, "index.html")}`);
