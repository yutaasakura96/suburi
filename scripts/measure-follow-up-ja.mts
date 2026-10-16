import { openAiFollowUpGenerator } from "../lib/ai/follow-up.ts";
import { FOLLOW_UP_MODEL } from "../lib/ai/models.ts";

// Japanese follow-up generation, measured against OpenAI through the real port and `follow-up-ja-1.1`
// (#125, 03 §4) — the way #44 measured `follow-up-en-1.0` in `scripts/measure-round-latency.mts`.
// The Japanese prompt had never been measured, and 1.1 writes the follow-up's English in the same
// call (06, 2026-10-14, Q106-4), so this is what the follow-up's 15 s bound is checked against.
// Hand-run, never in CI:
//
//   OPENAI_API_KEY=… node --import ./scripts/resolve-ts.mts scripts/measure-follow-up-ja.mts
//
// Three invented answers at about the lengths a round produces — one, two and three and a half
// minutes spoken — five runs each, as #44 ran. No one's CV, no one's answer. Prints timings, token
// counts and counts only — never a prompt, an answer or a model's output.

// The follow-up call's bound, `FOLLOW_UP_TIMEOUT_MS` in `lib/round/follow-up.ts` (07 §5.9).
const FOLLOW_UP_TIMEOUT_MS = 15_000;

const RUNS = Number(process.env.RUNS ?? 5);

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
const generator = openAiFollowUpGenerator({ apiKey });

const ANSWERS = [
  {
    prompt: "当社を志望された理由をお聞かせください。",
    answer:
      "はい、御社は物流のシステムを自社で開発されていて、そこに魅力を感じました。私はこれまでバックエンドの開発をやってきたので、その経験を活かせると思っています。あと、えっと、求人票に書いてあった配送ルートの最適化っていうのに興味があります。前の会社では、そういう難しい問題に取り組む機会があまりなかったので、挑戦したいと思いました。",
  },
  {
    prompt: "これまでで最も困難だった業務と、どのように対応したかを教えてください。",
    answer:
      "えー、前職で、配送管理のシステムの移行を担当したんですけど、あのー、古いシステムの仕様書がほとんどなくて、それが一番大変でした。で、まず現場の人に話を聞いて、実際の動きを一つずつ確認していきました。それから、えっと、新旧のシステムを並行で動かして、結果を比べるっていうことをやりました。毎晩、両方の出力を比べるスクリプトを書いて、違いが出たら次の日の朝に原因を調べる、という流れです。最初は1日に20件くらい差分が出ていたんですが、2か月目にはほぼゼロになりました。3か月くらいかかりましたが、大きな障害なく切り替えられました。5人のチームで、私が取りまとめをしていたので、あのー、毎週の進み具合を部長に報告するのも私の役目でした。",
  },
  {
    prompt: "チームの中で意見が対立したとき、どのように対応しましたか。",
    answer:
      "そうですね、去年、請求処理のバッチを作り直すときに、あのー、チームの中で意見が分かれたことがあります。先輩のエンジニアは、今の仕組みを少しずつ直していくのがいいという意見で、私は、えっと、新しい仕組みに一度に切り替えたほうがいいと思っていました。理由は、今の仕組みは夜中に止まることが月に2回くらいあって、そのたびに誰かが朝早く来て直していたからです。で、どちらが正しいかを言い合っても決まらないので、まず、止まった回数と、直すのにかかった時間を半年分まとめました。それから、少しずつ直す案と、一度に切り替える案のそれぞれで、どれくらい時間がかかるか、どんな危険があるかを表にして、チーム全員で見ました。話し合ってみると、先輩が心配していたのは、一度に切り替えて失敗したときに元に戻せないことでした。それはもっともだと思ったので、切り替えの前に、古い仕組みにすぐ戻せる手順を作って、テスト環境で2回練習しました。結局、新しい仕組みに切り替えることになって、えー、切り替えてから半年、夜中に止まったことは一度もありません。この経験から、意見が対立したときは、相手が何を心配しているのかを先に聞くことが大事だと学びました。あと、数字があると話が早いということも分かりました。",
  },
];

const timings: number[] = [];
const tokens: { in: number; out: number }[] = [];
let kept = 0;
const dropped: Record<string, number> = {};
let failed = 0;

for (let run = 0; run < RUNS; run += 1) {
  for (const { prompt, answer } of ANSWERS) {
    const started = performance.now();
    try {
      const result = await generator.generate({ language: "ja", roundType: "behavioural", prompt, answer });
      timings.push(performance.now() - started);
      tokens.push({ in: result.tokensIn ?? 0, out: result.tokensOut ?? 0 });
      if (result.englishDropped) dropped[result.englishDropped] = (dropped[result.englishDropped] ?? 0) + 1;
      else kept += 1;
    } catch (error) {
      failed += 1;
      console.log(`call failed after ${((performance.now() - started) / 1000).toFixed(1)} s: ${(error as { errorClass?: string }).errorClass ?? "unexpected"}`);
    }
  }
}

function quantile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  return sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low);
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
console.log(`\nMeasured ${RUNS} run(s) of ${ANSWERS.length} answers: ${FOLLOW_UP_MODEL}, follow-up-ja.`);
console.log("| Job | n | median | p90 | slowest | tokens in / out (median) |");
console.log("| --- | --- | --- | --- | --- | --- |");
console.log(
  `| Follow-up generation, ja | ${timings.length} | ${seconds(quantile(timings, 0.5))} | ${seconds(quantile(timings, 0.9))} | ${seconds(Math.max(...timings))} | ${quantile(tokens.map((t) => t.in), 0.5).toFixed(0)} / ${quantile(tokens.map((t) => t.out), 0.5).toFixed(0)} |`,
);
console.log(`- English kept: ${kept}; dropped: ${JSON.stringify(dropped)}; failed calls (malformed follow-up or upstream): ${failed}`);
console.log(`- Over the ${FOLLOW_UP_TIMEOUT_MS / 1000} s bound: ${timings.filter((ms) => ms > FOLLOW_UP_TIMEOUT_MS).length}`);
