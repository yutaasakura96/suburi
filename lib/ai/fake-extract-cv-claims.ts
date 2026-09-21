import type { CvClaimExtractor, ExtractedClaim, ExtractionDocument } from "./extract-cv-claims";

// The port's fake, for tests only (11 §2: no test calls OpenAI). `respond` sees exactly what the
// real implementation would send and returns claims or throws, as the model's side of the call.
export function fakeCvClaimExtractor(
  respond: (documents: readonly ExtractionDocument[]) => readonly ExtractedClaim[],
): CvClaimExtractor & { calls: number } {
  const fake = {
    modelId: "fake-extractor",
    promptVersion: "cv-extract-en-fake",
    calls: 0,
    async extract(documents: readonly ExtractionDocument[]) {
      fake.calls += 1;
      return respond(documents);
    },
  };
  return fake;
}
