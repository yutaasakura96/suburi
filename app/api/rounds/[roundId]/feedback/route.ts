import { createFeedbackRetry } from "@/lib/round/complete";
import { roundDeps } from "@/lib/round/deps";

// A literal, as Next requires of segment config; lib/round/deps.ts holds the same number for the deadline.
export const maxDuration = 300;

export async function POST(request: Request, context: RouteContext<"/api/rounds/[roundId]/feedback">) {
  const { roundId } = await context.params;
  return createFeedbackRetry(roundDeps())(request, roundId);
}
