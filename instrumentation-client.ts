import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry";

// Inlined at build by next.config.ts from lib/config.ts, and empty wherever Sentry is off. The DSN
// only sends events in (06, 2026-09-28), so it is the one configuration value the browser holds.
const dsn = process.env.SENTRY_BROWSER_DSN;
const environment = process.env.SENTRY_BROWSER_ENVIRONMENT;
if (dsn && environment) Sentry.init(sentryOptions({ dsn, environment }));
