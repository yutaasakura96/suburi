import { roundDeps } from "@/lib/round/deps";
import { createGetRound } from "@/lib/round/get-round";

export async function GET(request: Request, context: RouteContext<"/api/rounds/[roundId]">) {
  const { roundId } = await context.params;
  return createGetRound(roundDeps())(request, roundId);
}
