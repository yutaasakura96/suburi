import type { ExtractionWindow } from "../cv/windows";
import type {
  CvClaimExtractor,
  CvLanguage,
  ExtractedClaim,
  ExtractionCallOptions,
  ExtractionDocument,
} from "./extract-cv-claims";

// The port's fake, for tests only (11 §2: no test calls OpenAI). `respond` sees exactly what the
// real implementation would send — the whole set and one window — and returns claims or throws, as
// the model's side of one call. `calls` counts calls, so a set of N windows is N.
export function fakeCvClaimExtractor(
  respond: (
    documents: readonly ExtractionDocument[],
    language: CvLanguage,
    window: ExtractionWindow,
    options: ExtractionCallOptions,
  ) => readonly ExtractedClaim[] | Promise<readonly ExtractedClaim[]>,
): CvClaimExtractor & { calls: number } {
  const fake = {
    modelId: "fake-extractor",
    promptVersions: { ja: "cv-extract-ja-fake", en: "cv-extract-en-fake" },
    calls: 0,
    async extract(
      language: CvLanguage,
      documents: readonly ExtractionDocument[],
      window: ExtractionWindow,
      options: ExtractionCallOptions = {},
    ) {
      fake.calls += 1;
      return respond(documents, language, window, options);
    },
  };
  return fake;
}
