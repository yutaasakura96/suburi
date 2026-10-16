import { roundDeps } from "@/lib/round/deps";
import { createEnglishReading } from "@/lib/round/english-reading";

export async function POST(request: Request, context: RouteContext<"/api/answers/[answerId]/english-reading">) {
  const { answerId } = await context.params;
  return createEnglishReading(roundDeps())(request, answerId);
}
