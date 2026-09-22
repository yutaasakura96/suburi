// Writes e2e/fixtures/shokumu.docx and e2e/fixtures/rirekisho.pdf — the Japanese files #17's
// Playwright test imports — and blank.pdf, a page with no text, standing in for a scanned file. Node
// built-ins only, byte-for-byte deterministic; the script and its output are both committed. Every
// name and fact in them is invented.
//
// The PDF's font is deliberately **not embedded**: HeiseiMin-W3 under the predefined UniJIS-UCS2-H
// CMap, as Japanese PDFs from older tools are. pdf.js cannot read it without the Adobe CMaps, so the
// test fails if public/pdfjs/cmaps/ is not served (06, #17). A PDF exported from Word embeds its
// font with a ToUnicode map and would pass either way.
//
//   npm run fixtures:import

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const SHOKUMU_PARAGRAPHS = [
  "職務経歴書",
  "",
  "職務要約",
  "架空物流株式会社にて経理システムの刷新を主導し、請求処理を40%短縮しました。",
  "",
  "",
  "活かせる経験",
  "チーム5名の統括、要件定義から運用までの一貫した担当。",
];

const RIREKISHO_LINES = ["氏名 山田 花子", "2016年3月 架空大学 情報学部 卒業", "基本情報技術者試験 合格"];

// --- .docx: a zip holding the three parts Word needs to open a document ---------------------------

const xmlEscape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function docx(paragraphs: readonly string[]) {
  const body = paragraphs
    .map((text) => (text === "" ? "<w:p/>" : `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`))
    .join("");
  return zip([
    [
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        "</Types>",
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>",
    ],
    [
      "word/document.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body>${body}</w:body></w:document>`,
    ],
  ]);
}

/** A minimal deflate zip, every entry dated 1980-01-01 so the output never changes. */
function zip(entries: readonly (readonly [string, string])[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const raw = Buffer.from(content, "utf8");
    const data = deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// --- .pdf: one A4 page, one non-embedded CID font ---------------------------------------------------

/** UniJIS-UCS2-H codes are the UTF-16BE code units, written as a hex string. */
const ucs2Hex = (text: string) => `<${Buffer.from(text, "utf16le").swap16().toString("hex").toUpperCase()}>`;

function pdf(lines: readonly string[]) {
  const content = ["BT", "/F1 14 Tf", "72 760 Td", ...lines.flatMap((line, index) => [
    ...(index === 0 ? [] : ["0 -28 Td"]),
    `${ucs2Hex(line)} Tj`,
  ]), "ET"].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /UniJIS-UCS2-H /DescendantFonts [6 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 " +
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 7 0 R /DW 1000 >>",
    "<< /Type /FontDescriptor /FontName /HeiseiMin-W3 /Flags 6 /FontBBox [-123 -257 1001 910] " +
      "/ItalicAngle 0 /Ascent 723 /Descent -241 /CapHeight 709 /StemV 69 >>",
  ];

  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const directory = join(import.meta.dirname, "..", "e2e", "fixtures");
await mkdir(directory, { recursive: true });
await writeFile(join(directory, "shokumu.docx"), docx(SHOKUMU_PARAGRAPHS));
await writeFile(join(directory, "rirekisho.pdf"), pdf(RIREKISHO_LINES));
await writeFile(join(directory, "blank.pdf"), pdf([]));
