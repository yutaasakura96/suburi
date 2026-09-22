// Copies pdf.js's Adobe CMaps into public/pdfjs/cmaps/ so the browser fetches them from our own
// origin, at exactly the installed pdfjs-dist's version (06, #17). Run before `next dev` and
// `next build`; the output is git-ignored, never committed.

import { cp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const packageDir = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const target = join(process.cwd(), "public", "pdfjs", "cmaps");

await rm(target, { recursive: true, force: true });
await cp(join(packageDir, "cmaps"), target, { recursive: true });
