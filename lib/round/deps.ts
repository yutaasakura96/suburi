import { after } from "next/server";
import { openAiEmbedder } from "../ai/embed";
import { openAiQuestionGenerator } from "../ai/generate-questions";
import { openAiFollowUpGenerator } from "../ai/follow-up";
import { openAiModelHealth } from "../ai/health";
import { openAiRoundFeedbackGenerator } from "../ai/round-feedback";
import { openAiAnswerScorer } from "../ai/score";
import { openAiTranscriber } from "../ai/transcribe";
import { openAiSpeechSynthesizer } from "../ai/tts";
import { s3AudioStore } from "../audio/store";
import { getAuth } from "../auth";
import { getConfig } from "../config";
import { getDb } from "../db";

/**
 * The round routes' real dependencies: the pinned models behind their ports, the audio bucket, the
 * pooled database. Every route file is this plus one factory, so the handlers stay testable with fakes.
 */
export const ROUTE_MAX_DURATION_SECONDS = 300;

/** Finished before Hobby's ceiling, with a margin for the response and the last write (07 §5.10). */
export function invocationDeadline(started = Date.now()) {
  return started + (ROUTE_MAX_DURATION_SECONDS - 15) * 1000;
}

export function roundDeps() {
  const db = getDb();
  const config = getConfig();
  const openAi = { apiKey: config.OPENAI_API_KEY, baseURL: config.OPENAI_BASE_URL };
  return {
    auth: getAuth(),
    db,
    transaction: <T,>(work: (tx: typeof db) => Promise<T>) => db.transaction((tx) => work(tx as unknown as typeof db)),
    health: openAiModelHealth(openAi),
    scorer: openAiAnswerScorer(openAi),
    transcriber: openAiTranscriber(openAi),
    generator: openAiRoundFeedbackGenerator(openAi),
    speech: openAiSpeechSynthesizer(openAi),
    questionGenerator: openAiQuestionGenerator(openAi),
    embedder: openAiEmbedder(openAi),
    followUpGenerator: openAiFollowUpGenerator(openAi),
    store: s3AudioStore({
      region: config.AWS_REGION,
      bucket: config.S3_BUCKET,
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      endpoint: config.S3_ENDPOINT,
    }),
    prefix: config.S3_PREFIX,
    after,
  };
}
