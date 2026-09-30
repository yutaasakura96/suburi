import { roundDeps, ROUTE_MAX_DURATION_SECONDS } from "@/lib/round/deps";
import { createPostRound } from "@/lib/round/post-round";

export const maxDuration = ROUTE_MAX_DURATION_SECONDS;

export function POST(request: Request) {
  return createPostRound(roundDeps())(request);
}
