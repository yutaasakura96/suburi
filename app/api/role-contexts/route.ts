import { roundDeps } from "@/lib/round/deps";
import { createPostRoleContext } from "@/lib/round/role-context";

export function POST(request: Request) {
  return createPostRoleContext(roundDeps())(request);
}
