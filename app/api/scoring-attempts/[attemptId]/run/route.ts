import { invocationDeadline, roundDeps } from "@/lib/round/deps";
import { createRunScoringAttempt } from "@/lib/round/scoring-attempts";

// The run and its retries share this invocation's 300 s (07 §5.10).
// A literal, as Next requires of segment config; lib/round/deps.ts holds the same number for the deadline.
export const maxDuration = 300;

export async function POST(request: Request, context: RouteContext<"/api/scoring-attempts/[attemptId]/run">) {
  const started = Date.now();
  const { attemptId } = await context.params;
  return createRunScoringAttempt({ ...roundDeps(), deadline: () => invocationDeadline(started) })(request, attemptId);
}
