import { createComplete } from "@/lib/round/complete";
import { roundDeps, ROUTE_MAX_DURATION_SECONDS } from "@/lib/round/deps";

// The bounded wait and the feedback call share this one budget (07 §5.12).
export const maxDuration = ROUTE_MAX_DURATION_SECONDS;

export async function POST(request: Request, context: RouteContext<"/api/rounds/[roundId]/complete">) {
  const { roundId } = await context.params;
  return createComplete(roundDeps())(request, roundId);
}
