# Native read — the CV feature (#14–#18), one batch

`11` §5 asks for a native read of every new Japanese string, and `05` §6 holds the rules earned so
far. This is the batch #20 owes: every Japanese string the CV feature added, in one sitting, read for
**whether a person would write it** — not whether the translation is correct.

The English column is there as the intent, not as the thing being judged.

**How to mark each row:** ✓ accepted as written, or the replacement written beside it. A rule that
generalises past its own row goes into `05` §6 and, where it can be tested, into
`app/(app)/cv/copy.test.ts` or `lib/copy/errors.test.ts` the way #13's did.

**Rules already in force here**, asserted by test, so a replacement must keep them: `バージョン`
never `版`; `記載事項` for a Claim, never `主張`; counts in `件`; no digit followed by `点`; every
error sentence ends in `。`; no two error codes share a sentence.

## 1. The 応募書類 panel — `app/(app)/cv/copy.ts`

`10` §13 gives the starred ones; the rest were written during #15–#18 and have never been read.

| | Japanese | Intent |
| --- | --- | --- |
| ☐ | 応募書類 | the panel heading |
| ☐ | 応募書類を追加する | empty state's button |
| ☐ | 新しいバージョンをつくる | button on an existing version |
| ☐ | 履歴書が1通必要です。職務経歴書と、補足資料を5つまで追加できます。 | what the set may hold |
| ☐ | 履歴書 / 職務経歴書 / 補足資料 | the three kind names |
| ☐ ★ | 生年月日・住所・電話番号・顔写真・家族の情報は省いてかまいません。評価には使いません。 | the 履歴書 personal-particulars hint |
| ☐ | 職務経歴書を追加 | |
| ☐ | 補足資料を追加 | |
| ☐ | 資料名 | an additional document's title field |
| ☐ | 本文 | the text box's label |
| ☐ | 外す | removes a document from the set |
| ☐ | ファイルから読み込む | the import button |
| ☐ | 読み込んだ文を確認して、必要なら直してください。保存した文がそのまま評価に使われます。 | after an import |
| ☐ | このファイルからは文字を読み取れませんでした。スキャンした画像のファイルは読み込めないため、本文を貼り付けてください。 | import found no text (#17) |
| ☐ | このファイルは開けませんでした。破損しているか、パスワードで保護されている可能性があります。本文を貼り付けてください。 | import could not open the file (#17) |
| ☐ | このバージョンを保存する | save |
| ☐ | 保存すると、この内容でバージョンが確定します。あとから直すことはできません。 | beside save — immutability |
| ☐ | 記載事項を抽出しています。しばらくかかることがあります。 | while the model runs |
| ☐ | 記載事項 34件 | the claim counter |
| ☐ | 34件を抽出。27件は前のバージョンから引き継ぎ、7件が新規。0件を除外。 | the result line |
| ☐ | 2件は本文と一致しなかったため除きました。 | dropped claims |
| ☐ | 14:32 から保存できます。 | rate-limited retry time (#18) |

`記載事項` itself is on trial here: `05` §6 recorded it as the leading candidate for Claim and
deferred the decision to the first screen that lists claims. This is that screen.

## 2. Error sentences — `lib/copy/errors.ts`

The other 24 passed on 2026-09-21. One is new:

| | Japanese | Intent |
| --- | --- | --- |
| ☐ | 応募書類が長すぎます。短くしてからもう一度保存してください。 | `cv_too_large` — over the text-size cap, refused before any model call |

If the cap's number belongs in this sentence, say so — the catalogue holds flat strings with no
interpolation on purpose (the screen renders values from `detail`, which carries `body_chars` and
`max_body_chars`), so that would be a deliberate exception rather than an edit.

## 3. The three prose strings that still say 職務経歴書 — `10` §8, §9

`応募書類` is the set; these three sentences mean the set but name one member. They are rewritten
sentences rather than stamps, which is why `05` §6 left them for the screen that carries them. No
code renders them yet.

| | Japanese | Where |
| --- | --- | --- |
| ☐ | 職務経歴書との照合 | `05` §3.3's section label, feedback screen |
| ☐ | 数値の裏づけが2か所ありません。職務経歴書の「請求処理を40%短縮」を使う。 | the round-level line, feedback screen |
| ☐ | 縦線は評価基準・出題・職務経歴書が変わったところです。 | Progress's legend |

## 4. While the real CV is on screen — `11` §5

Not copy, but the same sitting:

- ☐ The extraction looks right against the underlined text.
- ☐ `spans_rejected` is 0.
- ☐ Five underlined quotes sampled, each genuinely in the CV.
