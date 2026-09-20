# Screen specifications — Suburi

Nine screens, extracted from the Direction B artboards in `design/`, **and a tenth — the CV screen
(§13) — specified from `05` components with no artboard behind it.** Tokens referenced here are
defined in [`05-design-system.md`](05-design-system.md); this document specifies **what each screen
contains, in what state, and what it must refuse to do**.

Every screen: 1280px wide, `--ground` behind, `padding: 40px 44px`, cards gapped `14px`. Desktop
only in v1 (decision log, 2026-09-12). Heights below are the artboard heights and are a content
minimum, not a fixed frame.

**Sample data is one coherent record** (decision 28), and the specification depends on it: the
行動面接 round of 2026-09-12 appears on Home, round feedback, all three record states, transcript
correction, felt pressure, Progress and History with the *same* scores, durations and version stamps.
A build that changes one must change all.

---

## 1. Home — `Main.dc.html` (upper card)

**Purpose.** Answer "what should I practise?" without deciding for the user.

### Layout
App header (§5.1), then a 3-column grid: **Due** at `span 2`, **First attempts** in the last column,
divided by `--rule-frame`. Column padding `30px 32px`.

### Due list
Section label `DUE`, and on the same baseline, right-aligned, `Suggestion only — start anything` at
12px `--ink-label`. That caption is a requirement, not decoration — the list must never read as an
assignment.

Each row: `padding: 15px 0`, `border-top: 1px solid --rule-section`, gap `20px`.

| Cell | Width | Spec |
| --- | --- | --- |
| Urgency rail | `5×26px` | `--accent` (most due) → `--accent-mid` → `--accent-pale` → `oklch(0.90 0.004 250)` (never attempted) |
| Round type | 168px | 15px/500 |
| Language | 90px | 13px `--ink-4` |
| Spacing bar | flex | `2px` tall, width = proportion of the interval elapsed, in the rail's colour. **Absent entirely when never attempted.** |
| Interval | — | 13px mono `--ink-3`, e.g. `18d`; or `未実施` in `--ink-label` when never attempted |

Sample rows, in order: `CEO / final · English · 未実施`; `行動面接 · 日本語 · 18d` (bar full);
`HR · English · 11d` (61%); `技術面接 · 日本語 · 6d` (33%).

**Never-attempted sorts first and shows no bar.** A bar at 0% would read as "not due"; the point is
that it has never been done at all.

### First attempts
Section label, then one block per language: label 13px and a `12 / 30` mono count at `--ink-4` on one
baseline, over a `3px` track (`--rule-section`) filled to proportion in `--accent`.

This is the **only** filled bar in the system, and it is legitimate: it counts attempts against a
target, not quality. It must never appear on a screen where it could be confused with a score.

### Start
Solid primary button `Start a round`, then 12px/1.6 `--ink-6`:
`Defaults to 行動面接 · 日本語 · realistic · 5. All four overridable.`

### Empty state
Zero rounds ever: Due shows nothing to be due from. Show the four round types unsorted with `未実施`
and no bars; First attempts shows `0 / 30` with empty tracks; the caption becomes the primary content.

---

## 2. Round setup — `RoundSetup.dc.html` (800px)

**Purpose.** Confirm or override four defaults, and state what the round will be scored against.

3-column grid; controls at `span 2`, rationale in the last column.

### Controls
Five groups, each a section label over a row of **tab-style options** at `gap: 28px`: 15px, selected
at weight 500 with `border-bottom: 2px solid var(--accent)` and `padding-bottom: 7px`; unselected at
`--ink-5` with `--rule-section`.

| Group | Options | Default |
| --- | --- | --- |
| Round type | `行動面接 · 技術面接 · HR · CEO・最終` | 行動面接 |
| Language | `日本語 · English` | 日本語 |
| Length | `3問 · 5問 · 7問` | 5問 |
| Mode | `実戦 · 練習` | 実戦 |
| Role context | three equal cards | 求人票・メモ |

**Mode carries its own explanation inline**, both modes at once, the selected one at `--ink-3` and the
other at `--ink-6`:
`実戦 — 一発勝負。1回答 最長4分。講評はラウンド終了後にまとめて出します。` /
`練習 — 録り直し可。時間制限なし。回答ごとに講評。`

**Role context is required** and labelled `必須。3つは対等です。` — three cards in a
`repeat(3, 1fr)` grid at `gap: 24px`, each a 14px title over a 12px/1.7 detail, underlined
`2px` selected/unselected as above:

- `求人票・メモ` → `Mercari_SRE_2026.pdf`
- `AIに調べさせる` → `調査済み・開始前に編集できます`
- `一般練習` → `進捗では別に集計します`

When both a file and an AI-researched context exist, a `--accent-mid` callout rail states the
precedence: `求人票とAI調査の両方があります。ファイルを優先して使います。`

### Rationale column
- `WHY THESE DEFAULTS` → `行動面接・日本語は18日空いています。既定値はそこから決めました。` then
  `提案です。4つとも変えられます。` at `--ink-label`.
- `SCORED AGAINST` → `応募書類 v3` with its date `2026-08-30` in mono.
- Solid primary `このラウンドを始める`, then an 11px mono stamp:
  `5問＋深掘り5問・最長 約40分` / `評価基準 v1.2・出題 v1.0`.

**The duration estimate is derived, not written:** `length × (1 + follow-ups) × per-answer cap`.
5 × 2 × 4min = 40min. Changing the length or the cap must change this string.

### Refuses
No "recommended" badge, no scoring of the choice, no memory of "your usual" beyond the interval
arithmetic already shown.

---

## 3–5. Question and record — three states, 760px each

One screen, three specified states (decision 21) — `RecordIdle`, `RecordActive`,
`RecordTranscript`. All three share the round header (§5.2) and a footer:

> `講評はラウンドが終わってからまとめて出ます。途中では何も出ません。` · `出題 v1.0・応募書類 v3`

That sentence is the PRD's withheld-feedback requirement rendered as a promise on every frame. It is
absent only from the transcript state, which substitutes:
`この先も続きます。全文は次の画面で直せます。音声も未修正の文字起こしも消えません。`

### 3. Asked — `RecordIdle.dc.html`
- A 15px speaker glyph (1.2 stroke, `currentColor`) in `--ink-label` with
  `読み上げました。文字は残します。` at 12px. **Realistic mode speaks the question; the text stays
  on screen.** Practice mode is text-only, so this line and glyph are omitted.
- The question at **19px/1.9** in `--ink-2`, `max-width: 880px`. This is the largest reading text in
  the app and the only thing the screen is asking the user to do.
- A `--rule-row` divider.
- Outline button `録音を開始` with an 11px `--attention-mark` dot, then `最長 4分` in mono
  `--ink-label`.
- Two lines at 12px/1.75 `--ink-6`: `一発勝負です。録り直しはできません。` /
  `止めたあとに文字起こしを直せます。`

### 4. Recording — `RecordActive.dc.html`
- Status replaces the speaker line: a 9px `--attention-mark` dot plus `録音中` in `--attention-ink`.
- Question unchanged at 19px — **it does not shrink or move when recording starts.**
- **Timer:** `1:04` at 30px/500 mono `0.02em`, with `/ 4:00` at 13px `--ink-label` on the same
  baseline.
- **Waveform:** a 34px-tall row of `2px` bars at `gap: 3px` in `--accent-mid`, heights varying
  `5–28px`, terminated by a 1px `--rule-axis` line filling the remaining width with `margin-left: 4px`
  — the un-elapsed remainder of the take. The waveform is `--accent-mid`, *not* the attention colour:
  the recording indicator is the alarm, the waveform is just evidence of input.
- Outline button `停止して文字起こし` with a 10px `--ink-1` square, then
  `4分で自動的に止まります。そこまでの録音は残ります。`

**At the cap** the take ends automatically and what was captured is kept. There is no warning
countdown, no grace period, and no prompt asking whether to continue.

### 5. Transcript back — `RecordTranscript.dc.html`
- The question is **demoted to 14px/1.85 `--ink-5`** — it has been answered; it is now context.
- Section label `Raw transcript — 未修正`, and right-aligned `3:12・約250字/分・800字`.
  **These three figures must be mutually consistent** — 3:12 at ~250 字/分 is 800 字, and the sample
  body is exactly 800 characters. A build that fakes any one of them breaks the others.
- Transcript body: `border-left: 2px solid --rule-axis`, `padding-left: 18px`, 15px/1.95 `--ink-2`,
  clipped at `232px` with `overflow: hidden` — the screen shows an excerpt and says so.
- Solid primary `文字起こしを直す`, caption
  `言った通りに直してから送ります。書き直しの量は記録しますが、評価には使いません。`

**The raw transcript is shown with its ASR errors intact** (the sample contains 決済期版 for 決済基盤,
市販機 for 仕掛かり). Cleaning it before display would hide the thing the next screen exists to fix.

---

## 6. Transcript correction — `TranscriptCorrection.dc.html` (1000px, interactive)

**The design question this artboard was built to answer:** does the rewrite figure read as an
accusation while you edit? It is one of only two artboards with working controls.

3-column grid; editor at `span 2`, rewrite meter in the last column.

### Editor
- Question recap at 14px/1.85 `--ink-5`, then a `--rule-row` divider.
- Section label `YOUR ANSWER — EDIT FREELY`, right-aligned live count `800字 → 812字` in mono
  `--ink-label`.
- `<textarea>`: `height: 300px`, `resize: none`, `1px solid --rule-frame`, `padding: 16px 18px`,
  **sans** 15px/1.95 `--ink-1`, `outline: none`. Sans, not mono — this is the user's own words, not
  machine output.
- Below: `RAW — KEPT, NEVER REPLACED` over the original in a `2px --rule-section` left rail at
  13px/1.9 `--ink-label`. The raw text is **always visible while editing**, never behind a toggle.

### Rewrite meter
- `Rewrite` label, then the percentage at **34px/500 mono** beside
  `の文字が、未修正の文字起こしから変わりました` at 12px `--ink-6`.
- A `14px`-tall scale: a 1px `--rule-axis` baseline at `top: 6px`, and a **1px vertical tick** in
  `--accent` at the percentage position, `transform: translateX(-0.5px)`. Endpoints `0%` / `100%` in
  10px mono `--ink-8`.
- Then, at 12px/1.8 `--ink-4`, the two lines that do the actual work:
  `記録するだけです。誤認識と言い直しの区別はしません。` /
  `評価にも進捗にも使いません。あとで認識精度を見直すために残します。`

**The figure is a 1px tick, not a filled bar** — the same argument as §1 of the design system. A
filled bar would make a large rewrite look like a large *offence*.

### Computation
Percentage = `round((1 − LCS(raw, edited) / max(|raw|, |edited|)) × 100)`, clamped to 0–100, where
LCS is the longest common subsequence by character. Implemented in the artboard and specified here so
the build does not substitute a different metric — a word-diff or an edit-distance ratio produces
visibly different numbers for the same edit.

### Commit
Solid primary `この回答を送る`, caption
`送ると、いま直した文から深掘りが1問つくられます。`, then `3:12・約250字/分` /
`出題 v1.0・応募書類 v3`.

**The follow-up is generated from the corrected text, not the raw text.** Both are stored.

---

## 7. Felt pressure — `FeltPressure.dc.html` (860px, interactive)

**The design question:** does picking 1–5 feel like scoring yourself? Asked **once per round**,
immediately before feedback, with the stepper showing all five steps complete.

3-column grid; question at `span 2`, disclaimers in the last column.

- Section label `BEFORE THE FEEDBACK`.
- Question at **22px/1.65/500**: `いまのラウンド、どのくらい緊張しましたか。` Then
  `近いものを1つ選んでください。講評の前に一度だけ聞きます。` at 13px/1.8 `--ink-5`.
- Five options, `padding: 15px 0`, `border-top: 1px solid --rule-row`, gap `18px`, using the selection
  rail (§5.6) at `2×22px`. Value in 11px mono in a 10px column; label at 15px/1.6.

| | Label |
| --- | --- |
| 1 | まったく緊張しなかった |
| 2 | 少し意識した |
| 3 | それなりに緊張した |
| 4 | かなり緊張した |
| 5 | 頭が真っ白になった |

**The labels are descriptions of a state, not degrees of a quantity** — that is what stops the scale
reading as self-scoring. Renumbering or shortening them to `1 … 5` would undo the artboard's answer.

### Disclaimers — `WHAT THIS IS NOT`
Three lines at 12px/1.85 `--ink-4`:
`採点ではありません。選んだ数字で講評は変わりません。` /
`進捗グラフには出ません。上げるものでも下げるものでもありません。` /
`回答ごとではなく、ラウンドごとに1回だけ聞きます。`

### States
- **Nothing picked:** button is `--surface-inert` / `--ink-8` / `1px --rule-section`; hint
  `1つ選ぶと講評に進めます。`
- **Picked:** button becomes solid `--ink-1` / `#fff`; hint `緊張度 4 をこのラウンドに記録します。`
- Stamp: `評価基準 v1.2・出題 v1.0・応募書類 v3`.

**This screen cannot be skipped, and it cannot be answered after the feedback is seen** — the whole
point is that the reading is taken before the result is known. The value is recorded on the round and
surfaced on round feedback and History as `緊張度 4 を講評前に記録`.

---

## 8. Round feedback — `Main.dc.html` (lower card)

**The screen the product exists for.** Rendered while the user is still at the machine (PRD §9).

Header: `行動面接` 17px/600, `日本語・実戦・5問` 13px `--ink-4`; right, the date in 11px mono and a
language pill (`1px --tick`, `padding: 4px 10px`, 11px `--ink-4`) reading `English` — the toggle to
read a Japanese round's feedback in English.

3-column grid: per-answer scores at `span 2`, round-level findings in the last column.

### Per-answer region
- `第1問 / 5問` in 11px mono `0.16em`, and right-aligned
  `3分12秒・約250字/分・書き直し 8%` — duration, pace and the rewrite figure from §6, together.
- The question at 15px/1.85 `--ink-2`.
- **Seven score rows** (§5.3). Sample: `構成 4 · 根拠 3 · 関連性 4 · 流暢さ 3 · 正確さ 4 ·
  長さ・配分 2 · 敬語 3`. 長さ・配分 is the attention row.
- **Follow-up row**, sharing the row rhythm but carrying no scale: `└ 深掘り` at 12px `--ink-6`, the
  question at 12px `--ink-7`, and right-aligned at 11px `--ink-label`:
  `7項目を採点。進捗には入れません。`
- **Answer pager:** `第2問 第3問 第4問 第5問` at 12px `--ink-label`, a flex `--rule-section` line,
  then `以下に4問`.

### Round-level region
- `直すところ 3件` — a numbered list, index in mono `--ink-label`, text 13px/1.75. The items quote the
  user and cite the CV:
  1. `第1問が3分12秒。結論を先に置き、2分以内に収める。`
  2. `数値の裏づけが2か所ありません。職務経歴書の「請求処理を40%短縮」を使う。`
  3. `「〜っていう」が4回。「〜という」に置き換える。`
- `良かったところ 1件` — one line, same size. **One, not three.** The asymmetry is the design.
- `職務経歴書との照合` — callout rails (§5.8): `--attention-mark` for
  `裏づけなし —「チーム全体の生産性を上げた」に対応する記述が応募書類 v3 にない。`, `--ink-9` for
  `未使用 —「2024 決済基盤の移行リード」「英語での顧客折衝」`.
- Footer stamp: `評価基準 v1.2・出題 v1.0・応募書類 v3` / `緊張度 4 を講評前に記録`.

### Refuses
- **No composite.** No round total, no average, no per-answer aggregate, no letter, no percentage.
- **No prose beside a dimension** (design system §7).
- **No comparison to other users**, and no comparison to a target other than the user's own history.

---

## 9. Progress — `Progress.dc.html` (1060px)

**Purpose.** Show whether the reading is moving, honestly enough that a flat line is believable.

- Section label `FIRST ATTEMPTS, REALISTIC MODE ONLY`, right-aligned `日本語 12 / 30` and
  `English 9 / 30` in 12px mono `--ink-4`.
- **Round-type tabs** — `行動面接 · 技術面接 · HR · CEO・最終` at 14px, selected weight 500 with a
  `2px --accent` underline — and right-aligned `ラウンド種別ごとに見ます。まとめません。`
- Two panels side by side at `gap: 40px`, one per language, each with a header (14px/500 language
  name, right-aligned status in 12px mono `--ink-label`) and seven dot-plot rows (§5.4).

### The two states this screen exists to show
| Panel | Header status | Drawn |
| --- | --- | --- |
| 日本語 | `初回 8件・傾向線あり` | 8 dots per row **with** a trend line |
| English | `4 first attempts — 1 more for a trend line` | 4 dots, **no** line, and the shortfall named |

**Below five first attempts, no trend line is drawn and the screen says how many more are needed.**
This is a requirement, not a nicety — it is the difference between an honest instrument and a chart
that flatters.

The English panel's seventh row is the not-scored state: `Register (敬語)` with a rule, `Not scored in
English`, and `—` in the numeral column. **The row is kept, not removed** — the absence is data.

### Footer, 12px/1.85 `--ink-6`, two columns
`古い順に左から並んでいます。練習ラウンド・再挑戦・深掘り・入力した回答は入っていません。` /
`一般練習のラウンドは別に集計しています。` ·
`縦線は評価基準・出題・職務経歴書が変わったところです。` /
`点にカーソルを合わせると、日付・第何問かが出ます。`

That first line is the exclusion list, and it must match what the data layer actually excludes:
practice rounds, retries, follow-ups, and typed (non-spoken) answers.

### Consistency requirement
The rightmost dot of each 日本語 row is the 2026-09-12 round and **must equal the score shown on round
feedback and in the History matrix** — `4 3 4 3 4 2 3`. The artboards agree; the build must too.

---

## 10. History — `History.dc.html` (900px)

**Purpose.** Months later, compare across answers. This is the one screen that borrows Direction C's
matrix (decision 20), in B's light vocabulary and **without C's disclaimer** (decision 24, settled in
design system §8).

### Left rail — 330px, `border-right: 1px solid --rule-frame`, padding `24px 28px 26px`
Section label `ROUNDS` with a count `14` in 11px mono `--ink-8`. Each entry:
`padding: 13px 0`, `border-top: 1px solid --rule-hairline`, gap `14px`, selection rail at `2×34px`.
Title 13px/500 `--ink-1` when selected, 400 `--ink-3` when not; date right-aligned in 11px mono
`--ink-8`; below, `日本語・実戦・5問` at 11px `--ink-7`.

Two entries carry an `--attention-ink` status line at 11px — **these states must be designed in, not
discovered in production:**
- `未採点 — 採点をやり直す`
- `中断 — 進捗から除外`

### Detail — the matrix (§5.5)
Header: `行動面接` 17px/600, `日本語・実戦・5問`, date, and
`求人票 Mercari_SRE_2026.pdf・緊張度 4 を講評前に記録` at 12px `--ink-6`. Right: the `English`
language pill and `編集できません` at 11px `--ink-8`.

**A past round is read-only.** The pill still toggles the feedback language; nothing else can change.

Columns: `196px repeat(7, 1fr) 58px 34px` — question, the seven dimensions, TIME, play.

Rows, in order, with the sample record:

| Row | Scores | Time |
| --- | --- | --- |
| `Q1　最も困難だった状況と対応` | 4 3 4 3 4 **2** 3 | 3:12 |
| `└ 深掘り　その判断は誰が下したのですか` | 3 **2** 4 3 4 4 3 | 1:05 |
| `Q2　転職を考えた理由` | 4 4 5 4 4 4 4 | 2:20 |
| `└ 深掘り　今の会社で解決できない理由は` | 3 3 4 4 4 3 4 | 0:58 |
| `Q3　チームでの対立をどう扱ったか` | 3 **2** 3 4 4 3 3 | 2:44 |
| `└ 深掘り　相手はどう受け止めましたか` | 3 3 3 3 4 3 3 | 1:12 |
| `Q4　失敗から学んだこと` | 4 3 4 4 5 3 4 | 2:05 |
| `└ 深掘り` | *missing — see below* | — |
| `Q5　5年後にどうなりたいか` | 3 3 4 4 4 4 **2** | 2:31 |
| `└ 深掘り　その一歩目は何ですか` | 3 3 4 3 4 4 3 | 1:08 |

Q1 matches round feedback exactly. The **missing follow-up** row spans all seven score columns in
`--attention-ink`: `深掘りが生成されませんでした。空欄として記録しています。` — a generation failure
is recorded as a hole, never silently omitted and never backfilled.

The 34px column holds a play triangle (`M4.6 3.2 10.6 7l-6 3.8V3.2Z`, 1.2 stroke) that opens the audio
and the raw transcript for that row.

### Footer
`深掘りは進捗に入りません。回答ごとの1〜5だけを残しています。` /
`音声と未修正の文字起こしは、この行から開けます。` and right, the stamp
`評価基準 v1.2・出題 v1.0` / `応募書類 v3`.

---

## 11. What every screen must refuse

Restated from PRD §9 because a specification that omits them invites a build that violates them:

1. **No composite score** is computed, stored or displayed — on any screen, in any tooltip, in any
   export.
2. **Round-end feedback renders while the user is still there.** A spinner that outlives the sitting
   is a defect, not a loading state.
3. **First attempts are never overwritten.** A retry is a new record beside the first, and Progress
   plots only the first.
4. **Raw transcripts are never discarded.** Both raw and corrected text persist, and the raw text is
   reachable from History.
5. **Every scored answer carries its four version stamps** — CV, rubric, generator, scoring model —
   and Progress draws the boundaries where they changed.
6. **All data is private to one user.** No sharing surface, no leaderboard, no export-to-anyone.

---

## 12. Not specified here

- **Mobile.** Desktop only in v1; no breakpoint is drawn and none should be inferred from the 1280px
  frame.
- **Sign-in page.** `/sign-in` (`08` §5) has no artboard. The foundation slice builds it bare in `05`
  tokens — wordmark, one Google button, the refusal line — with both languages on the page, so it does
  not decide the open bilingual chrome rule. Its Japanese strings need a native read.
- ~~**CV screen.**~~ **Closed — specified in §13.** The nav's fourth item now has a specification
  built from `05` components rather than an artboard: two panels, one per language, each with an
  empty state, a current version showing its documents with claim spans underlined, a prefilled
  new-version form, and a version history. No artboard was drawn and none is needed — every element
  it uses is already measured in `05`.
- **Three prose strings still say `職務経歴書` where they now mean the whole set.** §8's section label
  `職務経歴書との照合`, §8's round-level line `数値の裏づけが2か所ありません。職務経歴書の…`, and §9's
  legend `縦線は評価基準・出題・職務経歴書が変わったところです。`. Every *stamp* in this document now
  reads `応募書類 v3` (`05` §6), but these three are sentences, not labels: rewriting them is a copy
  change that goes through a native read with the screens that carry them, not a find-and-replace.
- **The `design/` artboards still draw `職務経歴書 v3`.** They are the extraction *input* for this
  document, not what the build follows — `docs/` is the source (`CLAUDE.md`). Re-seeding them means
  editing `design/*.dc.html` and rebuilding `design/suburi-directions.html`, which is a design-tool
  pass, not a docs edit. The divergence is recorded rather than half-fixed — and **no ticket in #12–#21
  covers it**, so it needs one before anyone reads the artboards as current.
- **Practice mode's screens.** Practice differs at the record frames (no timer, `録り直し可`) and
  delivers feedback per answer rather than at round end. Only realistic mode is drawn.
- **The four-round run.** Deferred as LATER and unshaped (decision log).
- **Loading, error and offline states** beyond the two History statuses and the missing-follow-up row.

---

## 13. CV — `/cv`, no artboard

**Purpose.** Put in, and read back, the material every round is scored against — and let extraction be
checked against the user's own text before anything depends on it.

Session-required like every other screen (`08` §5). Built entirely from `05` components; nothing here
needed a new one, which is why no artboard was drawn.

> **Every Japanese string in this section is proposed and has not had its native read.** So is
> `応募書類` itself. They go through one read together with the error catalogue (`05` §6, #13), and
> what that read settles is what ships.

### Two panels, side by side

`repeat(2, 1fr)` at the standard `14px` card gap, 1280px frame, `padding: 40px 44px` like every
screen. Left panel is the Japanese CV, right is the English one. Each is headed by a §3.3 section
label — `応募書類` and `CV` — and the two panels are independent: saving on one does nothing to the
other, and either may be empty while the other is not.

**Each panel's chrome is in its own language.** The Japanese panel's labels, hints, buttons and
messages are Japanese; the English panel's are English, on the same screen at the same time. A panel
is *about* one language's documents, so its chrome has an obvious language, which is not true of the
round screens.

> **This settles the bilingual chrome rule for this screen and no other.** The general question —
> does chrome follow the round's language or the app's? — stays open (`CONTEXT.md`, `05` §9). A screen
> that shows both languages at once side by side does not get to answer it for screens that show one.

### Empty panel

One action and nothing else: an outline button (`05` §5.7) reading `応募書類を追加する` / `Add your
CV`, over a 12px `--ink-6` line naming what the set requires —
`履歴書が1通必要です。職務経歴書と、補足資料を5つまで追加できます。` /
`One CV document is required. You can add up to five supporting documents.`

No placeholder version, no sample, no "get started" sequence. The panel states what is missing and
offers the one move that fixes it.

### Current version

| Element | Spec |
| --- | --- |
| Version stamp | `05` §5.9, but **top-left of the panel rather than bottom-right** — here it labels the thing being read, it is not the provenance footer of a score. `応募書類 v3` / `CV v3`, with `2026-08-30` beside it in mono. |
| Claim count | 11px mono, `--ink-label`: `主張 34件` / `34 claims`. **`件`, never `点`** (`05` §6). |
| Documents | In `position` order. Each is a §3.3 section label — `履歴書` · `職務経歴書` · the user's own title for an additional document — over its text at 13px/1.9. |
| Claim spans | Each surviving claim's span **underlined** in its document's text: `border-bottom: 1px solid var(--accent-mid)`. Nothing else — no numbering, no margin notes, no hover card. |

**The underline is the whole point of this screen.** It is how extraction gets checked: the user reads
their own CV and a wrong span is visible as a phrase underlined that is not an assertion, or an
assertion left bare. That check is the answer to `CONTEXT.md`'s open question about extraction quality
(#20), and it is why the text is rendered in full rather than summarised into a claim list.

**Every underlined range is sliced from `cv_versions.body` by span** (`04`), never from model output,
and every span lies inside exactly one document's range. A span that crossed a document boundary was
dropped at save time and is not here to render.

### New version

An outline button `新しい版をつくる` / `Create a new version` opens a form **prefilled with the current
version's documents** — same kinds, same titles, same text, same order. Changing one document does not
mean retyping the others, and the prefill is also what makes `cv_unchanged` a real risk worth refusing
server-side.

| | |
| --- | --- |
| Per document | A title (fixed for the three known kinds; a text input for `additional`) over a monospaced-width textarea at 13px/1.9. |
| Import | Beside each box, `ファイルから読み込む` / `Import from a file`, accepting `.docx` and `.pdf`. **The text is extracted in the browser and dropped into that box, which stays editable.** The file is never uploaded (`07` §5.2). |
| After an import | A 12px `--ink-6` line: `読み込んだ文を確認して、必要なら直してください。保存した文がそのまま評価に使われます。` / `Check the imported text and fix anything wrong. What you save is what gets scored.` |
| 履歴書 box only | An `--accent-mid` callout rail (`05` §5.8): `生年月日・住所・電話番号・顔写真・家族の情報は省いてかまいません。評価には使いません。` |
| Add | `補足資料を追加` / `Add a supporting document`, disabled at five. Japanese panels also offer `職務経歴書を追加` until one exists. |
| Save | Solid primary `この版を保存する` / `Save this version`, with the `05` §5.7 caption stating what it commits to: `保存すると、この内容で版が確定します。あとから直すことはできません。` |

**The save control disables while a save is in flight**, and the panel states that extraction is
running. This is the client half of `cv_unchanged` (`07` §5.2); the server refuses a duplicate whether
or not the client got it right.

**Imported text is never saved unread.** The box is the editable copy, and what the user leaves in it
is what is sent — a PDF's broken line wraps and table columns get corrected before they become part of
an immutable version, not after.

### After a save

The panel returns to the current-version view, now showing the new version, with a 12px `--ink-6`
result line above it:

`34件を抽出。27件は前の版から引き継ぎ、7件が新規。` /
`34 claims extracted — 27 carried forward, 7 new.`

**`spans_rejected` is shown whenever it is non-zero**, on an `--attention-mark` callout rail (`05`
§5.8): `2件は本文と一致しなかったため除きました。` / `2 claims were dropped — their quotes did not
match your text.` Zero is stated plainly in the result line rather than hidden, because a counter that
only appears when it is bad is a counter nobody learns to read.

On failure, nothing changes and the form keeps its contents: the version was not created (`07` §5.2),
so there is nothing to reconcile. The message is the catalogue's copy for `cv_extraction_failed`,
`cv_unchanged` or `rate_limited`, in that panel's language.

### Version history

Below the current version, in the same panel: one row per older version, newest first — label, date,
claim count — at 12px, `--ink-6`, on `--rule-hairline` separators. A row opens that version read-only,
in the same shape as the current-version view.

**Readable, never selectable.** There is no control that makes an older version current and none that
points a round at one (`07` §6). History here answers "what was I scored against in August?", which is
what the CV stamp on an old answer means.

### Refuses

- **No coverage marks yet.** Nothing cites a claim until scoring exists, so "used" and "never used"
  would both be false on every claim on this screen. They arrive with citations, not before.
- **No edit and no delete** — not a document, not a claim, not a version (`04` §6, `07` §6).
- **No version label input.** The label is derived, per language (`04`).
- **No upload of the file itself.** The browser extracts text; the file does not leave it.
- **No score, no quality figure, no "CV strength".** This screen shows what was extracted and where it
  came from. Rating a CV is a different product.
