import { roundDeps } from "@/lib/round/deps";
import { createTypedTranscript } from "@/lib/round/typed-transcript";

export async function POST(request: Request, context: RouteContext<"/api/answers/[answerId]/transcript">) {
  const { answerId } = await context.params;
  return createTypedTranscript(roundDeps())(request, answerId);
}
