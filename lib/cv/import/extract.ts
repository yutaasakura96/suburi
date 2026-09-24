// Browser only. Turns a picked .docx or .pdf into text for a document's box (10 §13); the file never
// leaves the browser (07 §5.2). Both libraries load on demand, so /cv's bundle carries neither until
// a file is picked.

import { detectFormat, docxHtmlToText, pdfPagesToText, tidyImported, type PdfTextItem } from "./text";

/** `no_text`: read, but nothing in it (a scanned PDF). `unreadable`: not a .docx/.pdf we can open. */
export type ImportResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: "no_text" | "unreadable" };

/**
 * The Adobe CMaps, served from our own origin at the pinned pdfjs-dist's version
 * (`scripts/copy-pdfjs-assets.mjs`). A Japanese PDF whose font is not embedded cannot be read
 * without them.
 */
const CMAP_URL = "/pdfjs/cmaps/";

export async function extractText(file: File): Promise<ImportResult> {
  const data = new Uint8Array(await file.arrayBuffer());
  const format = detectFormat(file.name, data.subarray(0, 8));
  if (!format) return { ok: false, reason: "unreadable" };

  let raw: string;
  try {
    raw = format === "docx" ? await fromDocx(data) : await fromPdf(data);
  } catch {
    // Corrupt, password-protected, or a zip that is not a Word document. No detail is kept: the
    // error text can quote the file.
    return { ok: false, reason: "unreadable" };
  }
  const text = tidyImported(raw);
  return text === "" ? { ok: false, reason: "no_text" } : { ok: true, text };
}

/**
 * Through HTML rather than `extractRawText`, because raw text knows nothing of tables: it ends every
 * paragraph with a blank line, and a table cell is a paragraph, so a 履歴書's 学歴・職歴 rows arrived
 * split across three lines each (#27). `docxHtmlToText` walks the HTML instead and joins a row's
 * cells with a tab. Outside a table the result is what raw text gave.
 *
 * Images are converted to a source-less `<img>`: mammoth's default inlines every picture as a base64
 * data URI, and a 履歴書 carries a photograph. `DOMParser` builds an inert document, so nothing is
 * fetched for it either.
 */
async function fromDocx(data: Uint8Array) {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml(
    { arrayBuffer: data.slice().buffer },
    { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
  );
  return docxHtmlToText(new DOMParser().parseFromString(html, "text/html").body);
}

let worker: Worker | null = null;

async function fromPdf(data: Uint8Array) {
  const pdfjs = await import("pdfjs-dist");
  // One worker for the page's lifetime, bundled by Next from the pinned package.
  worker ??= new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
  pdfjs.GlobalWorkerOptions.workerPort = worker;

  const task = pdfjs.getDocument({ data, cMapUrl: CMAP_URL, cMapPacked: true });
  try {
    const document = await task.promise;
    const pages: PdfTextItem[][] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const { items } = await page.getTextContent();
      // Marked-content boundaries carry no text.
      pages.push(items.flatMap((item) => ("str" in item ? [item] : [])));
    }
    return pdfPagesToText(pages);
  } finally {
    await task.destroy();
  }
}
