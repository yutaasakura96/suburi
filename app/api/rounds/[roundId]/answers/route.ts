import { roundDeps } from "@/lib/round/deps";
import { createOpenAnswer } from "@/lib/round/open-answer";

export async function POST(request: Request, context: RouteContext<"/api/rounds/[roundId]/answers">) {
  const { roundId } = await context.params;
  return createOpenAnswer(roundDeps())(request, roundId);
}
