-- Custom migration (#28): `text_normalised` becomes `normaliseClaimText` as it now is in
-- lib/cv/spans.ts — NFKC, then every whitespace run collapsed to one space, then trimmed.
--
-- Derived data only. `cv_versions.body`, `span_start` and `span_end` are not touched, so nothing that
-- indexes into the body moves, and no row is deleted. Without this, the first version saved after the
-- function change would compare NFKC keys against the old ones and carry forward nothing.
--
-- The stored value is already whitespace-collapsed, and NFKC maps whitespace only to whitespace, so
-- re-normalising it gives the same key as normalising the original quote. The bracket is JavaScript's
-- `\s` under the `u` flag, spelled out: Postgres's own `\s` follows the locale. `normalize` needs a
-- UTF8 database, which Neon and the local image both are.
UPDATE "cv_claims" AS "claim"
SET "text_normalised" = "renormalised"."value"
FROM (
	SELECT
		"id",
		btrim(
			regexp_replace(
				normalize("text_normalised", NFKC),
				'[\t\n\v\f\r    -     　﻿]+',
				' ',
				'g'
			),
			' '
		) AS "value"
	FROM "cv_claims"
) AS "renormalised"
WHERE "claim"."id" = "renormalised"."id"
	AND "claim"."text_normalised" <> "renormalised"."value";
