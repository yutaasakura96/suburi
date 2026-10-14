import { drizzle } from "drizzle-orm/node-postgres";
import { openAiQuestionTranslator } from "../lib/ai/translate-question.ts";
import { getConfig } from "../lib/config.ts";
import { translateQuestions } from "../lib/questions/translate-questions.ts";

// Hand-run, against one database at a time, like the seed (12 §1): `npm run questions:translate`
// writes an English for every Japanese bank question that has none, and
// `npm run questions:translate -- --rewrite <question id>` writes a new one beside the old for that
// one question. **Never at round time, and never on a deploy**; against Neon `main` only by the
// owner. One `translate-question-en-1.0` call per question, its tokens stored on its row. It never
// touches `questions`. Logs ids, counts and error classes — never a question or its English.

const args = process.argv.slice(2);
let rewrite: string | null = null;
if (args.length > 0) {
  if (args.length !== 2 || args[0] !== "--rewrite" || !/^[0-9a-f-]{36}$/iu.test(args[1])) {
    console.error("Usage: translate-questions [--rewrite <question id>]");
    process.exit(2);
  }
  rewrite = args[1];
}

const { DATABASE_URL_UNPOOLED, OPENAI_API_KEY } = getConfig();
const db = drizzle(DATABASE_URL_UNPOOLED);

try {
  const run = await translateQuestions(db, openAiQuestionTranslator({ apiKey: OPENAI_API_KEY }), { rewrite }, (event) =>
    console.log(JSON.stringify(event)),
  );
  console.log(`Wrote ${run.written} English(es); ${run.failed} call(s) failed.`);
  if (run.failed > 0) process.exitCode = 1;
} finally {
  await db.$client.end();
}
