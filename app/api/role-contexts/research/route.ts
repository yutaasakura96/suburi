import { roundDeps } from "@/lib/round/deps";
import { createResearch } from "@/lib/round/research";

// A literal, as Next requires of segment config; the research call is bounded well inside it (07 §5.22).
export const maxDuration = 300;

export function POST(request: Request) {
  return createResearch(roundDeps())(request);
}
