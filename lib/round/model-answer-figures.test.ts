import { describe, expect, it } from "vitest";
import { unsupportedFigureSpans } from "./model-answer-figures";

function marked(answer: string, cv = "", own = "") {
  return unsupportedFigureSpans(answer, cv, own).map(({ start, end }) => Array.from(answer).slice(start, end).join(""));
}

describe("model-answer figures", () => {
  it("checks digit figures in English, Japanese, and a Japanese answer's English translation", () => {
    const cv = "４名のチームを率いた。";
    const own = "80% improved.";
    expect(marked("４名で８０％改善しました。3倍にしました。", cv, own)).toEqual(["3倍"]);
    expect(marked("I led 4 people and improved results by 80%, then by 3x.", cv, own)).toEqual(["3x"]);
    expect(marked("𠮷 ２倍")).toEqual(["２倍"]);
  });

  it.each([
    ["3 million", "3 engineers"],
    ["3k", "3 engineers"],
    ["3万", "3 engineers"],
    ["3億", "3 engineers"],
    ["30%", "30"],
    ["30", "30%"],
    ["2x", "2"],
    ["2倍", "2"],
  ])("keeps value and kind distinct for %s", (answer, cv) => {
    expect(marked(answer, cv)).toEqual([answer]);
  });

  it.each([
    ["I led 4 backend engineers.", "Led 4 engineers."],
    ["2021年に入社しました。", "2021.04 - 2023.03"],
    ["I joined in 2021.", "2021.04 - 2023.03"],
    ["2021", "", "My employment began in 2021.04."],
    ["3年の経験", "3年間の経験"],
    ["3 million", "3,000,000"],
    ["1億2000万円", "120000000"],
    ["１億２０００万円", "120000000"],
    ["120000000", "1億2000万円"],
    ["2倍", "2x"],
    ["2021年に入社しました。", "2021/04 - 2023/03"],
    ["2021年4月1日", "2021.04.01"],
    ["30 percent", "30%"],
    ["1万2000円", "12,000円"],
    ["1億2千万円", "120000000"],
    ["5千万円", "50,000,000"],
    ["1.1k", "1100"],
    ["2.3万", "23000"],
  ])("matches supported value across notation: %s", (answer, cv, own = "") => {
    expect(marked(answer, cv, own)).toEqual([]);
  });

  it.each([
    ["応答時間を30パーセント短縮しました。", "応答時間を30%短縮"],
    ["30%短縮", "30パーセント短縮"],
    ["20%以上短縮しました。", "応答時間を20〜30%短縮"],
    ["20％", "20～30パーセント短縮"],
    ["I cut latency by 20%.", "Cut latency by 20-30%."],
    ["20 percent", "20 to 30 percent"],
    ["20%", "", "20–30%"],
    ["3万件を処理", "3〜5万件を処理"],
    ["3 million", "3 to 5 million"],
    ["3k", "3~5k"],
    ["2倍に", "2〜3倍に改善"],
    ["2x", "2-3x"],
  ])("supports %s from a percent written out or a range sharing one marker", (answer, cv, own = "") => {
    expect(marked(answer, cv, own)).toEqual([]);
  });

  it("lends a range's marker to its first end, and to nothing else", () => {
    expect(marked("20%", "20 and 30%")).toEqual(["20%"]);
    expect(marked("20", "20-30%")).toEqual([]);
    expect(marked("40%", "20-30%")).toEqual(["40%"]);
    expect(marked("30パーセント")).toEqual(["30パーセント"]);
  });

  it.each([
    ["20〜30%短縮しました。", "20%から30%短縮"],
    ["3〜5万件を処理", "3万〜5万件を処理"],
    ["I cut it by 20 to 30 percent.", "20% and 30%"],
    ["2-3x", "2倍から3倍"],
    ["2021 - 2023", "2021年から2023年"],
  ])("reads a range in the model answer as two figures sharing the marker: %s", (answer, cv) => {
    expect(marked(answer, cv)).toEqual([]);
  });

  it("marks a first end the sources back only without the range's marker, underlining its digits", () => {
    expect(marked("20〜30%削減", "20名のチーム")).toEqual(["20", "30%"]);
    expect(marked("20〜30%短縮しました。", "20%")).toEqual(["30%"]);
    expect(marked("3〜5万件", "3件、5万件")).toEqual(["3"]);
    expect(marked("3 to 5 million", "3 engineers")).toEqual(["3", "5 million"]);
  });

  it("separates commas unless exactly three digits follow", () => {
    expect(marked("チームは3,4名でした", "3名")).toEqual(["4"]);
    expect(marked("3,4名", "34名")).toEqual(["3", "4"]);
    expect(marked("3,000名", "3000名")).toEqual([]);
    expect(marked("3,4567", "3")).toEqual(["4567"]);
  });

  it.each([
    "I double-checked the data and no one objected in our one-on-one.",
    "one example, one day, at one point",
    "一時的に対応し、万一に備えて十二分に準備しました。",
    "数万円、数百人、数十倍",
    "S3 with 1on1 and 24/7 support; Q1",
    "One thing I learned is that one of the risks arose in the first half of the project.",
    "一人で十分に対応しました。数倍に改善しました。",
    "twice, double, triple, half, halved, doubling, 半減, 半分, 三倍",
  ])("leaves prose and identifiers unmarked: %s", (answer) => {
    expect(marked(answer)).toEqual([]);
  });

  it("treats m and M as words rather than magnitudes", () => {
    expect(marked("5 m and 5 M&A")).toEqual(["5", "5"]);
  });

  it("marks a figure followed by a unit", () => {
    expect(marked("Latency fell to 200ms over 5km with 40GB.")).toEqual(["200", "5", "40"]);
    expect(marked("1億2000万円")).toEqual(["1億2000万"]);
    expect(marked("30 percent")).toEqual(["30 percent"]);
  });

  it("supports only the whole of a figure that carries a magnitude or percent", () => {
    expect(marked("3 and 5", "3.5 million and 99.9%")).toEqual(["3", "5"]);
  });

  it("underlines only the figure, not the following word", () => {
    expect(marked("I led 4 backend engineers.")).toEqual(["4"]);
    expect(marked("3000万円伸ばしました。")).toEqual(["3000万"]);
    expect(marked("I saved 3 million dollars.")).toEqual(["3 million"]);
  });
});
