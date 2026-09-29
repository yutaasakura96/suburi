import * as Sentry from "@sentry/nextjs";
import { getSentryConfig } from "@/lib/config";
import { sentryOptions } from "@/lib/sentry";

// Off unless this is production or the develop branch's preview with SENTRY_DSN set (12 §1).
const config = getSentryConfig();
if (config) Sentry.init(sentryOptions(config));
