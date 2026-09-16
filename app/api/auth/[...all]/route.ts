import { getAuth } from "@/lib/auth";

// Better Auth's catch-all (08 §5). Its own routes are public in the proxy.
function handle(request: Request) {
  return getAuth().handler(request);
}

export { handle as GET, handle as POST };
