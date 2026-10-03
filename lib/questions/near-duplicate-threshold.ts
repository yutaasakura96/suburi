/**
 * Cosine similarity at or above which two questions are the same question. **0.90 is an unverified
 * guess** (06, 2026-09-27): no measurement stands behind it. This is the one place the number lives;
 * tests read it rather than repeat it, and each stored check carries the value it was judged by.
 *
 * A file of its own, with no imports, so the status page's copy can state it without the guard's
 * database code coming along.
 */
export const NEAR_DUPLICATE_THRESHOLD = 0.9;
