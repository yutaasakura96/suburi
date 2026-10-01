import { roundDeps } from "@/lib/round/deps";
import { createPostRound } from "@/lib/round/post-round";

// A literal, as Next requires of segment config; lib/round/deps.ts holds the same number for the deadline.
export const maxDuration = 300;

export function POST(request: Request) {
  return createPostRound(roundDeps())(request);
}
