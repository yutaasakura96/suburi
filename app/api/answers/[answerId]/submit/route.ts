import { invocationDeadline, roundDeps, ROUTE_MAX_DURATION_SECONDS } from "@/lib/round/deps";
import { createSubmit } from "@/lib/round/submit";

// The scoring scheduled in after() shares this invocation's 300 s with the submit itself (07 §5.10).
export const maxDuration = ROUTE_MAX_DURATION_SECONDS;

export async function POST(request: Request, context: RouteContext<"/api/answers/[answerId]/submit">) {
  const started = Date.now();
  const { answerId } = await context.params;
  return createSubmit({ ...roundDeps(), deadline: () => invocationDeadline(started) })(request, answerId);
}
