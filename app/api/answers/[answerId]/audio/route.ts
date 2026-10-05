import { createGetAnswerAudio } from "@/lib/round/answer-audio";
import { roundDeps } from "@/lib/round/deps";

export async function GET(request: Request, context: RouteContext<"/api/answers/[answerId]/audio">) {
  const { answerId } = await context.params;
  return createGetAnswerAudio(roundDeps())(request, answerId);
}
