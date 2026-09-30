import { roundDeps, ROUTE_MAX_DURATION_SECONDS } from "@/lib/round/deps";
import { createTranscribe } from "@/lib/round/transcribe";

export const maxDuration = ROUTE_MAX_DURATION_SECONDS;

export async function POST(request: Request, context: RouteContext<"/api/answers/[answerId]/transcribe">) {
  const { answerId } = await context.params;
  return createTranscribe(roundDeps())(request, answerId);
}
