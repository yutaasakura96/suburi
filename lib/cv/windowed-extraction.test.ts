import { describe, expect, it } from "vitest";
import { ExtractionFailed, type ExtractionDocument } from "../ai/extract-cv-claims";
import { fakeCvClaimExtractor } from "../ai/fake-extract-cv-claims";
import {
  EXTRACTION_DEADLINE_MS,
  MIN_RETRY_MS,
  WindowedExtractionFailed,
  extractByWindow,
} from "./windowed-extraction";
import { WINDOW_TARGET_CHARS, type ExtractionWindow } from "./windows";

// The fan-out (#29): every window is one call on the whole set, all of them finish or the extraction
// fails, and a failed window gets at most one retry that fits the route's budget. No test calls
// OpenAI (11 §2); the port's fake is the model's side of each call.

const paragraph = (letter: string) => `${letter.repeat(WINDOW_TARGET_CHARS - 10)}\n\n`;
// Three windows: two in the first document, one in the second.
const DOCUMENTS: ExtractionDocument[] = [
  { kind: "cv", title: null, text: `${paragraph("a")}${paragraph("b").trimEnd()}` },
  { kind: "additional", title: "Portfolio", text: "Built an interview simulator." },
];

const key = (window: ExtractionWindow) => `${window.document}:${window.start}`;

describe("extractByWindow", () => {
  it("sends every window the whole set, in parallel, and returns each window's claims beside it", async () => {
    const seen: { documents: readonly ExtractionDocument[]; window: ExtractionWindow }[] = [];
    let inFlight = 0;
    let most = 0;
    const extractor = fakeCvClaimExtractor(async (documents, language, window) => {
      expect(language).toBe("en");
      seen.push({ documents, window });
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return [{ document: window.document, quote: key(window), start_hint: window.start }];
    });

    const extraction = await extractByWindow(extractor, "en", DOCUMENTS);

    expect(extraction.windows).toBe(3);
    expect(extraction.retries).toBe(0);
    expect(extractor.calls).toBe(3);
    expect(most).toBe(3);
    for (const call of seen) expect(call.documents).toBe(DOCUMENTS);
    expect(extraction.results.map(({ window }) => [window.document, window.start])).toEqual([
      [0, 0],
      [0, WINDOW_TARGET_CHARS - 8],
      [1, 0],
    ]);
    for (const { window, claims } of extraction.results) expect(claims[0].quote).toBe(key(window));
  });

  it("fails the whole extraction when one window fails, naming that window's error class", async () => {
    const extractor = fakeCvClaimExtractor((_documents, _language, window) => {
      if (window.document === 1) throw new ExtractionFailed("upstream_400");
      return [{ document: window.document, quote: "x", start_hint: 0 }];
    });

    const failure = await extractByWindow(extractor, "en", DOCUMENTS).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(WindowedExtractionFailed);
    expect(failure).toMatchObject({ errorClass: "upstream_400", windows: 3, retries: 0 });
  });

  it("aborts the windows still running once one has failed", async () => {
    const aborted: boolean[] = [];
    const extractor = fakeCvClaimExtractor(async (_documents, _language, window, { signal }) => {
      if (window.document === 1) throw new ExtractionFailed("upstream_401");
      await new Promise((resolve) => setTimeout(resolve, 20));
      aborted.push(signal?.aborted ?? false);
      return [];
    });

    await expect(extractByWindow(extractor, "en", DOCUMENTS)).rejects.toThrow(WindowedExtractionFailed);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(aborted).toEqual([true, true]);
  });

  it("retries a window that failed with a transient error once, and succeeds", async () => {
    const attempts = new Map<string, number>();
    const extractor = fakeCvClaimExtractor((_documents, _language, window) => {
      const n = (attempts.get(key(window)) ?? 0) + 1;
      attempts.set(key(window), n);
      if (window.document === 1 && n === 1) throw new ExtractionFailed("upstream_500");
      return [{ document: window.document, quote: "x", start_hint: 0 }];
    });

    const extraction = await extractByWindow(extractor, "en", DOCUMENTS);

    expect(extraction.retries).toBe(1);
    expect(extractor.calls).toBe(4);
    expect(extraction.results).toHaveLength(3);
  });

  it("retries at most once", async () => {
    const extractor = fakeCvClaimExtractor((_documents, _language, window) => {
      if (window.document === 1) throw new ExtractionFailed("upstream_timeout");
      return [];
    });

    await expect(extractByWindow(extractor, "en", DOCUMENTS)).rejects.toMatchObject({
      errorClass: "upstream_timeout",
      retries: 1,
    });
    expect(extractor.calls).toBe(4);
  });

  it.each(["upstream_400", "upstream_401", "upstream_404", "aborted"])(
    "does not retry %s, which the same request would get again",
    async (errorClass) => {
      const extractor = fakeCvClaimExtractor((_documents, _language, window) => {
        if (window.document === 1) throw new ExtractionFailed(errorClass);
        return [];
      });
      await expect(extractByWindow(extractor, "en", DOCUMENTS)).rejects.toMatchObject({ errorClass, retries: 0 });
      expect(extractor.calls).toBe(3);
    },
  );

  it.each(["upstream_429", "upstream_503", "malformed_output", "response_incomplete"])(
    "retries %s",
    async (errorClass) => {
      let failed = false;
      const extractor = fakeCvClaimExtractor(() => {
        if (!failed) {
          failed = true;
          throw new ExtractionFailed(errorClass);
        }
        return [];
      });
      await expect(extractByWindow(extractor, "en", DOCUMENTS)).resolves.toMatchObject({ retries: 1 });
    },
  );

  it("gives a retry only what is left of the deadline as its timeout", async () => {
    let clock = 0;
    const timeouts: (number | undefined)[] = [];
    const extractor = fakeCvClaimExtractor((_documents, _language, window, { timeoutMs }) => {
      if (window.document !== 1) return [];
      timeouts.push(timeoutMs);
      if (timeouts.length === 1) {
        clock = EXTRACTION_DEADLINE_MS - MIN_RETRY_MS - 1_000;
        throw new ExtractionFailed("upstream_502");
      }
      return [];
    });

    await extractByWindow(extractor, "en", DOCUMENTS, { now: () => clock });

    expect(timeouts).toEqual([240_000, MIN_RETRY_MS + 1_000]);
  });

  it("does not retry when too little of the deadline is left for another call", async () => {
    let clock = 0;
    const extractor = fakeCvClaimExtractor((_documents, _language, window) => {
      if (window.document !== 1) return [];
      clock = EXTRACTION_DEADLINE_MS - MIN_RETRY_MS + 1;
      throw new ExtractionFailed("upstream_timeout");
    });

    await expect(extractByWindow(extractor, "en", DOCUMENTS, { now: () => clock })).rejects.toMatchObject({
      errorClass: "upstream_timeout",
      retries: 0,
    });
    expect(extractor.calls).toBe(3);
  });

  it("reports an error the port did not classify as unexpected", async () => {
    const extractor = fakeCvClaimExtractor(() => {
      throw new TypeError("boom");
    });
    await expect(extractByWindow(extractor, "en", DOCUMENTS)).rejects.toMatchObject({ errorClass: "unexpected" });
  });
});
