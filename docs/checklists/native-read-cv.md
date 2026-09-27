# Native read — the CV feature (#14–#18), one batch

`11` §5 asks for a native read of every new Japanese string, and `05` §6 holds the rules earned so
far. This is the batch split out of #20 when it closed: every Japanese string the CV feature added, in one sitting, read for
**whether a person would write it** — not whether the translation is correct.

> **Done 2026-09-27 as an AI review, not a native read** (#38). The user does not read Japanese and
> asked Claude to do this check instead. Every ✓ below is Claude's judgement, made against the row's
> English intent and the rules in force; **no native speaker has read these strings.** Result: all 22
> panel strings and `cv_too_large` accepted as written — including the six amended by the 2026-09-24
> draft, which the review kept — §3's label and legend accepted as straight `応募書類` swaps, and §3's
> round-level line rewritten. One rule generalised, into `05` §6 (`06`, 2026-09-27).

The English column is there as the intent, not as the thing being judged.

**How each row was marked:** ✓ accepted as written, or the replacement written beside it. A rule that
generalises past its own row goes into `05` §6 and, where it can be tested, into
`app/(app)/cv/copy.test.ts` or `lib/copy/errors.test.ts` the way #13's did.

**Rules already in force here**, asserted by test, so a replacement must keep them: `バージョン`
never `版`; `記載事項` for a Claim, never `主張`; counts in `件`; no digit followed by `点`; every
error sentence ends in `。`; no two error codes share a sentence.

## 1. The 応募書類 panel — `app/(app)/cv/copy.ts`

`10` §13 gives the starred ones; the rest were written during #15–#18 and have never been read.

| | Japanese | Intent |
| --- | --- | --- |
| ✓ | 応募書類 | the panel heading |
| ✓ | 応募書類を登録する | empty state's button — draft applied |
| ✓ | 新しいバージョンをつくる | button on an existing version |
| ✓ | 履歴書が1通必要です。ほかに職務経歴書を1通と、補足資料を5つまで追加できます。 | what the set may hold — draft applied |
| ✓ | 履歴書 / 職務経歴書 / 補足資料 | the three kind names |
| ✓ ★ | 生年月日・住所・電話番号・顔写真・家族の情報は省いてかまいません。評価には使いません。 | the 履歴書 personal-particulars hint |
| ✓ | 職務経歴書を追加 | |
| ✓ | 補足資料を追加 | |
| ✓ | 資料名 | an additional document's title field |
| ✓ | 本文 | the text box's label |
| ✓ | 外す | removes a document from the set |
| ✓ | ファイルから読み込む | the import button |
| ✓ | 読み込んだ本文を確認して、必要なら直してください。保存した本文がそのまま評価に使われます。 | after an import — draft applied |
| ✓ | このファイルからは文字を読み取れませんでした。スキャンした画像には文字情報がないため、本文を貼り付けてください。 | import found no text (#17) — draft applied |
| ✓ | このファイルは開けませんでした。破損しているか、パスワードで保護されている可能性があります。本文を貼り付けてください。 | import could not open the file (#17) |
| ✓ | このバージョンを保存する | save |
| ✓ | 保存すると、この内容でバージョンが確定します。あとから直すことはできません。 | beside save — immutability |
| ✓ | 記載事項を抽出しています。しばらくかかることがあります。 | while the model runs |
| ✓ | 記載事項 34件 | the claim counter |
| ✓ | 34件を抽出しました。うち27件は前のバージョンから引き継ぎ、7件が新規です。除外は0件でした。 | the result line — draft applied |
| ✓ | 2件は本文と一致しなかったため除きました。 | dropped claims |
| ✓ | 14:32から保存できます。 | rate-limited retry time (#18) — draft applied |

`記載事項` itself was on trial here: `05` §6 recorded it as the leading candidate for Claim and
deferred the decision to the first screen that lists claims. This is that screen, and it passes (see
the 2026-09-27 notes below).

**Notes from the 2026-09-27 AI review.** No §1 string is one a Japanese writer would not write.
- The six drafted rows read better than their originals in every case, so none is overturned; the two
  rules they earned (`05` §6) stay, with their tests.
- `記載事項 34件` is the ordinary way a count label reads in UI (label, space, number with counter),
  and `記載事項` is the plain word for what a document states. It stays.
- `新しいバージョンをつくる` beside `応募書類を登録する`: kana `つくる` is a common, softer UI choice and
  the two are both plain verbs; not a clash worth a change.
- `2件は本文と一致しなかったため除きました。` beside the result line's `除外は…件`: the verb `除く` and the
  noun `除外` are the natural pair, not an inconsistency.
- `しばらくかかることがあります` without `時間が` is the everyday elliptical form and reads as written.

### A reviewed draft, 2026-09-23 — applied 2026-09-24, kept by the 2026-09-27 review

Produced in-session by Claude, at the user's request. **This is a review, not a native read.** All six
were applied on 2026-09-24 on Claude's recommendation, after the user declined to rule on them row by
row — to `app/(app)/cv/copy.ts`, and through to `10` §13 and `e2e/cv.spec.ts` where the same sentences
are quoted.

**The boxes above stayed ☐ at the time and the read was still owed.** The point of `11` §5's rule
is a native ear; what landed was a Claude review, and a record that called it anything else would be
the kind of dishonest instrument this project exists not to build. The 2026-09-27 review judged the
amended strings, not the originals — the originals are in the table below — and kept all six.

| Row | Why | Proposed |
| --- | --- | --- |
| `応募書類を追加する` | It is the **empty** panel; `追加` means adding to a set that already exists. Also clashes in register with `つくる` on the very next button. | `応募書類を登録する` |
| `履歴書が1通必要です。職務経歴書と、補足資料を5つまで追加できます。` | The 読点 after `と` lets `5つまで` read as governing both. It does not — the 職務経歴書 is one or none. | `履歴書が1通必要です。ほかに職務経歴書を1通と、補足資料を5つまで追加できます。` |
| `読み込んだ文を確認して…保存した文が…` | `文` alone is "a sentence". The box beside it is labelled `本文`. | `読み込んだ本文を確認して、必要なら直してください。保存した本文がそのまま評価に使われます。` |
| `${clock} から保存できます。` | A space between a Latin numeral and a Japanese particle — the same family as §6's nakaguro rule. Lives in the template literal in `copy.ts`, not in the checklist row. | `14:32から保存できます。` |
| `34件を抽出。27件は前のバージョンから引き継ぎ、7件が新規。0件を除外。` | Three noun-stops and an unmotivated `は`/`が` alternation; reads as machine output. | `34件を抽出しました。うち27件は前のバージョンから引き継ぎ、7件が新規です。除外は0件でした。` |
| `スキャンした画像のファイルは読み込めないため` | Clunky, and it states the wrong reason — the image carries no text, the app does not refuse it. | `スキャンした画像には文字情報がないため` |

**Accepted as written in the same pass:** the other 16 panel strings, `cv_too_large`'s sentence, and
all three §3 strings as straight `職務経歴書` → `応募書類` swaps. Two worth stating a reason for:
**`記載事項` passes** — in `記載事項 181件` it reads as the ordinary word for what a document states,
carries none of `主張`'s argument sense, and this is the screen `05` §6 deferred the choice to.
**`外す` should stay** — `削除` is the natural Japanese word and is exactly the one invariant 7 cannot
have.

**Two rules generalise, and are now in `05` §6 — kept by the 2026-09-27 AI review, not a native read:** no space
between a Latin numeral and a following Japanese particle, and `本文` not `文` when the referent is a
document's body. Both are asserted over every `ja` string in `app/(app)/cv/copy.test.ts`.

**Not applied at the time:** §3's three prose strings. The 2026-09-27 review settled them (§3).

## 2. Error sentences — `lib/copy/errors.ts`

The other 24 passed on 2026-09-21. One is new:

| | Japanese | Intent |
| --- | --- | --- |
| ✓ | 応募書類が長すぎます。短くしてからもう一度保存してください。 | `cv_too_large` — over the text-size cap, refused before any model call |

The API returns `body_chars` and `max_body_chars` in `detail` when the cap is exceeded. The panel
currently shows only the error sentence and does not render those values. This review judges the
sentence on its own; showing the limit would be a separate UI change.

**2026-09-27 AI review:** ✓ as written, and the number stays out. `長すぎます` then `短くしてから…保存
してください` is how a person would put it, and the sentence reads complete without a figure.

## 3. The three prose strings that still say 職務経歴書 — `10` §8, §9

`応募書類` is the set; these three sentences mean the set but name one member. They are rewritten
sentences rather than stamps, which is why `05` §6 left them for the screen that carries them. No
code renders them yet.

| | Japanese, as it was | Replacement | Where |
| --- | --- | --- | --- |
| ✓ | 職務経歴書との照合 | `応募書類との照合` — the swap, accepted | `05` §3.3's section label, feedback screen |
| → | 数値の裏づけが2か所ありません。職務経歴書の「請求処理を40%短縮」を使う。 | `数値の裏づけがない箇所が2つ。応募書類の「請求処理を40%短縮」を使う。` | the round-level line, feedback screen |
| ✓ | 縦線は評価基準・出題・職務経歴書が変わったところです。 | `縦線は評価基準・出題・応募書類が変わったところです。` — the swap, accepted | Progress's legend |

**2026-09-27 AI review.** The label and the legend are straight `職務経歴書` → `応募書類` swaps and read
as written. The round-level line was more than a swap: it went polite (`ありません。`) then plain
(`使う。`) inside one item, and its siblings in the `直すところ` list are plain-form notes throughout
(`第1問が3分12秒。結論を先に置き、2分以内に収める。`, `「〜っていう」が4回。「〜という」に置き換える。`).
A person writing that list would not switch register mid-item. The replacement matches its siblings: a
noun-stop fact, then a plain directive. `05` §6 now carries the rule. All three are applied to `10`
§8, §9 and §12, `05` §3.3 and §6, and the artboards (`design/*.dc.html`, re-seeded into
`design/suburi-directions.html`); no code renders them yet.

## 4. While the real CV is on screen — `11` §5

**Done 2026-09-23. It failed — see [#27](https://github.com/yutaasakura96/suburi/issues/27).**

- ☑ `spans_rejected` is 0 — and independently, **307 of 307 claims slice back verbatim** from
  `cv_versions.body`, re-checked in Node against `normaliseClaimText` itself rather than trusted from
  the counter.
- ☑ Five quotes sampled per language, by even stride across each document rather than from the top.
  Each is genuinely in the CV. Verbatim is not the problem.
- ☒ **The extraction does not look right against the underlined text.** Sentences are cut at their
  連用形 hinges into fragments that cannot be cited; 27% of the English CV — the whole `PROJECTS`
  block — produced no claims while the 17 certification lines were extracted twice; table rows carry
  their cell breaks inside the span.
- ☑ **Bonus, and it passes:** no claim is drawn from the 履歴書's personal particulars. First claim at
  code point 239, after the `学歴` header at 228 — on a 履歴書 that does carry a real address, telephone
  and date of birth, which the synthetic seed never did.

**A note for whoever re-runs this after #27.** Do not read the underlines by eye and call it checked.
At this granularity the underline covers 83.1% of the 履歴書, 85.0% of the 職務経歴書 and 57.8% of the
English CV, in unbroken runs of 993, 977 and 710 characters — it looks like a highlighted page, and
nothing stands out because almost nothing is bare. What made the defects visible was measuring the
coverage and the gaps, not looking at them. `10` §13's argument for the underline holds for a good
reading; it cannot diagnose a bad one.
