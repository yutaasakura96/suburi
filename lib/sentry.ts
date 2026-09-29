import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

// The one Sentry configuration, shared by the server, edge and browser inits, so 12 §7 is decided
// in one place. Imports nothing that reads process.env: the browser bundle includes it.
//
// Errors only (06, 2026-09-29): no performance tracing, Session Replay or release-health sessions.

// The HTTP breadcrumb categories: the browser's fetch and XHR, and Node's outgoing requests.
const httpCategories = new Set(["fetch", "xhr", "http"]);

// Drops the query and fragment. A presigned S3 URL carries its signature in the query, and an OAuth
// callback its code; the path is ids at most.
function withoutQuery(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

// fetch, XHR and Node HTTP breadcrumbs keep the URL, method and status, never a body (12 §7). Built
// from an allowlist of three keys, not by deleting the ones known to carry a body.
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (!breadcrumb.category || !httpCategories.has(breadcrumb.category)) return breadcrumb;
  const data = breadcrumb.data ?? {};
  return {
    ...breadcrumb,
    data: {
      // The browser's breadcrumbs name it `method`, Node's `http.request.method`.
      method: data.method ?? data["http.request.method"],
      url: typeof data.url === "string" ? withoutQuery(data.url) : undefined,
      status_code: data.status_code,
    },
  };
}

// Request and response bodies are dropped entirely, not filtered field by field (12 §7): an
// allowlist of safe keys is a list someone forgets to extend when a column is added. Cookies and the
// query string go with them; dataCollection below already stops the SDK collecting any of these, so
// this is the second lock.
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.url) event.request.url = withoutQuery(event.request.url);
  }
  // Next.js's onRequestError records the request path, query included.
  const nextjs = event.contexts?.nextjs;
  if (nextjs && typeof nextjs.request_path === "string") {
    nextjs.request_path = withoutQuery(nextjs.request_path);
  }
  if (event.contexts?.response) {
    event.contexts.response = { status_code: event.contexts.response.status_code };
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  return event;
}

export type SentryInit = {
  dsn: string;
  environment: string;
};

// Integrations are typed by shape: @sentry/nextjs exports no Integration type.
type Named = { name: string };

export function sentryOptions<H extends Named>({ dsn, environment }: SentryInit, serverHttp?: H) {
  return {
    dsn,
    environment,
    // What v10 called `sendDefaultPii: false`, and stricter: v11 removed that option and collects
    // everything by default, bodies included (06, 2026-09-30).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    integrations: <T extends Named>(defaults: T[]): (T | H)[] => [
      ...defaults.filter(({ name }) =>
        name !== "BrowserSession" && name !== "ProcessSession" && (serverHttp === undefined || name !== "Http"),
      ),
      ...(serverHttp ? [serverHttp] : []),
    ],
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
  };
}
