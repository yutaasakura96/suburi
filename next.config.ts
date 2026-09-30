import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { getSentryConfig } from "./lib/config";

// Build time: production and the develop branch's preview carry both Sentry variables; everywhere
// else Sentry is off and no source map is generated at all (12 §1, §7).
const sentry = getSentryConfig();

const nextConfig: NextConfig = {
  // next dev would otherwise write AGENTS.md and a block into CLAUDE.md (06, "No AGENTS.md").
  agentRules: false,
  // Read by instrumentation-client.ts. Empty strings when Sentry is off, so the browser never inits.
  env: {
    SENTRY_BROWSER_DSN: sentry?.dsn ?? "",
    SENTRY_BROWSER_ENVIRONMENT: sentry?.environment ?? "",
  },
};

export default withSentryConfig(nextConfig, {
  // The project the owner creates (12 §3 step 11). An organization token names its organization,
  // so no org slug is configured.
  project: "suburi",
  authToken: sentry?.authToken,
  sourcemaps: {
    // Uploaded, then deleted from .next/static so they are never served (12 §7).
    disable: !sentry,
    deleteSourcemapsAfterUpload: true,
  },
  // Tracing is off (06, 2026-09-29), so its code is left out of the bundle.
  bundleSizeOptimizations: {
    excludeTracing: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
    excludeReplayWorker: true,
  },
  // onRouterTransitionStart only traces navigations, and there is no tracing.
  suppressOnRouterTransitionStartWarning: true,
  // The build plugin would otherwise report on itself to Sentry.
  telemetry: false,
});
