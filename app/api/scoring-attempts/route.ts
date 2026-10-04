import { roundDeps } from "@/lib/round/deps";
import { createPostScoringAttempt } from "@/lib/round/scoring-attempts";

export function POST(request: Request) {
  return createPostScoringAttempt(roundDeps())(request);
}
