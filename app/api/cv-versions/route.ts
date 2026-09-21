import { openAiCvClaimExtractor } from "@/lib/ai/extract-cv-claims";
import { getAuth } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { createPostCvVersion } from "@/lib/cv/post-cv-version";
import { getDb } from "@/lib/db";

// One synchronous model call (07 §5.2). Hobby's ceiling, which is also its default (CONTEXT.md).
export const maxDuration = 300;

export function POST(request: Request) {
  const db = getDb();
  const config = getConfig();
  return createPostCvVersion({
    auth: getAuth(),
    db,
    transaction: (work) => db.transaction((tx) => work(tx)),
    extractor: openAiCvClaimExtractor({
      apiKey: config.OPENAI_API_KEY,
      baseURL: config.OPENAI_BASE_URL,
    }),
  })(request);
}
