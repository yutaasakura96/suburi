import { getConfig } from "@/lib/config";

// Runs once before the server handles a request: a missing or malformed variable
// stops the boot instead of surfacing later as a default.
export function register() {
  getConfig();
}
