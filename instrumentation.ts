import * as Sentry from "@sentry/nextjs";
import { getConfig, nextRuntime } from "@/lib/config";

// Runs once before the server handles a request: a missing or malformed variable
// stops the boot instead of surfacing later as a default.
export async function register() {
  getConfig();
  if (nextRuntime() === "nodejs") await import("./sentry.server.config");
  if (nextRuntime() === "edge") await import("./sentry.edge.config");
}

// Errors thrown by Server Components, route handlers and the proxy. A no-op while Sentry is off.
export const onRequestError = Sentry.captureRequestError;
