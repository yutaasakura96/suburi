# Design system — Suburi

**Direction B — Instrument.** Every value in this document was read out of the artboards in
`design/`, not chosen here. Where a value is a *consolidation* of several measured values, it says so
and lists what it absorbs, so the build produces one token instead of reproducing sixteen greys.

Source of truth for the drawing: `design/Main.dc.html`, `RoundSetup`, `RecordIdle`, `RecordActive`,
`RecordTranscript`, `TranscriptCorrection`, `FeltPressure`, `Progress`, `History`. Direction A and C
are rejected explorations and were not read for tokens.

---

## 1. What the design is arguing

One claim drives every decision below: **a score is a position, not an amount.** The PRD forbids a
composite score; a bar, a filled meter or a progress ring would smuggle one back in, because anything
with length can be summed by eye. So the only mark that ever represents a score in this system is a
**single dot on a five-tick scale** — at round feedback, at Progress, and as a bare numeral in the
History matrix. Nothing accumulates. Nothing fills.

Everything else follows from that: hairline rules instead of boxes, one accent hue used sparingly to
mean *this one*, and a near-white ground so the accent has somewhere to land.

---

## 2. Colour

All neutrals sit on hue **250** at chroma **0.002–0.008** — a cool grey, never a pure grey. The accent
is hue **230** (blue), the attention colour hue **45** (amber-red). No other hue appears anywhere.

### 2.1 Ground and surface

| Token | Value | Where |
| --- | --- | --- |
| `--ground` | `oklch(0.975 0.002 250)` | Page behind every card. 9 artboards. |
| `--surface` | `#fff` | Every card. |
| `--surface-inert` | `oklch(0.965 0.002 250)` | The primary button *before* it is available (`FeltPressure`, nothing picked). |

### 2.2 Rules

Six weights. Hairlines do structural work in this design, so the differences are load-bearing and
are not collapsed further.

| Token | Value | Meaning | Measured uses |
| --- | --- | --- | --- |
| `--rule-frame` | `oklch(0.88 0.004 250)` | Card border; the vertical split between the 2/3 and 1/3 columns | 27 |
| `--rule-section` | `oklch(0.92 0.004 250)` | Divider inside a card; the rule above a footer stamp; the unselected tab underline | 49 |
| `--rule-axis` | `oklch(0.90 0.004 250)` | The baseline of a five-tick scale; the matrix header rule; version-change verticals on Progress | 60 |
| `--rule-row` | `oklch(0.94 0.004 250)` | Row rule between score rows on round feedback; between options on `FeltPressure` | 15 |
| `--rule-hairline` | `oklch(0.955 0.004 250)` | The finest rule: History matrix rows, History round list, Progress dimension rows | 114 (+27) |
| `--tick` | `oklch(0.86 0.004 250)` | The unfilled ticks of a five-tick scale; tooltip border | 29 (+2) |

*Consolidated:* `0.945` (Progress dot-plot upper/lower bounds, 27 uses) merges into
`--rule-hairline`; `0.85` (the language pill border, 2 uses) merges into `--tick`.

### 2.3 Ink

Nine levels. The artboards contain sixteen; the merges are listed because reproducing sixteen greys
would be an accident, not a decision.

| Token | Value | Meaning | Absorbs |
| --- | --- | --- | --- |
| `--ink-1` | `oklch(0.28 0.008 250)` | Primary text. Also the **fill of the solid primary button** and the border of the outline button. | — |
| `--ink-2` | `oklch(0.34 0.008 250)` | Long-form reading: the question at 19px, the transcript body, the History score numerals | `0.32`, `0.36` |
| `--ink-3` | `oklch(0.40 0.008 250)` | Row labels (dimension names), secondary body, tooltip text | `0.44` |
| `--ink-4` | `oklch(0.48 0.008 250)` | Card subtitle (`日本語・実戦・5問`), inactive nav, muted body | — |
| `--ink-5` | `oklch(0.52 0.008 250)` | Unselected tab label, de-emphasised question recap | — |
| `--ink-6` | `oklch(0.56 0.008 250)` | Caption under a control; the persistent reassurance lines | `0.58` |
| `--ink-7` | `oklch(0.60 0.008 250)` | Follow-up (`深掘り`) rows — one step lighter than the answer they hang off | — |
| `--ink-label` | `oklch(0.62 0.008 250)` | **The section label and metadata level.** Most-used ink in the system (75 uses). | — |
| `--ink-8` | `oklch(0.68 0.008 250)` | Version stamps; the inert button's text | `0.66`, `0.70` |
| `--ink-9` | `oklch(0.78 0.008 250)` | Not-applicable em-dash; faint list markers | `0.72`, `0.80` |

### 2.4 Accent — hue 230

The accent means **this one**: the selected tab, the current round, the score mark. It never means
"good".

| Token | Value | Meaning |
| --- | --- | --- |
| `--accent` | `oklch(0.55 0.09 230)` | The score dot; the selected-tab underline; the selection rail; the active step in the round stepper. 112 uses — the workhorse. |
| `--accent-mid` | `oklch(0.72 0.07 230)` | The live waveform; a due-soon rail; an informational callout rail |
| `--accent-faint` | `oklch(0.82 0.045 230)` | **The trend line only.** Deliberately lighter than the dots it runs through, so the data outranks the fit. |
| `--accent-pale` | `oklch(0.84 0.04 230)` | The furthest-out due rail on Home |
| `--link` / `--link-hover` | `oklch(0.52 0.09 230)` / `oklch(0.42 0.09 230)` | Anchors |

### 2.5 Attention — hue 45

| Token | Value | Meaning |
| --- | --- | --- |
| `--attention-mark` | `oklch(0.58 0.11 45)` | A *mark*: the record dot, a score dot at the low end, the rail on an unsupported CV claim |
| `--attention-ink` | `oklch(0.52 0.11 45)` | *Text*: `録音中`, a low score numeral, `未採点`, `中断`, a missing-follow-up note |

**Attention is never a judgement of the user.** It marks the thing the eye should reach first — a
running recorder, the one dimension that dropped, a record the system failed to score. It is never
applied to a whole row, never to a whole screen, and never to more than a few cells at once (History
uses it on 4 of 63 score cells).

---

## 3. Type

Two families, loaded together:

```
IBM Plex Sans JP — 400, 500, 600
IBM Plex Mono    — 400, 500
```

```css
--font-sans: 'IBM Plex Sans JP', 'Hiragino Sans', system-ui, sans-serif;
--font-mono: 'IBM Plex Mono', 'IBM Plex Sans JP', ui-monospace, monospace;
```

**The mono stack must keep `IBM Plex Sans JP` as its second entry.** Plex Mono has no CJK coverage,
and Suburi sets Japanese in the mono role constantly (`第1問 / 5問`, `未実施`, `評価基準 v1.2`,
`3:12・約250字/分`). Without the fallback those strings drop to a system default mid-line. This is
why the pairing appears in all 170 mono declarations and must not be "tidied up".

### 3.1 Scale

| px | Role |
| --- | --- |
| 34 | The rewrite percentage on `TranscriptCorrection` — the one number on a screen |
| 30 | The elapsed timer while recording |
| 22 | The felt-pressure question |
| 21 | Wordmark `素振り` |
| 19 | **The interview question, when it is the task.** Line-height 1.9. |
| 17 | Card title (`行動面接`) |
| 15 | Body; option labels; the editable transcript |
| 14 | Control labels; tab labels on Progress; sub-headings |
| 13 | Default UI text; row labels; score numerals |
| 12 | Caption; metadata |
| 11 | Section label (mono, tracked, uppercase); pill |
| 10 | Version stamp |
| 9 | Version-change marker on a Progress axis |

**Finding — three off-scale sizes.** `11.5px` (7 uses), `12.5px` (6) and `13.5px` (6) appear only in
`History.dc.html` and `FeltPressure.dc.html`. Build them as **11, 13 and 13** respectively; nothing
in the layout depends on the half-pixel, and a half-step scale is not a scale.

### 3.2 Weight, tracking, leading

- Weights used: **400**, **500** (emphasis, selected option, score numeral in attention state),
  **600** (wordmark, card title). Nothing heavier.
- Tracking: `0.16em` on the 11px mono section label — the signature of this design. `0.18em` on the
  `SUBURI` lockup, `0.08em` on the mono step counter, `0.06em` on `素振り`, `0.04em` on control labels.
- Leading: **1.9** for a question the user must absorb; **1.95** for transcript text;
  **1.75–1.85** for prose; **1.6–1.7** for tight captions.

### 3.3 The section label

One component carries the instrument character more than any other:

```css
font-family: var(--font-mono);
font-size: 11px;
letter-spacing: 0.16em;
text-transform: uppercase;
color: var(--ink-label);
```

**`text-transform: uppercase` is only ever set on Latin text.** All 20 uses were verified
Latin-only. On Japanese the property silently does nothing, so a Japanese section label must be
distinguished by tracking and ink alone — never by adding `uppercase` and assuming it did something.
Japanese section labels in the artboards (`直すところ 3件`, `職務経歴書との照合`) use 11–12px mono at
`0.1–0.16em` with no transform.

---

## 4. Space and frame

- **Page padding:** `40px 44px`. Card gap: `14px`.
- **Card:** `--surface` on a 1px `--rule-frame` border. **No radius anywhere. No shadow anywhere.**
- **Card header:** `padding: 20px 32px`, `border-bottom: 1px solid var(--rule-frame)`.
- **Card body:** `26–36px` top, `32px` sides. The three-column grid is
  `repeat(3, minmax(0, 1fr))` with the main region at `span 2` and a
  `border-right: 1px solid var(--rule-frame)` between.
- **Controls are 48px tall**, square, `padding: 0 26px` when inline.
- **Row rhythm:** `11px 0` (dense: score rows, matrix), `13px 0` (History round list),
  `15px 0` (Home due list, felt-pressure options).
- **Gaps** step `7 · 9 · 10 · 11 · 12 · 13 · 14 · 18 · 20 · 22 · 24 · 26 · 28 · 40`. Nav items sit at
  `28px`; the two-column split inside a region at `40px`.

Artboard frames: 1280px wide throughout. Heights `760` (record states), `800` (setup), `860`
(felt pressure), `900` (history), `1000` (correction), `1060` (progress), `1500` (home + feedback).

---

## 5. Components

### 5.1 App header

`素振り` at 21px/600/`0.06em`, then `SUBURI` as an 11px tracked mono lockup in `--ink-label`, gap
`14px`, baseline-aligned. Nav right: `Home · Progress · History · CV`, 13px, gap `28px`, inactive at
`--ink-4`; the active item takes `--ink-1` plus `border-bottom: 2px solid var(--accent)` and
`padding-bottom: 2px`.

### 5.2 Round header (in-round screens)

Replaces the app header once a round is running — there is no navigation out of a live round. Left:
title 17px/600 plus `日本語・実戦・5問` at 13px `--ink-4`. Right: the **round stepper** — one `26×2px`
bar per question, gap `7px`, `--accent` when done and `--rule-section` when not — then
`第1問 / 5問` in 11px mono at `0.08em`.

### 5.3 Score row — marker on a five-tick scale

The central component. Per row:

```
[ label 100px ] [ scale 300px ] [ numeral 12px, right-aligned ] [ flex spacer ]
```

The scale is `display: grid; grid-template-columns: repeat(5, 1fr); height: 16px; position: relative`
with an absolutely-positioned baseline (`top: 7px`, 1px, `--rule-axis`) spanning the full width. Each
of the five cells centres either a **tick** (`1×6px`, `--tick`) or, at the scored position, a **dot**
(`9×9px`, `border-radius: 50%`, `--accent`). The numeral is 13px mono, inheriting ink — except at the
low end, where dot and numeral take `--attention-mark` / `--attention-ink`.

Rows are separated by `--rule-row`; the last row also takes a bottom rule. Seven dimensions in
Japanese (`構成 · 根拠 · 関連性 · 流暢さ · 正確さ · 長さ・配分 · 敬語`), six in English (`敬語`
absent).

**The trailing flex spacer is empty by design** — see §7.

### 5.4 Dot plot (Progress)

The same mark, over time. A `360×40px` SVG per dimension row, label column `96px`, numeral column
`22px`.

- Score → y: **5→4, 4→12, 3→20, 2→28, 1→36**. Eight pixels per step; the plot is bounded by 1px
  `--rule-hairline` lines at `y=4` and `y=36`, so the frame *is* the top and bottom of the scale.
- Dots `r=4` in `--accent`. The most recent point, when it is the one being annotated, is `r=5` with a
  2px `#fff` stroke.
- **Trend line:** a single least-squares line in `--accent-faint` at 2px with round caps, inset to
  `x=18 … 342`. Drawn only at **≥5 first attempts** for that dimension × language × round type.
  Below that: bare dots plus a count of how many more are needed.
- **Version-change verticals:** 1px `--rule-axis`, full height, with a 9px mono label at `0.06em` in
  `--ink-8`, offset `+5px` from the line. Labels follow the panel's language (`出題 v1.0 /
  評価基準 v1.2 / 応募書類 v3` — `gen v1.0 / rubric v1.2 / CV v3`).
- **Tooltip:** `#fff` on a 1px `--tick` border, `padding: 5px 9px`, 10px mono at `0.04em` in
  `--ink-3`, content `2026-09-12・構成 4・第1問`.
- **Not-scored state:** the plot area is replaced by a 1px `--rule-hairline` line and the note
  `Not scored in English` at 11px `--ink-9`; the numeral column shows `—` in `--ink-9`.

### 5.5 Matrix (History)

`grid-template-columns: 196px repeat(7, minmax(0, 1fr)) 58px 34px`.

Header cells: `padding: 0 0 10px`, centred, 11px `--ink-label`, `border-bottom: 1px solid
var(--rule-axis)`; the TIME header is right-aligned 10px mono at `0.08em`.

Body cells: `padding: 11px 0`, `border-bottom: 1px solid var(--rule-hairline)`.

- **Answer row:** question label 13px (`Q1　最も困難だった状況と対応`, ideographic space after the
  number, ellipsised); seven score numerals 13px mono centred in `--ink-2`/400, or
  `--attention-ink`/500 at the low end; duration 12px mono right-aligned in `--ink-label`; a 34px
  play affordance.
- **Follow-up row:** label indented `18px`, 12px in `--ink-7`, prefixed `└ 深掘り`. Scores render the
  same but the whole row sits one ink level back.
- **Missing follow-up:** a single cell at `grid-column: span 7` in `--attention-ink` —
  `深掘りが生成されませんでした。空欄として記録しています。`

### 5.6 Selection rail

One idiom for "this is the selected one", used by both the History round list and the felt-pressure
options: a **2px-wide vertical bar** to the left of the item — `34px` tall in a list, `22px` beside an
option — `--accent` when selected, `--rule-row` when not. Selected items also step ink
(`--ink-3`→`--ink-1`) and weight (400→500). Home's due list uses the same bar at `5×26px`, filled by
urgency: `--accent` → `--accent-mid` → `--accent-pale` → `oklch(0.90 0.004 250)` for never-attempted.

### 5.7 Buttons

| Variant | Spec |
| --- | --- |
| **Primary, solid** | `background: var(--ink-1)`, `#fff`, 48px, 14px `0.04em`, centred |
| **Primary, inert** | `background: var(--surface-inert)`, `--ink-8`, `1px solid var(--rule-section)` — used until a required choice is made |
| **Outline** | `1px solid var(--ink-1)` on `--surface`, 48px, `padding: 0 26px`, with a leading glyph: an 11px `--attention-mark` circle to start recording, a 10px `--ink-1` square to stop |

Every primary button carries a caption beneath it in 12px `--ink-6` stating what pressing it commits
to — `送ると、いま直した文から深掘りが1問つくられます。` — and, where relevant, a mono version stamp
below that.

### 5.8 Callout rail

For a single flagged sentence: a `3px`-wide full-height bar, gap `10px`, text 12px/1.7 in `--ink-3`.
`--attention-mark` for an unsupported claim, `--accent-mid` for information, `--ink-9` for merely
unused material.

### 5.9 Version stamp

Bottom-right of every screen that shows or produces a score. 10px mono, line-height 1.9, `--ink-8`,
above it a 1px `--rule-section` rule with `padding-top: 12px`. Content is the round's stamps joined by
nakaguro: `評価基準 v1.2・出題 v1.0・応募書類 v3`.

---

## 6. Japanese copy rules

Errors already made and fixed in this project. Each line below is a rule because it was once a bug.

- **Nakaguro, not a Latin middle dot.** A list inside Japanese text uses `・` with **no surrounding
  spaces**: `日本語・実戦・5問`. A spaced `·` is Latin typography and reads as foreign. The one
  remaining ` · ` in the artboards is inside an English sentence (`Defaults to 行動面接 · 日本語 ·
  realistic · 5.`) and is correct there.
- **Counters.** `件` for items of feedback (`直すところ 3件`), `問` for questions (`5問`), `字` for
  characters, `分`/`秒` for time. **Not `点`** — that counter implies marks awarded, which is exactly
  what this product refuses to do.
  **The ban is on `点` as a counter, not on the character.** `採点`, `未採点` and `採点をやり直す` are
  the established words for scoring and are already in `10`; what may never appear is a digit followed
  by `点`. Narrowed in #13, where a blanket ban was written as a test and immediately failed on
  `採点`.
- **`録り直し`, not `撮り直し`.** `撮る` is for photography and video.
- **Ideographic space after a question number** in a table label: `Q1　最も困難だった状況と対応`.
- **Vocabulary settled by native read:** `深掘り` (not `追撃`) for a follow-up question; `緊張度`
  (not `体感圧力`) for felt pressure; `職務経歴書` (not `経歴書`) — this is a mid-career move, not a
  new-graduate one.
- **`応募書類`, not `職務経歴書`, is the Japanese stamp word.** The Japanese CV is a *set* — a required
  `履歴書`, an optional `職務経歴書`, and up to five additional documents (`CONTEXT.md`). `職務経歴書`
  names one member of that set, so using it for the whole set made a stamp that pointed at the wrong
  thing. Every version label reads **`応募書類 v{n}`** in Japanese and **`CV v{n}`** in English, and
  both are derived by the app, never typed. `職務経歴書` stays in use where it means that one
  document. **`応募書類` passed its native read with the error catalogue on 2026-09-21** (#13).
  **Not yet changed, deliberately:** three *prose* strings on the feedback and Progress screens still
  say `職務経歴書` where they now mean the set — §3.3's section label `職務経歴書との照合`, the
  round-level line `数値の裏づけが2か所ありません。職務経歴書の「請求処理を40%短縮」を使う。`, and
  Progress's legend `縦線は評価基準・出題・職務経歴書が変わったところです。` (`10` §8, §9). They are
  rewritten sentences, not stamps, so they go through a native read with the screens that carry them
  rather than being swapped here. Recorded in `10` §12 so it is not lost.
- **Never set Japanese in a Latin-only mono stack** (§3), and never rely on
  `text-transform: uppercase` for a Japanese label (§3.3).

- **Rules the error catalogue enforces by test, added in #13.** `lib/copy/errors.test.ts` asserts
  them for every code, so they are mechanical rather than a matter of care: every `ja` string ends in
  `。`; no two codes share a sentence in either language (`03` §8 — "no generic sentence where a
  specific one is available" is only real if two failures cannot read alike); and **no string contains
  `{`, `}`, `$` or `%`**. The last is a privacy rule wearing a typography rule's clothes — a catalogue
  with no placeholder has no slot for a value to arrive in, so `03` §8's never-log list is unreachable
  from copy by construction.
- **Mode words are `実戦` and `練習`, never `練習モード`.** `モード` appears nowhere in `10`, in this
  document or in `CONTEXT.md`; the modes are written bare or as `練習ラウンド`. Caught in #13 on
  `pressure_not_applicable`, where the English `practice mode` had been carried across literally.

**#13's error catalogue passed its native read on 2026-09-21.** All 24 `ja` strings in
`lib/copy/errors.ts` were read and accepted; one word changed. Four rules came out of it:

- **`質問` is the noun for a question; `出題` is only the generator's stamp word** (`出題 v1.0`, and
  the Progress legend `縦線は評価基準・出題・…`, which names the generator changing). An interviewer
  asks a `質問`. Every `出題` in `10` was already a stamp, so no screen string changed. The counter
  stays `問`.
- **A version is `バージョン`, never `版`.** `版` reads as print, not software, and the stamp beside it
  already says `v3`. `cv_unchanged` changed to `新しいバージョンは作成しませんでした。`
- **`応募書類` passed.** It is the ordinary word for the 履歴書 + 職務経歴書 set, and the stamp stays
  `応募書類 v{n}`.
- **Claim is `記載事項`, chosen in #15 — proposed until it is read in place in #20.** No catalogue
  string needs one: `cv_extraction_failed` names the documents, not the claims. The CV screen is the
  first that counts claims (`記載事項 34件`), so the word was chosen there, from #13's leading
  candidate. `主張` is rejected because it reads as argument. `app/(app)/cv/copy.test.ts` fails any CV
  screen string containing `主張` or `版`.

The first two are enforced across the catalogue by `lib/copy/errors.test.ts`.

**Two mechanical rules from #20's reviewed draft, applied 2026-09-24 — and *not* a native read.**
`docs/checklists/native-read-cv.md` §1's boxes are still unticked and #20 still owes the read; these
two are recorded here early only because they are mechanical enough to be tested, and
`app/(app)/cv/copy.test.ts` asserts both. The read may still overturn them.

- **No space between a Latin numeral and the Japanese that follows it.** `14:32から保存できます。`, not
  `14:32 から`. The same family as the nakaguro rule — the space is Latin typography, and Japanese
  sets the particle tight against the numeral.
- **A document's body is `本文`, never a bare `文`.** `文` alone is one sentence. The import caption
  read `読み込んだ文を確認して…` while the box beside it was labelled `本文`. `文字` is unaffected.

**Every new Japanese string needs a native read before it ships.** Five of the six rules above came
from one review pass, not from care at authoring time.

---

## 7. Decision 22 — settled: no ambient per-dimension justification

**Decided in Phase 3, against the measured drawing.** A score row does **not** carry a written reason
beside it. Provenance is delivered two other ways:

1. **The round-level list.** `直すところ 3件` / `良かったところ 1件` already name the specific thing,
   quote the user's own words back, and cite the CV. The 長さ・配分 score of 2 on `Main.dc.html` has
   its reason in that list — `第1問が3分12秒。結論を先に置き、2分以内に収める。` The score that
   mattered is already explained.
2. **On demand, per row.** Hovering or focusing a score row reveals the transcript span the score was
   read from, using the tooltip already specified in §5.4. It must be reachable by keyboard focus, not
   hover alone.

*Why not ambient:* seven dimensions × five answers is thirty-five strings of prose per round. That is
the parallel commentary stream decision 19 rejected Direction A for, and it would bury the three items
the user is meant to act on. The 300px scale plus a trailing empty flex cell in §5.3 is **not spare
room waiting for text** — the empty cell is what keeps seven rows scannable as a single column of dot
positions. Filling it destroys the one thing Direction B was chosen for.

*What this gives up:* the scorer earns trust more slowly for the five dimensions that did not make the
round-level list. Accepted — §1 of the brief wants an honest instrument, and an instrument shows its
reading before it shows its reasoning.

## 8. Decision 24 — settled: the History matrix needs no guard

**Tested in Phase 3 against the built matrix, as decision 24 required.** The disclaimer stays out and
the layout does not change. Four measured properties already stop a row reading as a total:

1. **No terminal blank and no total column.** The row ends with a duration and a play affordance — the
   place the eye would look for a sum is occupied by other kinds of data.
2. **The duration is typographically demoted** — 12px `--ink-label` against the scores' 13px
   `--ink-2`. One size step and three ink steps mean `3:12` cannot be misread as an eighth score.
3. **Follow-up rows break the block.** Every answer row is followed by a row a full ink level lighter,
   so the matrix is never more than one row of uniform numerals deep.
4. **The attention colour pulls the eye to single cells.** Four of sixty-three scores are amber at
   weight 500; that is a strong signal to read *positions*, which is the opposite of summing.

Direction C's matrix had none of these and had to caption itself. This one does not.

---

## 9. Open

- **Practice mode's hard recording cap** (decision 23) is still undrawn. It is a runaway-recording
  guard, not a design element — settle it in Phase 4 against the storage and latency questions.
- **The bilingual chrome question.** Progress localises its own version labels per panel
  (`応募書類 v3` / `CV v3`), which implies chrome follows the *round's* language rather than an app
  setting. Home's English caption names round types in Japanese (`Defaults to 行動面接 · 日本語 · …`).
  Both are defensible; nothing yet states which rule the build follows. Phase 4.
  **Still open.** The CV screen (`10` §13) settles it *for that screen only* — each panel's chrome is
  in its own language, because each panel is about one language's documents. That is a local answer to
  a local question and sets no precedent for the round screens.
- **Hover surface and focus ring are undrawn.** §10.2 aliases shadcn's `--accent` (hover) to
  `--ground` and `--ring` (focus) to `--mark` as placeholders. §7 requires keyboard focus on score
  rows, so the focus ring is needed, not optional — it wants a design read, not a default.

---

## 10. Implementation — Tailwind and shadcn

Decided 2026-09-13 (`06`, Phase 5d). This section is how §2–§4 reach code. **§2–§4 stay the source;**
nothing here adds a value, it only names where each one lands.

### 10.1 Tailwind, CSS-first

Tailwind v4: `@import "tailwindcss"` in `app/globals.css`, the `@tailwindcss/postcss` plugin in
`postcss.config.mjs`, no `tailwind.config` file. Two namespaces are wiped before any token is defined:

```css
@theme {
  --color-*: initial;   /* §2: no hue exists that this document does not name */
  --shadow-*: initial;  /* §4: no shadow anywhere */
}
```

**Acceptance check at scaffold:** `bg-blue-500` generates no CSS, and a shadcn `Button` renders square
with no shadow. **The wipe survives shadcn's `@theme inline` block** — verified 2026-09-14 against the
Tailwind docs and a local build on 4.3.3. A `--color-*: initial` reset followed by `@theme inline {
--color-background: var(--background) }` generates `bg-background` and nothing from the default
palette: no `bg-blue-500`, no `text-white`. The check stays anyway, because it is what catches a
later edit that breaks this.

**Names in code.** Every §2 token keeps its name, exposed as a Tailwind colour (`--ground` →
`bg-ground`, `--rule-frame` → `border-rule-frame`, `--ink-label` → `text-ink-label`) — **except the
accent family:**

| `05` name | In code | Why |
| --- | --- | --- |
| `--accent` | `--mark` | shadcn reserves `--accent` / `bg-accent` for the hover surface in every vendored component. Keeping §2.4's name would paint hover states in the score colour. |
| `--accent-mid` | `--mark-mid` | Same family, renamed together |
| `--accent-faint` | `--mark-faint` | |
| `--accent-pale` | `--mark-pale` | |

This document keeps saying `--accent` so it stays traceable to the artboards.

**Fonts are §3's two stacks as `--font-sans` and `--font-mono`, in §3's order, including the
`IBM Plex Sans JP` fallback in the mono stack** — but the family names are not written literally.
Both families are loaded by `next/font/google`, which downloads every file at build time and serves
them from this origin (measured on the 16.3.5 Turbopack build, 2026-09-16: 380 `woff2` slices, 379 of
them `unicode-range`-scoped). **Each stack begins with the loader's CSS variable**, because that
variable is the only form that carries the metric-adjusted fallback Next generates beside each family
— `var(--font-plex-sans-jp)` resolves to `"IBM Plex Sans JP", "IBM Plex Sans JP Fallback"`, and the
`Fallback` face is what holds the layout still before the webfont arrives. Spelling the family
literally silently drops it, and under Next's webpack build the literal name does not resolve at all.

```css
--font-sans: var(--font-plex-sans-jp), 'Hiragino Sans', system-ui, sans-serif;
--font-mono: var(--font-plex-mono), var(--font-plex-sans-jp), ui-monospace, monospace;
```

The mono stack's second entry is §3's load-bearing CJK fallback in its variable form; it is the same
rule and is removed for the same reason: never.

### 10.2 shadcn's variables alias §2

shadcn components are written against a fixed semantic vocabulary. Each variable points at a §2 token
so vendored components render in this design without being rewritten:

| shadcn | Points at | Note |
| --- | --- | --- |
| `--background` / `--foreground` | `--ground` / `--ink-1` | |
| `--card` / `--card-foreground` | `--surface` / `--ink-1` | |
| `--popover` / `--popover-foreground` | `--surface` / `--ink-3` | The tooltip, §5.4 |
| `--border` / `--input` | `--rule-frame` | |
| `--primary` / `--primary-foreground` | `--ink-1` / `--surface` | The solid primary button, §5.7 |
| `--secondary` / `--muted` | `--surface-inert` | |
| `--secondary-foreground` | `--ink-8` | The inert button's text |
| `--muted-foreground` | `--ink-6` | Captions |
| `--accent` / `--accent-foreground` | `--ground` / `--ink-1` | **Placeholder** — no hover surface is drawn (§9) |
| `--destructive` | `--attention-ink` | |
| `--ring` | `--mark` | **Placeholder** — no focus ring is drawn (§9) |
| `--chart-1` … `--chart-5` | `--mark` | Never rendered; aliased on-hue so an accidental use cannot add a colour |
| `--sidebar-*` | `--surface` / `--ink-1` / `--rule-frame` | Unused |
| `--radius` | `0` | §4. Every derived `--radius-*` is a multiple of it — **and each one is declared**, see below. The score dot's `50%` (§5.3) is set on the mark, not from the scale |

**`--radius: 0` on its own does not square a vendored component.** The Base UI Button ships
`rounded-lg` and `rounded-[min(var(--radius-md),10px)]` as literal utilities, which read Tailwind's
own `--radius-*` scale rather than `--radius`. So the derived scale is declared from `--radius`
(`--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`), which is what makes `rounded-lg`
compute to `0px`. The §10.1 acceptance check — a `Button` rendering square — is what catches this
being undone.

**No `.dark` block.** The design draws one theme.

### 10.3 Rules

- **shadcn on Base UI** — `npx shadcn@latest init -b base`. `components/ui/` is vendored source;
  restyle it in place. `cssVariables: true`, which cannot be changed after init.
- **Outside `components/ui/`, build against `05` names** (`bg-surface`, `border-rule-frame`), never
  shadcn's (`bg-card`, `border-border`). The aliases exist so vendored components render correctly,
  not as a second vocabulary to design in.
- **No shadcn `Progress`, `Slider` or chart component ever displays a score**, or anything with length
  or fill that could be summed by eye. §1 and invariant 1. The six marks in §5 are built by hand.
- Add a component when a screen needs it, not in advance of one.
