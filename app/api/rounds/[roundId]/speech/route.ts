import { roundDeps } from "@/lib/round/deps";
import { createSpeech } from "@/lib/round/speech";

export async function GET(request: Request, context: RouteContext<"/api/rounds/[roundId]/speech">) {
  const { roundId } = await context.params;
  return createSpeech(roundDeps())(request, roundId);
}
