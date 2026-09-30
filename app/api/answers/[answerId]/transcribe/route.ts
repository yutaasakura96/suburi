import { roundDeps } from "@/lib/round/deps";
import { createTranscribe } from "@/lib/round/transcribe";

// A literal, as Next requires of segment config; lib/round/deps.ts holds the same number for the deadline.
export const maxDuration = 300;

export async function POST(request: Request, context: RouteContext<"/api/answers/[answerId]/transcribe">) {
  const { answerId } = await context.params;
  return createTranscribe(roundDeps())(request, answerId);
}
