import { createComplete } from "@/lib/round/complete";
import { roundDeps } from "@/lib/round/deps";

// The bounded wait and the feedback call share this one budget (07 §5.12).
// A literal, as Next requires of segment config; lib/round/deps.ts holds the same number for the deadline.
export const maxDuration = 300;

export async function POST(request: Request, context: RouteContext<"/api/rounds/[roundId]/complete">) {
  const { roundId } = await context.params;
  return createComplete(roundDeps())(request, roundId);
}
