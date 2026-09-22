import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { assembleBody } from "../lib/cv/body.ts";
import { currentCvVersion } from "../lib/cv/current-version.ts";
import { lockCvLanguage, saveCvVersion, type NewCvVersion } from "../lib/cv/save-cv-version.ts";
import { createSpanChecker, normaliseClaimText, type Span } from "../lib/cv/spans.ts";

// The synthetic CV for Neon `develop` (docs/12-deployment.md §1). An invented person: the real CV is
// never seed material. Claims are fixtures, never a model call, so the rows are the same every run.

type Language = "ja" | "en";

interface FixtureDocument {
  readonly kind: NewCvVersion["documents"][number]["kind"];
  readonly title: string | null;
  readonly text: string;
  /** Verbatim quotes, each occurring exactly once in `text`. Never a personal particular. */
  readonly claims: readonly string[];
}

// 𠮷 is outside the BMP: one code point, two UTF-16 units. It sits before every claim, so a span
// counted in UTF-16 would slice one character late and fail the validator.
const RIREKISHO = `履歴書
2026年9月1日現在

氏名 𠮷田 美咲（よしだ みさき）
生年月日 1994年4月12日
現住所 神奈川県架空市港北区1-2-3
メールアドレス misaki@example.test

学歴
2013年4月 架空大学 理工学部 情報工学科 入学
2017年3月 架空大学 理工学部 情報工学科 卒業

職歴
2017年4月 株式会社架空ロジスティクス 入社 情報システム部に配属
2021年3月 株式会社架空ロジスティクス 退社
2021年4月 架空リテール株式会社 入社 ECシステム開発課に配属
現在に至る

免許・資格
2018年6月 基本情報技術者試験 合格
2020年12月 応用情報技術者試験 合格

本人希望記入欄
貴社の規定に従います。`;

const SHOKUMU = `職務経歴書
2026年9月1日現在
氏名 𠮷田 美咲

■職務要約
物流と小売の社内システム開発に9年間従事してきました。直近の5年間はECサイトの受注・在庫連携を担当しています。

■職務経歴
架空リテール株式会社（2021年4月～現在）
ECシステム開発課 リードエンジニア
・受注APIをモノリスから切り出し、ピーク時の応答時間を1.2秒から0.3秒に短縮しました。
・4名のチームで在庫連携バッチを再設計し、夜間処理を6時間から2時間に短縮しました。

株式会社架空ロジスティクス（2017年4月～2021年3月）
情報システム部
・倉庫管理システムの保守を担当し、問い合わせ対応手順を整備して一次回答までの時間を半減させました。

■活かせる経験・知識・スキル
・Java、Spring Boot、PostgreSQL による業務システム開発
・要件定義書の作成と、業務部門との仕様調整`;

const JA_ADDITIONAL = `在庫連携バッチ再設計の概要
課題は、夜間バッチが朝の開店に間に合わない日が月に数回あったことでした。
差分連携に切り替え、処理を店舗単位で並列化しました。
結果として、2023年度は遅延がゼロになりました。`;

const EN_CV = `Alex Morgan
alex.morgan@example.test | Fictional City

Summary
Backend engineer with eight years of experience building order and payment systems.

Experience
Fictional Payments Ltd. — Senior Software Engineer, 2020 – present
- Cut checkout API p95 latency from 900 ms to 250 ms by moving fraud checks off the request path.
- Led a team of four through a zero-downtime migration from MySQL to PostgreSQL.

Example Commerce Inc. — Software Engineer, 2017 – 2020
- Built the refund service that processed 40,000 refunds a month.

Education
BSc Computer Science, Fictional University, 2017

Certifications
AWS Certified Solutions Architect – Associate, 2019`;

const EN_ADDITIONAL = `The PostgreSQL migration
We ran dual writes for six weeks before switching reads.
The cutover took eleven minutes and needed no rollback.`;

export const SYNTHETIC_CV: Readonly<Record<Language, readonly FixtureDocument[]>> = {
  ja: [
    {
      kind: "rirekisho",
      title: null,
      text: RIREKISHO,
      claims: [
        "2017年3月 架空大学 理工学部 情報工学科 卒業",
        "2021年4月 架空リテール株式会社 入社 ECシステム開発課に配属",
        "2020年12月 応用情報技術者試験 合格",
      ],
    },
    {
      kind: "shokumu_keirekisho",
      title: null,
      text: SHOKUMU,
      claims: [
        "物流と小売の社内システム開発に9年間従事してきました。",
        "受注APIをモノリスから切り出し、ピーク時の応答時間を1.2秒から0.3秒に短縮しました。",
        "4名のチームで在庫連携バッチを再設計し、夜間処理を6時間から2時間に短縮しました。",
        "倉庫管理システムの保守を担当し、問い合わせ対応手順を整備して一次回答までの時間を半減させました。",
      ],
    },
    {
      kind: "additional",
      title: "在庫連携バッチ再設計",
      text: JA_ADDITIONAL,
      claims: ["差分連携に切り替え、処理を店舗単位で並列化しました。", "結果として、2023年度は遅延がゼロになりました。"],
    },
  ],
  en: [
    {
      kind: "cv",
      title: null,
      text: EN_CV,
      claims: [
        "Backend engineer with eight years of experience building order and payment systems.",
        "Cut checkout API p95 latency from 900 ms to 250 ms by moving fraud checks off the request path.",
        "Led a team of four through a zero-downtime migration from MySQL to PostgreSQL.",
        "Built the refund service that processed 40,000 refunds a month.",
        "AWS Certified Solutions Architect – Associate, 2019",
      ],
    },
    {
      kind: "additional",
      title: "PostgreSQL migration",
      text: EN_ADDITIONAL,
      claims: ["We ran dual writes for six weeks before switching reads.", "The cutover took eleven minutes and needed no rollback."],
    },
  ],
};

function occurrences(text: string, quote: string) {
  let found = 0;
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) found += 1;
  return found;
}

/**
 * A fixture as the save path's input. Every claim is located by the span checker and run through its
 * validator; a quote that is not in its document exactly once throws, and nothing is written. Errors
 * name positions, not text.
 */
export function syntheticCvVersion(userId: string, language: Language, documents: readonly FixtureDocument[]): NewCvVersion {
  const { body, ranges } = assembleBody(documents.map((document) => document.text));
  const checker = createSpanChecker(body, ranges);

  const claims: { span: Span; textNormalised: string }[] = [];
  documents.forEach((document, documentIndex) => {
    document.claims.forEach((quote, claimIndex) => {
      const where = `${language} document ${documentIndex} claim ${claimIndex}`;
      const found = occurrences(document.text, quote);
      if (found !== 1) throw new Error(`Seed fixture ${where} occurs ${found} times in its document, not once.`);
      const span = checker.locate(documentIndex, quote, 0);
      const verdict = span && checker.validate(span, quote);
      if (!span || !verdict?.ok) throw new Error(`Seed fixture ${where} failed the span validator.`);
      claims.push({ span, textNormalised: normaliseClaimText(quote) });
    });
  });

  return {
    userId,
    language,
    documents: documents.map(({ kind, title, text }) => ({ kind, title, sourceFilename: null, text })),
    body,
    ranges,
    claims,
    // No model produced these claims, and a null stamp says so (06, #19).
    extractorModelId: null,
    extractorPromptVersion: null,
  };
}

type Db = Pick<NodePgDatabase, "select" | "insert" | "execute">;

/**
 * Seeds one language's synthetic CV as `v1`, only if that language has no CV version at all — seeded
 * or saved. Refreshing `develop` is a reset and a fresh seed, never a seed on top (12 §1). Call it
 * inside a transaction: the check runs under the same advisory lock the save takes.
 */
export async function seedSyntheticCv(tx: Db, userId: string, language: Language): Promise<boolean> {
  const input = syntheticCvVersion(userId, language, SYNTHETIC_CV[language]);
  await lockCvLanguage(tx, userId, language);
  if (await currentCvVersion(tx, userId, language)) return false;
  await saveCvVersion(tx, input);
  return true;
}
