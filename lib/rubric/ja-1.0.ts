import type { Rubric } from "./types.ts";

// Rubric `ja` v1.0 (06, 2026-09-27): drafted by Claude with an anchor for every level of every
// dimension, and reviewed before it is seeded anywhere real (04 `rubric_versions`, 11 §5). **That
// review and its read were done on 2026-10-03 by an AI, not a native speaker, at the user's explicit
// delegation** (06, 2026-10-03): one anchor reworded, the rest accepted. A human native read can
// still revisit it — as v1.1. A changed rubric is a new file and a new version label, never an edit
// to this one: every scored answer carries the version as stamp 2, and Progress draws a boundary where
// it changes.
//
// Two rubrics, not one with a flag: this is not a translation of `en-1.0.ts`. It shares six dimensions
// with it and adds 敬語, and its definitions are written in Japanese for a Japanese interview — the
// fillers fluency reads are Japanese ones, the pace is in 字/分 (06, 2026-09-27, confirm 4), and
// accuracy leaves register to 敬語 so the two can never be one language score.
//
// What the scorer reads (03 §4): the corrected transcript, never the raw one, plus the answer's
// duration and pace. Fluency is defined on what the correction step keeps, so correcting cannot
// launder it. 敬語 is the register the words carry; a transcript shows no tone of voice.

export const JA_1_0: Rubric = {
  versionLabel: "v1.0",
  language: "ja",
  dimensions: [
    {
      key: "structure",
      label_ja: "構成",
      label_en: "Structure",
      definition: {
        summary:
          "回答の組み立て。結論が早く出ているか、聞き手が追える順序で話が進むか、言いっぱなしで終わらずに締めくくられているかを見る。",
        anchors: [
          "要点も順序も読み取れない。断片が並ぶだけで、回答としてまとまっていない。",
          "話があちこちに飛ぶ。要点が埋もれているか、ほのめかされるだけで、同じ話の繰り返しや後戻りがある。",
          "要点はあるが、出てくるのが遅いか、各部分の順序がゆるい。聞き手が少し補えば筋を追える。",
          "要点が早い段階で述べられ、順序も追いやすい。ただし一部の位置がずれているか、締めくくりが弱い。",
          "最初に結論を答え、わかりやすい順序（たとえば状況・行動・結果）で展開し、最後に要点へ戻って締めくくる。聞き手が話の行き先を推し量る必要がない。",
        ],
      },
    },
    {
      key: "evidence",
      label_ja: "根拠",
      label_en: "Evidence",
      definition: {
        summary:
          "主張が、聞き手が確かめられる具体的な事実で裏づけられているか。具体的な場面、本人が実際に行ったこと、数値・規模・期間を伴う結果を見る。",
        anchors: [
          "裏づけがない。資質や経験についての主張だけで、支える事実がない。",
          "ほとんどが言い切りの主張（「努力家です」「コミュニケーションが得意です」）で、例があっても詳細のない一言にとどまる。",
          "実例が一つあるが、本人の役割か結果が抽象的なままである（「改善しました」「うまくいきました」）。",
          "主な主張は、本人の行動と結果を伴う具体例で裏づけられている。ただし主張の一つが言い切りのままか、結果の一つがあいまいである。",
          "中身のある主張のすべてが具体例で裏づけられている。本人の行動と、数値・規模・期間・具体的な成果といった、確かめられる結果が示されている。",
        ],
      },
    },
    {
      key: "relevance",
      label_ja: "関連性",
      label_en: "Relevance",
      definition: {
        summary:
          "聞かれた質問そのものに、その全体に答えているか。そして、その職務で求められること（一般練習では、この質問で面接官が知りたいこと）に結びついているかを見る。",
        anchors: [
          "聞かれた質問に答えていない。",
          "ほとんどが質問から外れている。関係のある内容は、ついでに触れられる程度である。",
          "話題には触れているが、質問の一部にしか答えていない。答えやすい別の質問に答えているか、二つある問いの片方だけに答えている。",
          "聞かれた質問に答えている。ただし一部の扱いが軽いか、職務との結びつきを聞き手に委ねている。",
          "聞かれた質問のすべての部分に過不足なく答え、その答えが職務にとって、あるいは面接官が知りたいことにとって、なぜ意味を持つのかを明らかにしている。",
        ],
      },
    },
    {
      key: "fluency",
      label_ja: "流暢さ",
      label_en: "Fluency",
      definition: {
        summary:
          "回答がどれだけなめらかに話されたか。修正後の文字起こしに残っているフィラー（「えー」「あのー」「えっと」「まあ」「なんか」）、言い直し、言いさしの文、言いよどみと、話す速さから読み取る。文法や語の選び方は正確さで見るので、ここでは見ない。",
        anchors: [
          "話が成り立っていない。ほとんどの文が言い直されるか途中で途切れ、あるいはフィラーが長く続く。",
          "フィラー、言い直し、言いさしの文が多く、聞き手が苦労しないと追えない。",
          "フィラーや言い直しが何か所かで目立つが、聞き手は無理なく追える。",
          "フィラーや言い直しがときどきあるが、話の流れは途切れない。",
          "話がよどみなく続く。フィラーや言い直しはまれで、意味を遮ることがなく、速さも安定している。",
        ],
      },
    },
    {
      key: "accuracy",
      label_ja: "正確さ",
      label_en: "Accuracy",
      definition: {
        summary:
          "日本語そのものの正しさ。文法、助詞、語の選び方、語と語の結びつき、専門用語の使い方を見る。話し方のなめらかさは流暢さで、敬語の使い方は敬語で見るので、ここでは見ない。内容が事実かどうかも見ない。",
        anchors: [
          "全体に誤りがあり、ほとんどの文で意味が取りにくい。",
          "誤りが多い。意味のはっきりしない言い回しがいくつもあるか、専門用語が誤って使われている。",
          "誤りがたびたびあり、そのうちいくつかは一瞬意味が取りにくい。語の選び方が不正確なことがある。",
          "小さな誤り（助詞、活用、語と語の結びつき）がいくつかあるが、意味を妨げることはない。",
          "誤りがないか、あってもごくわずかである。業界用語や専門用語を含め、語の選び方が的確である。",
        ],
      },
    },
    {
      key: "length_pacing",
      label_ja: "長さ・配分",
      label_en: "Length and pacing",
      definition: {
        summary:
          "回答の長さが質問に見合っているか、時間が大事なところに使われているか。文面に加えて、所要時間と話す速さから読み取る。ほとんどの質問は1〜2分で足り、具体例を詳しく求める質問でも3分程度までが目安である。話す速さは、1分あたりおよそ250〜350字が聞き取りやすい。",
        anchors: [
          "ほんの一言で終わるか、要点に届かないまま上限の4分まで話し続ける。",
          "きちんと答えるには短すぎる（中身のある質問に対して30秒に満たない）か、長すぎて同じ話の繰り返しで時間が埋まっている。",
          "質問が求める内容に対して明らかに短いか、明らかに長く（3分程度を超え）余分な話が混じる。あるいは、話す速さが明らかに速すぎるか遅すぎる。",
          "ほぼ適切な長さである。ただし前置きが少し長いか、一部に必要な時間が割かれていない。話す速さは聞き取りやすい。",
          "長さが質問に見合っており、時間の大半が前置きではなく中身に使われている。話す速さは終始聞き取りやすい。",
        ],
      },
    },
    {
      key: "keigo",
      label_ja: "敬語",
      label_en: "Keigo (register)",
      definition: {
        summary:
          "面接の場にふさわしい言葉づかいが保たれているか。です・ます体が一貫しているか、尊敬語と謙譲語を正しく使い分けているか、相手の会社・自分の会社・身内の人の呼び方が適切か、くだけた言い方が混じっていないかを見る。丁寧さが過剰でないかも含む。助詞や文法の誤りは正確さで見るので、ここでは見ない。",
        anchors: [
          "面接の言葉づかいになっていない。全体が普通体（「〜だ」「〜と思う」）やくだけた話し言葉で話されている。",
          "です・ます体が安定せず、くだけた言い方（「〜っていう」「〜じゃないですか」「やっぱ」）が多い。あるいは、尊敬語と謙譲語を取り違えている（自分の行為に尊敬語を使う、相手の行為に謙譲語を使う）。",
          "です・ます体はおおむね保たれているが、くだけた言い方がところどころに混じる。あるいは、二重敬語や、いわゆるバイト敬語（「〜のほう」「〜になります」）がいくつかある。",
          "言葉づかいは面接にふさわしく、尊敬語と謙譲語も正しい。ただし小さなゆらぎが一、二か所ある（「御社」と「貴社」の取り違え、身内に敬語を使う、など）。",
          "です・ます体が終始一貫し、尊敬語と謙譲語を正しく、過不足なく使い分けている。「御社」「弊社」「前職」などの呼び方も適切で、丁寧でありながら回りくどくない。",
        ],
      },
    },
  ],
};
