import { describe, expect, it } from "vitest";
import { pace, paceUnits } from "@/lib/round/measures";
import { FEEDBACK_READING, ROUND_COPY, type RoundCopy } from "./copy";

// The round screens' chrome in the round's language (10 §0). The expected strings are 10 §3–§8's own;
// the rules are 05 §6's mechanical ones, as lib/copy/errors.test.ts holds them over the catalogue.
// Whether a person would write the sentence is the read (docs/checklists/native-read-round.md).

const ja = ROUND_COPY.ja;
const en = ROUND_COPY.en;

/** Every string a language's copy can produce, with sample arguments for the ones that take any. */
function strings(copy: RoundCopy): [string, string][] {
  return Object.entries(copy).flatMap(([key, value]): [string, string][] => {
    if (typeof value === "string") return [[key, value]];
    if (typeof value === "function") {
      const sample = (value as (...args: never[]) => string)(...([192_000, 250, 8] as never[]));
      return [[key, sample]];
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => [`${key}.${index}`, typeof item === "string" ? item : (item as { label: string }).label]);
    }
    return Object.entries(value as Record<string, string>).map(([name, text]) => [`${key}.${name}`, text]);
  });
}

// `stamps` and `unused` join what they are given, and the CV check names the stored CV label, so their
// samples are 10 §7's stamp and 10 §8's rails.
const UNUSED = ["2024 決済基盤の移行リード", "英語での顧客折衝"];
const jaStrings = strings({
  ...ja,
  stamps: () => ja.stamps([ja.rubricStamp("v1.2"), "出題 v1.0", "応募書類 v3"]),
  unused: () => ja.unused(UNUSED),
  unsupported: () => ja.unsupported(2, "チーム全体の生産性を上げた", "応募書類 v3"),
  nothingUnsupported: () => ja.nothingUnsupported("応募書類 v3"),
});

describe("a Japanese round's chrome (10 §0)", () => {
  it.each(jaStrings)("%s is written in Japanese", (_, text) => {
    expect(text).toMatch(/[぀-ヿ一-龯]/u);
  });

  // 05 §6: inside a sentence the numeral sits tight against the Japanese on both sides. A figure set
  // off as a label (`最長 4分`, `直すところ 3件`) keeps one space before it, and is not a sentence.
  it.each(jaStrings.filter(([, text]) => text.endsWith("。")))("%s sets its numerals tight", (_, text) => {
    expect(text).not.toMatch(/\s[0-9]|[0-9]\s/u);
  });

  it("has every string an English round has, and no other", () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(jaStrings)("%s uses no 点 counter and an unspaced nakaguro, never a Latin middle dot", (_, text) => {
    expect(text).not.toMatch(/[0-9０-９]\s*点/u);
    expect(text).not.toMatch(/・\s|\s・|·/u);
  });

  it.each(jaStrings)("%s keeps 05 §6's settled vocabulary", (_, text) => {
    expect(text).not.toMatch(/撮り直/u);
    expect(text).not.toMatch(/モード/u);
    expect(text).not.toMatch(/版/u);
    expect(text).not.toMatch(/追撃|体感圧力/u);
  });

  it.each(jaStrings)("%s ends its last sentence, if it has one, in 。", (_, text) => {
    if (text.includes("。")) expect(text).toMatch(/。$/u);
  });

  // 10 §0: `YOUR ANSWER — EDIT FREELY`, `RAW — KEPT, NEVER REPLACED`, `Raw transcript`, `Rewrite`,
  // `BEFORE THE FEEDBACK` and `WHAT THIS IS NOT` are Japanese in a Japanese round.
  it("replaces every Latin section label with a Japanese one", () => {
    for (const label of [ja.yourAnswer, ja.rawKept, ja.rawTranscript, ja.rewrite, ja.beforeFeedback, ja.whatThisIsNot]) {
      expect(label).not.toMatch(/[A-Za-z]/u);
    }
  });
});

describe("the strings 10 §3–§8 quote", () => {
  it("names the round and its step (05 §5.2)", () => {
    expect(ja.roundTypes).toEqual({ behavioural: "行動面接", technical: "技術面接", hr: "人事面接", ceo: "最終面接" });
    expect(ja.meta(5)).toBe("日本語・実戦・5問");
    expect(ja.step(1, 5)).toBe("第1問 / 5問");
  });

  it("writes the record frames (10 §3–§5)", () => {
    expect(ja.withheld).toBe("講評はラウンドが終わってからまとめて出ます。途中では何も出ません。");
    expect(ja.goesOn).toBe("この先も続きます。全文は次の画面で直せます。音声も未修正の文字起こしも消えません。");
    expect(ja.startRecording).toBe("録音を開始");
    expect(ja.cap(240)).toBe("最長 4分");
    expect(ja.oneTake).toBe("一発勝負です。録り直しはできません。");
    expect(ja.correctAfter).toBe("止めたあとに文字起こしを直せます。");
    expect(ja.recording).toBe("録音中");
    expect(ja.stop).toBe("停止して文字起こし");
    expect(ja.autoStop(240)).toBe("4分で自動的に止まります。そこまでの録音は残ります。");
    expect(ja.correct).toBe("文字起こしを直す");
    expect(ja.correctCaption).toBe("言った通りに直してから送ります。書き直しの量は記録しますが、評価には使いません。");
  });

  // 11 §3.9: 10 §5's three figures agree — 800 characters in 3:12 is 250 per minute.
  it("shows a take's duration, pace and length in 字, consistent with each other", () => {
    const raw = "あ".repeat(800);
    const units = paceUnits("ja", raw);
    expect(ja.takeFigures(192_000, pace("ja", raw, 192_000)!, units)).toBe("3:12・約250字/分・800字");
    expect(ja.takeSummary(192_000, 250)).toBe("3:12・約250字/分");
  });

  it("writes the correction screen (10 §6)", () => {
    expect(ja.unitsChange(800, 812)).toBe("800字 → 812字");
    expect(ja.rewriteOf).toBe("の文字が、未修正の文字起こしから変わりました");
    expect(ja.rewriteNotes).toEqual([
      "記録するだけです。誤認識と言い直しの区別はしません。",
      "評価にも進捗にも使いません。あとで認識精度を見直すために残します。",
    ]);
    expect(ja.send).toBe("この回答を送る");
  });

  it("writes the felt-pressure screen (10 §7)", () => {
    expect(ja.pressureQuestion).toBe("いまのラウンド、どのくらい緊張しましたか。");
    expect(ja.pressureAsk).toBe("近いものを1つ選んでください。講評の前に一度だけ聞きます。");
    expect(ja.pressureOptions.map((option) => option.label)).toEqual([
      "まったく緊張しなかった",
      "少し意識した",
      "それなりに緊張した",
      "かなり緊張した",
      "頭が真っ白になった",
    ]);
    expect(ja.pressureNotes).toEqual([
      "採点ではありません。選んだ数字で講評は変わりません。",
      "進捗グラフには出ません。上げるものでも下げるものでもありません。",
      "回答ごとではなく、ラウンドごとに1回だけ聞きます。",
    ]);
    expect(ja.pickOne).toBe("1つ選ぶと講評に進めます。");
    expect(ja.willRecord(4)).toBe("緊張度4をこのラウンドに記録します。");
  });

  it("writes the feedback screen (10 §8)", () => {
    expect(ja.questionOf(1, 5)).toBe("第1問 / 5問");
    expect(ja.question(2)).toBe("第2問");
    expect(ja.answerFigures(192_000, 250, 8)).toBe("3分12秒・約250字/分・書き直し 8%");
    expect(ja.answerFigures(null, null, null)).toBe("");
    expect(ja.toFix(3)).toBe("直すところ 3件");
    expect(ja.whatWorked).toBe("良かったところ 1件");
    expect(ja.notScored).toBe("未採点");
    expect(ja.pressureRecorded(4)).toBe("緊張度4を講評前に記録");
  });

  it("writes the CV check and the wrong-language line (10 §8)", () => {
    expect(ja.grounding).toBe("応募書類との照合");
    expect(ja.unsupported(2, "チーム全体の生産性を上げた", "応募書類 v3")).toBe(
      "裏づけなし（第2問）—「チーム全体の生産性を上げた」に対応する記述が応募書類 v3にない。",
    );
    expect(ja.nothingUnsupported("応募書類 v3")).toBe("裏づけなし — 応募書類 v3に照らして該当なし。");
    expect(ja.unused(UNUSED)).toBe("未使用 —「2024 決済基盤の移行リード」「英語での顧客折衝」");
    expect(ja.nothingUnused).toBe("未使用 — この回で挙げる記載事項はなし。");
    expect(ja.wrongLanguage("en")).toBe("英語での回答です。日本語の進捗には入れません。");
  });

  // 深掘り is 05 §6's word for a follow-up; 10 §3, §6 and §8 quote the caption, the row and the gap.
  it("writes the follow-up's step, caption and feedback row (10 §3, §6, §8)", () => {
    expect(ja.followUpStep(2, 3)).toBe("第2問 / 3問・深掘り");
    expect(ja.sendCaptionFollowUp).toBe("送ると、いま直した文から深掘りが1問つくられます。");
    expect(ja.followUp).toBe("└ 深掘り");
    expect(ja.followUpScored(7)).toBe("7項目を採点。進捗には入れません。");
    expect(ja.followUpNotScoredYet).toBe("採点中。進捗には入れません。");
    expect(ja.followUpNotScored).toBe("未採点。進捗には入れません。");
    expect(ja.followUpMissing).toBe("深掘りが生成されませんでした。空欄として記録しています。");
  });

  // 05 §5.9: the round's stamps joined by nakaguro, the rubric as 評価基準.
  it("joins the stamps by nakaguro", () => {
    expect(ja.stamps([ja.rubricStamp("v1.0"), "set-piece-ja-1.0", "応募書類 v3"])).toBe("評価基準 v1.0・set-piece-ja-1.0・応募書類 v3");
  });
});

describe("an English round's chrome", () => {
  it("paces in words", () => {
    const raw = "I led the pay mints migration, um, over six months and cut the failure rate by half.";
    expect(en.takeFigures(18_000, pace("en", raw, 18_000)!, paceUnits("en", raw))).toBe("0:18 · ~57 wpm · 17 words");
    expect(en.answerFigures(18_000, 56.7, 12)).toBe("0 min 18 s · ~57 wpm · rewrite 12%");
    expect(en.unitsChange(17, 15)).toBe("17 words → 15 words");
  });

  it("writes the CV check and the wrong-language line (10 §8)", () => {
    expect(en.unused(["Led the 2024 payments platform migration", "Customer negotiation in English"])).toBe(
      "Unused — “Led the 2024 payments platform migration” “Customer negotiation in English”",
    );
    expect(en.wrongLanguage("ja")).toBe("This answer was given in Japanese. It is kept out of your English progress.");
  });

  it("joins the stamps by a spaced middle dot", () => {
    expect(en.stamps([en.rubricStamp("v1.0"), "set-piece-en-1.0", "CV v1"])).toBe("Rubric v1.0 · set-piece-en-1.0 · CV v1");
  });

  it("carries no Japanese", () => {
    for (const [, text] of strings({ ...en, stamps: () => "", unused: () => en.unused([]) })) expect(text).not.toMatch(/[぀-ヿ一-龯]/u);
  });
});

// 10 §8: the pill names the language it switches the feedback to, in that language.
it("names each reading language in itself", () => {
  expect(FEEDBACK_READING).toEqual({ ja: "日本語", en: "English" });
});
