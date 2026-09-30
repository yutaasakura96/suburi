import { createFeedbackRetry } from "@/lib/round/complete";
import { roundDeps, ROUTE_MAX_DURATION_SECONDS } from "@/lib/round/deps";

export const maxDuration = ROUTE_MAX_DURATION_SECONDS;

export async function POST(request: Request, context: RouteContext<"/api/rounds/[roundId]/feedback">) {
  const { roundId } = await context.params;
  return createFeedbackRetry(roundDeps())(request, roundId);
}
