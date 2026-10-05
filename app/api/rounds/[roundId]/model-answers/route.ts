import { roundDeps } from "@/lib/round/deps";
import { createModelAnswersRetry } from "@/lib/round/model-answers";

// A literal, as Next requires of segment config; lib/round/deps.ts holds the same number for the deadline.
export const maxDuration = 300;

export async function POST(request: Request, context: RouteContext<"/api/rounds/[roundId]/model-answers">) {
  const { roundId } = await context.params;
  return createModelAnswersRetry(roundDeps())(request, roundId);
}
