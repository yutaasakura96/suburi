# Screen specifications — Suburi

Nine screens, extracted from the Direction B artboards in `design/`, **and a tenth — the CV screen
(§13) — specified from `05` components with no artboard behind it, an eleventh, the status page
(§14), specified the same way, and practice mode's frames (§15), which the artboards never drew.**
Tokens referenced here are
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

## 0. Which language the chrome is in

**Decided 2026-09-27** (`06`, "Round screens follow the round's language"). Chrome is every string the
app writes — labels, buttons, captions, hints, section labels, error copy — as opposed to the user's own
words, the questions, and the feedback's content.

| Screens | Chrome is in |
| --- | --- |
| **Inside a round** — record (§3–5, and practice's frames), transcript correction (§6), felt pressure (§7), round feedback (§8) | **The round's language.** A Japanese round is Japanese throughout; an English round is English throughout. |
| **App-level** — Home (§1), Setup (§2), Progress (§9), History (§10), Status (§14) | **English**, one fixed app language. |
| CV (§13) | Each panel in its own language — its own rule, unchanged. |
| `/sign-in` | Both languages side by side (§12), unchanged. |

**The artboards were drawn with Japanese chrome everywhere, and that is now layout, not copy.** Their
measures, order, states and refusals stand. What changes:

- **Home, Setup, Progress and History are written in English** by the slice that builds each, replacing
  the Japanese strings quoted in §1, §2, §9 and §10. Data keeps its own language: a round type is named
  in English on these screens, a stored `応募書類 v3` stays `応募書類 v3`, and a Japanese round's
  questions and feedback are shown as written.
- **The Latin section labels on the round screens become Japanese in a Japanese round** —
  `YOUR ANSWER — EDIT FREELY`, `RAW — KEPT, NEVER REPLACED`, `Raw transcript`, `Rewrite`, `BEFORE THE
  FEEDBACK`, `WHAT THIS IS NOT`. Keeping them Latin as a design device was considered and rejected.
  `05` §3.3's uppercase and tracking are for Latin labels only; a Japanese label never relies on
  `text-transform` (`05` §6). **The Japanese labels, since #43** (`06`, 2026-10-03), pending their
  native read:

  | Artboard label | In a Japanese round |
  | --- | --- |
  | `Raw transcript — 未修正` | `文字起こし — 未修正` |
  | `YOUR ANSWER — EDIT FREELY` | `あなたの回答 — 自由に直せます` |
  | `RAW — KEPT, NEVER REPLACED` | `未修正の文字起こし — 置き換えずに残します` |
  | `Rewrite` | `書き直し` |
  | `BEFORE THE FEEDBACK` | `講評の前に` |
  | `WHAT THIS IS NOT` | `緊張度について` |

  §5–§7 below still quote the artboards' Latin labels, as what was drawn. A Japanese round shows the
  right-hand column, and its tab title is Japanese too (`ラウンド — Suburi`, `講評 — Suburi`).
- **English round-screen copy is built (#42).** The Japanese strings for #43 were read on 2026-10-03
  (`docs/checklists/native-read-round.md` — an AI read at the user's delegation, `06`). Two things
  it changed in what the sections below quote: **a Japanese round is titled `人事面接` and
  `最終面接`**, not the artboards' `HR` and `CEO・最終` (`行動面接` and `技術面接` stand), and
  **`緊張度4を…` is set tight** (`05` §6).

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

### Status line
**One line, only when something is wrong** (`06`, 2026-09-29): shown when any `12` §6 check on the
status page is red, or `self-check` has not run for over 48 hours; absent otherwise, never an
"all clear". It says which, in English (§0), and links to the status page. It carries counts and
names of checks and any unpriced model identifiers only, never text from a CV, transcript or note (`12` §7).

**Placement:** the first thing inside the page frame, above every card, at the full content width,
with the standard `14px` card gap below it. Outside the cards, because it is about the instrument,
not about practice, and it must not push the Due list's order around.

**Styling:** a `05` §5.8 callout rail — a `3px` `--attention-mark` bar, gap `10px`, text 12px/1.7 in
`--ink-3` — on `--ground`, with no card and no border: one sentence, then the link `Open the status
page` in `--link`, underlined on hover. Nothing else: no icon, no dismiss control (it clears itself
when the check does), no count badge.

**Copy**, the staleness clause first, because a dead cron makes every other reading old:

| State | Line |
| --- | --- |
| `self-check` has never run | `Self-check has never run.` |
| Last run over 48 hours ago | `Self-check has not run since 2026-09-27 04:12.` — Asia/Tokyo, 24-hour |
| Red checks | `2 checks are red: Scores pending over 24 hours, CV claims split.` — one check: `1 check is red: …` |
| Both | the staleness sentence, then the red one, on the same line |

The check names are the status page's own (§14). A red reading from a stale run still counts: the
line says the run is old and what it last found.

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
| Role context | equal cards — two in round one | 求人票・メモ |

**Mode carries its own explanation inline**, both modes at once, the selected one at `--ink-3` and the
other at `--ink-6`:
`実戦 — 一発勝負。1回答 最長4分。講評はラウンド終了後にまとめて出します。` /
`練習 — 録り直し可。時間制限なし。回答ごとに講評。`

**As built (#49)**, in English (§0): `Realistic · Practice`, realistic the default, and under them
`Realistic — one take. Up to 4 minutes per answer. The feedback comes together after the round.` /
`Practice — re-takes, no time limit, each answer's scores once it is scored. Not counted in progress.`
A practice round's frames are §15.

**Role context is required** and labelled `必須。3つは対等です。` — three cards in a
`repeat(3, 1fr)` grid at `gap: 24px`, each a 14px title over a 12px/1.7 detail, underlined
`2px` selected/unselected as above:

- `求人票・メモ` → `Mercari_SRE_2026.pdf`
- `AIに調べさせる` → `調査済み・開始前に編集できます`
- `一般練習` → `進捗では別に集計します`

When both a file and an AI-researched context exist, a `--accent-mid` callout rail states the
precedence: `求人票とAI調査の両方があります。ファイルを優先して使います。`

**Round one draws two cards, not three** (`06`, 2026-09-27): the posting and General practice, still
equal, in a `repeat(2, 1fr)` grid. The research card and the precedence callout arrive with US-16.
A posting is picked from the ones already saved, or added — pasted, or imported through the CV
screen's importer into an editable box, as on §13. Saved postings are never edited; a changed one is
a new one. The drawn detail `Mercari_SRE_2026.pdf` is the picked posting's `source_filename`.

### Role context, as built (#47)

Specified from `05` components, as §13 was, by the slice that built it. English chrome (§0); a
posting's company, title and text are data and shown as written.

**The two cards.** `Posting` and `General practice`, in that order, each a button with `role="radio"`
in one `radiogroup`: a 14px title over a 12px/1.7 `--ink-6` detail, `2px --accent` underline when
selected, `1px --rule-section` when not — the drawn card.

| Card | Detail line |
| --- | --- |
| `Posting` | the picked posting's `source_filename` (the drawn `Mercari_SRE_2026.pdf`); `Pasted text` when it has none; `Pitch the round at a role you are applying for` when no posting is picked |
| `General practice` | `Counted separately in progress` |

**The cards are equal and the group is required.** The label reads `Role context` with, beside it in
12px `--ink-6`, `Required. The two are equal.` **Nothing is selected when the page opens unless a
posting has been saved before**, in which case `Posting` is, with the newest one picked — the last
thing the user did was save it for a round. General practice is never the silent default: it is a
choice that splits the progress record (`CONTEXT.md`), so it is made, not inherited. Until a card is
selected — and, on `Posting`, a posting is picked — the start button is the §5.7 **inert** primary,
and its caption reads `Choose a role context to start.`

**The picker**, under the cards when `Posting` is selected. A `05` §5.6 selection rail: one row per
saved posting, newest first, `padding: 11px 0` on `--rule-hairline` separators, each a `role="radio"`
button —

- the company at 14px `--ink-1`, then the role title at 13px `--ink-4`, on one baseline, gap `12px`,
  each truncated with an ellipsis rather than wrapped;
- right-aligned in 11px mono `--ink-label`: the `source_filename` if any, then the saved date
  (`2026-10-03`, Asia/Tokyo);
- the rail's 2px bar, `34px` tall, to the row's left: `--accent` when selected, `--rule-row` when not;
  the selected row's company steps to weight 500.

The list is every posting, not a recent few: nothing is deleted (`04` §5), so the row is how an old
posting is used again. Past eight rows the list scrolls inside `max-height: 352px`. **No edit and no
delete control** on a row — a changed posting is a new one.

Below the list, or in its place when no posting is saved yet, a text control in the §3.3 label style
— `Add a posting` — opens the add form in place. With no posting saved the form is already open.

**The add form.** Three fields, each a §3.3 section label over its control:

| Field | Control |
| --- | --- |
| `Company` | one-line input, 14px, `1px --rule-frame` like §13's box, `padding: 9px 12px`; cut at 200 code points as it is typed, the unit `07` §5.3 states — not the `maxlength` attribute, which counts UTF-16 units |
| `Role title` | the same |
| `Posting text` | a textarea, 13px/1.9, eight rows, vertically resizable — §13's box. Beside its label, `Import from a file` (`.docx`, `.pdf`), the §13 control: **the text is extracted in the browser and dropped into the box, which stays editable; the file is never uploaded** (`07` §5.3). An import replaces the box's text and sets the posting's `source_filename`; editing the box afterwards keeps it; clearing the box drops it |

- After an import, §13's line: `Check the imported text and fix anything wrong. What you save is what
  the questions are written from.`
- A failed import: §13's two `--attention-mark` callout rails, word for word, under the box, which is
  left as it was.
- Under the box, right-aligned in 11px mono `--ink-label`, the count against the cap:
  `1,204 / 20,000 characters`. Over the cap the count takes `--attention-ink` and the save control
  goes inert — the client half of `role_context_too_large`; the server refuses whether or not the
  client got it right.
- An **outline** button `Save this posting` (§5.7, no glyph), inert until company, title and text are
  all non-blank, with the caption `Saving fixes this posting as it is. It cannot be edited afterwards
  — a changed posting is saved as a new one.` While saving: `Saving the posting.`, and the button, `Cancel`, the
  three fields and the import control are all disabled, so what is on screen is what is saved.
  Outline, not solid: the screen's one solid primary is `Start this round`.
- `Cancel`, a text control in the §3.3 label style, beside the button when at least one posting is
  already saved. It closes the form and keeps nothing.

**After a save** the form closes, the new posting is at the top of the picker and is the picked one.
The page does not navigate and the other four groups keep their values.

**On failure** nothing was saved (`07` §5.3) and the form keeps its contents. An `--attention-mark`
callout rail above the save button carries the catalogue's English copy for `role_context_too_large`,
`invalid_request`, `write_failed` or the unreachable sentence.

**Picking General practice** needs no form. Its row is created the first time a round starts with it
(`07` §5.3), as the tracer did.

### The bank-exhausted warning (#47)

PRD §6. Shown in the rationale column, above the start button, as an `--accent-mid` callout rail
(`05` §5.8) — information, not an error — **whenever the bank cannot fill the round being set up
without generating**: for the chosen round type, language, mode and length, the questions the
selection order (`07` §5.4) would take from the bank are fewer than the length. It is computed from
counts the page already holds, so changing the type or the length updates it without a request, and
it is on screen before the round starts.

`There are 2 unseen Behavioural questions in English, and this round asks 5. The rest are written when
it starts, which can take up to half a minute. If a new question turns out to match one you have
already answered, it is asked as a repeat: scored, but not counted in progress.`

The language named is the round's — `in Japanese` for a Japanese round, whose bank is its own (`07`
§5.4). The two numbers are the bank's supply and the round's length; with none unseen it opens `There are no
unseen Behavioural questions in English, and this round asks 5.` It does not offer a choice: the
round's length is the user's, and generation is how the round keeps it.

**While the round is starting** the start button's caption reads `Fixing the questions for this
round.`, or, when the warning is showing, `Writing new questions for this round. This can take up to
half a minute.` — the measured wait (`03` §4), said before it is felt.

### Rationale column
- `WHY THESE DEFAULTS` → `行動面接・日本語は18日空いています。既定値はそこから決めました。` then
  `提案です。4つとも変えられます。` at `--ink-label`.
- `SCORED AGAINST` → `応募書類 v3` with its date `2026-08-30` in mono.
- Solid primary `このラウンドを始める`, then an 11px mono stamp:
  `5問＋深掘り5問・最長 約40分` / `評価基準 v1.2・出題 v1.0`.

**The duration estimate is derived, not written:** `length × (1 + follow-ups) × per-answer cap`.
5 × 2 × 4min = 40min. Changing the length or the cap must change this string. **Practice shows no
estimate** — its stored cap is the 15-minute runaway guard, not a pace, and an estimate built on it
would read as an expected length of more than two hours (`06`, 2026-09-27, confirm 2).

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
  on screen.** Practice mode is text-only, so this line and glyph are omitted. The audio streams from
  the speech route (`07` §5.15). **When synthesis fails**, this line is replaced by a short notice —
  the catalogue's `speech_failed` copy — and the round goes on with the text (`06`, 2026-09-28).
  **When the browser will not play sound unasked** — a round opened or reloaded with no gesture yet in
  the tab — the line is a control with the same glyph, `Hear the question` in an English round and
  `質問を聞く` in a Japanese one;
  pressing it plays the question and the line returns. Starting the recording silences a question
  still being spoken, so the microphone never records it (`06`, #45).
- **The question is the one fixed when the round started** (`round_questions`) — a reload shows the
  same one.
- **A follow-up is asked on this same frame**, from its `follow_ups` row — a reload shows the same
  one, and nothing generates it again. It shares its question's position, so the header's step keeps
  the number and names it: `Question 2 / 3 · follow-up`, `第2問 / 3問・深掘り` in a Japanese round
  (`06`, 2026-10-03). The footer's stamp carries the follow-up prompt's version in place of the
  question's. **A follow-up is not spoken yet**, in realistic mode either: it has no speaker line,
  and its question's audio is not played over it (`06`, 2026-10-04).
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

**Nothing is recorded against the question until the take exists** (`07` §5.6). Stopping opens the
answer slot and uploads; a recording that fails or a microphone that is denied writes nothing, and the
question stays unseen (PRD §7).

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

**The follow-up is generated from the corrected text, not the raw text.** Both are stored. Under a
follow-up's own answer the caption does not promise one: it makes none.

### After the commit, when there is no follow-up to ask
The answer is saved and locked — no editor, no recorder — the question stays at the top, and one
solid primary goes on (`06`, 2026-10-03). Two cases, one frame:

- **The follow-up could not be generated.** The catalogue's `followup_generation_failed` sentence in
  a callout rail, attention tone. Going on asks the next question, or screen 7. The hole is said
  here, never skipped silently (US-7).
- **The follow-up had not been stored when the page loaded.** A plain sentence in the information
  tone. Going on writes it and asks it.

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
- **Picked:** button becomes solid `--ink-1` / `#fff`; hint `緊張度4をこのラウンドに記録します。`
- Stamp: `評価基準 v1.2・出題 v1.0・応募書類 v3`.

**This screen cannot be skipped, and it cannot be answered after the feedback is seen** — the whole
point is that the reading is taken before the result is known. The value is recorded on the round and
surfaced on round feedback and History as `緊張度4を講評前に記録`.

---

## 8. Round feedback — `Main.dc.html` (lower card)

**The screen the product exists for.** Rendered while the user is still at the machine (PRD §9).

Header: `行動面接` 17px/600, `日本語・実戦・5問` 13px `--ink-4`; right, the date in 11px mono and a
language pill (`1px --tick`, `padding: 4px 10px`, 11px `--ink-4`) reading `English` — the toggle to
read a Japanese round's feedback in English.

**What the pill changes (`06`, 2026-10-03):** the feedback, and nothing else — the seven dimension
names (`Structure … Keigo (register)`) and the round-level findings with their two headings
(`To fix 3`, `What worked 1`), read from the stored translation (`04` `round_feedback.body_translated`),
and **each model answer**, read from the translation stored with it (`04` `model_answers`, #74).
The round's own chrome stays Japanese: the header, `第1問 / 5問`, the figures, the question, the pager,
the answer texts' labels and legend, what the user said, and the stamps. The pill appears only when the stored translation exists. It names the language it
switches to, in that language — `English`, then `日本語` — and the choice is the page's, not stored.
**An English round has no pill**: its feedback is English already (PRD §4).

3-column grid: per-answer scores at `span 2`, round-level findings in the last column.

### Per-answer region
- `第1問 / 5問` in 11px mono `0.16em`, and right-aligned
  `3分12秒・約250字/分・書き直し 8%` — duration, pace and the rewrite figure from §6, together.
- The question at 15px/1.85 `--ink-2`.
- **Seven score rows** (§5.3). Sample: `構成 4 · 根拠 3 · 関連性 4 · 流暢さ 3 · 正確さ 4 ·
  長さ・配分 2 · 敬語 3`. 長さ・配分 is the attention row.
- **Follow-up row**, sharing the row rhythm but carrying no scale: `└ 深掘り` at 12px `--ink-6`, the
  question at 12px `--ink-7`, and right-aligned at 11px `--ink-label`:
  `7項目を採点。進捗には入れません。` The first sentence follows the follow-up's own scoring — scored,
  not scored yet, or not scored — and the second never changes. **A missing follow-up keeps the row**:
  the label, and one sentence in `--attention-ink` saying it was not generated and is recorded as a
  gap, in place of the question (`06`, 2026-10-03). The follow-up's own scores are History's (§10).
- **An answer in the wrong language** (PRD §7) carries one `--accent-mid` callout rail (`05` §5.8)
  under its score rows, above the pager: `英語での回答です。日本語の進捗には入れません。` /
  `This answer was given in Japanese. It is kept out of your English progress.` It names the language
  the scorer read (`scoring_attempts.answered_language`, `04`) and the round's. **The answer is still
  scored and its rows still render** — the line says what happens to the scores, it does not replace
  them. An answer in the round's language carries no line, and neither does one whose latest `ok`
  attempt has no `answered_language` (scored before the CV check existed): absence of the reading is
  not a mismatch.
- **Answer pager:** `第2問 第3問 第4問 第5問` at 12px `--ink-label`, a flex `--rule-section` line,
  then `以下に4問`.
- **Answer texts, under the pager** (#74, `06`, 2026-10-04; no artboard): two equal columns, 28px
  apart, for the answer the pager is on. Left, under the §3.3 section label `あなたの回答` /
  `Your answer`, **what the user said** — the corrected transcript as it was scored, 13px/1.85
  `--ink-3`, line breaks kept. Right, under `模範回答` / `Model answer`, **the model answer stored
  for that question** (`04` `model_answers`), 13px/1.85 `--ink-2`.
  - **What the CV does not back is underlined** — a 1px `--attention-mark` bottom border on each
    stored span (`unsupported_spans`), the colour of the 裏づけなし rails below. The mark is never
    colour alone: a 12px `--ink-6` caption under the answer says what it is and names the round's CV
    stamp — `応募書類 v3とあなたの回答をもとに作成しています。下線は、応募書類 v3に裏づけのない内容です。` /
    `Written from CV v3 and what you said. An underline marks what CV v3 does not back.` With no span:
    `応募書類 v3とあなたの回答をもとに作成しています。応募書類 v3に裏づけのない内容として下線を付けた箇所はありません。` /
    `Written from CV v3 and what you said. Nothing in it is underlined as going beyond CV v3.` The
    caption is always there, for the reason 裏づけなし's empty rail is. **It says what was marked,
    not that every claim was checked**: figures also pass the server's deterministic check (`04` `model_answers`).
  - **An answered follow-up has a second pair below**, 24px down, labelled `深掘りへの回答` /
    `Your answer to the follow-up` and `深掘りへの模範回答` / `Model answer to the follow-up`. A
    follow-up that is missing, or was never answered, has none.
  - **With the pill on `English`**, the right column is the stored English translation with its own
    underlines, and carries `lang="en"`; the left column and every label stay as they are.
  - **No model answer stored** — its call failed at `complete`, was still running when the response
    went out (`07` §5.12; a reload shows it once it lands), or the round is from before model
    answers existed — the right column is one plain sentence, `この質問の模範回答はまだ作成されていません。`
    / `No model answer is written for this question yet.`, and an outline button `模範回答を作成する` /
    `Write the model answers`, which writes every one the round lacks (`07` §5.19) and refreshes.
    While it runs the button is disabled and a caption reads `模範回答を作成しています。` /
    `Writing the model answers.` **No spinner**, and nothing else on the screen waits. A failure is
    the catalogue's sentence on an attention rail above the button, which stays.
  - **A model answer is never scored, graded or compared with the user's answer here.** It sits
    beside what was said; the screen draws no diff and no judgement between the two.

### Round-level region
- `直すところ 3件` — a numbered list, index in mono `--ink-label`, text 13px/1.75. The items quote the
  user and cite the CV:
  1. `第1問が3分12秒。結論を先に置き、2分以内に収める。`
  2. `数値の裏づけがない箇所が2つ。応募書類の「請求処理を40%短縮」を使う。`
  3. `「〜っていう」が4回。「〜という」に置き換える。`
- `良かったところ 1件` — one line, same size. **One, not three.** The asymmetry is the design.
- `応募書類との照合` / `Checked against your CV` — a §3.3 section label over callout rails (`05`
  §5.8), below 良かったところ. Built with the grounding slice (#46, `06`):
  - **裏づけなし — one `--attention-mark` rail per unsupported span**, in question order and then in
    the order the spans stand in the answer, each naming its question:
    `裏づけなし（第2問）—「チーム全体の生産性を上げた」に対応する記述が応募書類 v3にない。` /
    `Unsupported (Question 2) — nothing in CV v3 backs “raised the whole team's productivity”.`
    **The quote is the answer's own words by span** — sliced from the corrected text, never reworded
    (`04` `answer_flags`) — and the label is the round's CV stamp. Only the flags of each answer's
    latest `ok` attempt are drawn; a re-score's flags replace the first attempt's here without
    deleting them.
  - **None flagged is said**, on an `--ink-9` rail: `裏づけなし — 応募書類 v3に照らして該当なし。` /
    `Unsupported — nothing flagged against CV v3.` A region that only appears when it has bad news is
    a region nobody learns to read (the same rule as `spans_rejected`, §13).
  - **未使用 — one `--ink-9` rail**: `未使用 —「2024 決済基盤の移行リード」「英語での顧客折衝」` /
    `Unused — “Led the 2024 payments platform migration” “Customer negotiation in English”`.
    **Two or three claims the feedback call picked as relevant** from the round's never-cited set,
    not every uncited claim (`06`, 2026-09-27), in the order it picked them; each quote is sliced from
    the CV by span (`round_feedback.untouched_claim_ids`, `04`). None picked:
    `未使用 — この回で挙げる記載事項はなし。` / `Unused — nothing picked for this round.`
  - **Drawn only for a round that went through the CV check** — one where some answer's latest `ok`
    attempt carries `answered_language`. A round scored before the check existed has no region at
    all: "nothing flagged" there would be a statement nobody checked.
  - **Nothing in the region is the model's wording.** Every quoted string is a slice of stored text
    by a validated span; the sentence around it is chrome.
- Footer stamp: `評価基準 v1.2・出題 v1.0・応募書類 v3` / `緊張度4を講評前に記録`.

### An answer whose score failed

A score that ended `failed` does not hold the round feedback back (`07` §5.12, `06`, 2026-09-28). The
answer's rows read as unscored — the same `未採点` state History shows — and the round-level findings
are written without it. History offers a retry for that answer alone; the round-level findings are
not regenerated when it lands.

### When the round-level findings are not in

If `complete` could not generate them — the last score did not land within its bound, or the call
failed (`07` §5.12) — the per-answer region renders every score that landed, and the round-level region
is replaced by one plain sentence saying the findings are not ready, with a control that retries them
(`07` §5.16). **No spinner.** The round is already complete and its rating recorded; nothing on this
screen waits.

**When no answer in the round could be scored** — every answer's latest attempt ended `failed`, none
pending — the findings are refused as `no_scores` and no retry can produce them (`07` §5.12). The
screen derives this from the latest attempts and replaces the round-level region with one plain
sentence saying no answer could be scored, so there are no findings for this round. **No retry
control**: it could never succeed.

### Refuses
- **No composite.** No round total, no average, no per-answer aggregate, no letter, no percentage.
- **No prose beside a dimension** (design system §7).
- **No comparison to other users**, and no comparison to a target other than the user's own history.
- **No regenerating a model answer** (`07` §6). The one stored with the round is the one shown, now
  and later; the control above writes only what is missing.

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
`縦線は評価基準・出題・応募書類が変わったところです。` /
`点にカーソルを合わせると、日付・第何問かが出ます。`

That first line is the exclusion list, and it must match what the data layer actually excludes:
practice rounds, retries, follow-ups, and typed (non-spoken) answers — **and, since 2026-09-27,
questions answered in practice before they met a realistic round, answers in the wrong language, and
abandoned rounds** (`06`). The English footer written for this screen (§0) lists all of them.

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
- `未採点 — 採点をやり直す` — re-scores the unscored answer alone; the round feedback is not
  regenerated (`07` §5.12, `06` 2026-09-28)
- `中断 — 進捗から除外`

**`中断` is derived** (`04` `rounds`, `06` 2026-09-27): an open round is abandoned once a newer round
has started, or once the day it started has passed — the user's local day, Asia/Tokyo. The newest open round started today is in
progress, and History offers to resume it rather than marking it.

### Detail — the matrix (§5.5)
Header: `行動面接` 17px/600, `日本語・実戦・5問`, date, and
`求人票 Mercari_SRE_2026.pdf・緊張度4を講評前に記録` at 12px `--ink-6`. Right: the `English`
language pill and `編集できません` at 11px `--ink-8`.

**A past round's content is read-only.** An unscored answer can be scored from its row without changing
the round feedback (`07` §5.10–§5.12). For a Japanese round with a stored translation, the pill changes
the dimension labels; the feedback itself is read on screen 8.

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
is recorded as a hole, never silently omitted and never backfilled. It is read from the `follow_ups`
row whose `status` is `missing` (`04`).

The 34px column holds a play triangle (`M4.6 3.2 10.6 7l-6 3.8V3.2Z`, 1.2 stroke) that opens the audio
and the raw transcript for that row.

### Footer
`深掘りは進捗に入りません。回答ごとの1〜5だけを残しています。` /
`音声と未修正の文字起こしは、この行から開けます。` and right, the stamp
`評価基準 v1.2・出題 v1.0` / `応募書類 v3`.

### As built (#50)

**Routes.** `/history` opens the newest round, or says there are none and offers to start one;
`/history/{roundId}` is one round's detail, and another user's id is a 404. The rail is the layout, so
it stays put while the detail changes. Its first page — 20 rounds — is read by the page itself; `Older
rounds` fetches the next from `GET /api/rounds` by cursor (`07` §5.13). The count beside `ROUNDS` is
every round, listed yet or not. A detail refresh reads the older pages again as far as the oldest
round loaded, including beyond the 100-round request limit, and merges them in by round id, in the
order the server returned them: a round already listed is never dropped — not when another tab has
started a round since, and not a page `Older rounds` adds while it is reading. Home links here until
the navigation exists.

**The chrome, in English (§0).** The artboard's strings are layout; these replace them. Data keeps its
language: questions, follow-ups, transcripts and a stored `応募書類 v1` are shown as written, and a
Japanese round's dimensions are named in Japanese until the pill is used.

| Artboard | Built |
| --- | --- |
| `行動面接` | `Behavioural` — the round type, named as on Setup |
| `日本語・実戦・5問` | `Japanese · Realistic · 5 questions` |
| `未採点 — 採点をやり直す` | `Unscored — retry scoring` |
| `中断 — 進捗から除外` | `Abandoned — not counted in progress` |
| `求人票 …・緊張度4を講評前に記録` | `Posting: {company}, {title} · Pressure 4 recorded before the feedback`; a general round reads `General practice` |
| `編集できません` | `Read-only` |
| `└ 深掘り` | `└ Follow-up` |
| `深掘りが生成されませんでした。空欄として記録しています。` | `The follow-up was not generated. It is recorded as a gap.` |
| `深掘りは進捗に入りません。回答ごとの1〜5だけを残しています。` | `Follow-ups are not counted in progress. Only each answer's 1–5 on each dimension is kept.` |
| `音声と未修正の文字起こしは、この行から開けます。` | `The audio and the uncorrected transcript open from each row.` |
| `評価基準 v1.2・出題 v1.0` / `応募書類 v3` | `Rubric v1.0 · {generator versions}` / `{CV label} · {scoring models}` |

**The stamp carries all four** (refusal #5), read from the attempts whose scores are shown: the rubric
label, every generator prompt version among them (a question's and a follow-up's differ), the CV
label, and every scoring model — more than one after a retry made under a new model. Pending and
failed attempts have no displayed score, so their generator and model stamps are excluded.

**The rail's status line is one line per round.** A complete round with any `pending` or `failed`
score says `Unscored — retry scoring`; an abandoned one says it is abandoned, whatever its scores;
**the newest open round started today says `In progress — resume`, a link to the round**, and its
detail carries `Resume this round`. A complete round with every score in carries no line.

**The pill** is shown for a Japanese round whose feedback was stored with its translation, as on
screen 8. On this screen it renames the dimensions, in the rubric version's own two labels; the scores,
the questions and the transcripts do not change. The feedback itself is read on screen 8, which a
complete round links to as `Round feedback`.

**Rows the artboard does not draw.**

- **`└ Answered again`** — a practice retry, a row of its own directly under the answer it retries,
  with its own scores and its own recording. The first answer stays above it, unchanged (refusal #3).
- **An unscored answer** spans the score columns: `Not scored` after a failed score, `Not scored yet`
  for one still pending, each with `Retry scoring`. A failed score gets a new attempt and then its run;
  a pending one is run as it is (`07` §5.10–§5.11). While it runs the row says `Scoring this answer.`
  in words — no spinner (`03` §8) — and the scores then replace the line. A failure is the catalogue's
  sentence on the row, with the retry still offered. If attempt creation commits but its response is
  lost, History refreshes the row so the pending attempt can be run. **Only that answer is scored**:
  the round feedback is not regenerated (`06`, 2026-09-28), and an answer with an `ok` score has no
  control at all.
- **`Not answered`** — a follow-up that was asked and never answered is shown with its text; **a
  question the round never reached is shown as `Q3` alone, without its text.** Only an answer makes a
  question seen (`04` `round_questions`), and History must not make it seen by another route.
- **`Scores are held until the round ends.`** — every answered row of a realistic round still in
  progress. Nothing a score would say reaches the page (US-8), from the loader down.

**What a row opens**, under itself, one row at a time: the question as asked; the recording, as an
`<audio>` element on a playback URL minted at that moment (`07` §5.14), with the pace and the rewrite
figure beside it; and **`RAW TRANSCRIPT — UNCORRECTED` beside `CORRECTED ANSWER`**. A missing recording
is `The recording could not be found.` and one the browser cannot play is `The recording could not be
played.`, each as a callout rail (`05` §5.8) with the transcripts still shown.

**Nothing on this screen deletes, shares, exports or edits.** Its controls are the play toggles, the
pill, `Retry scoring` and `Older rounds`; `11` §4 holds that list in Playwright.

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
  not decide the open bilingual chrome rule. Its Japanese strings passed a native read on 2026-09-19
  (`00-status`).
- ~~**CV screen.**~~ **Closed — specified in §13.** The nav's fourth item now has a specification
  built from `05` components rather than an artboard: two panels, one per language, each with an
  empty state, a current version showing its documents with claim spans underlined, a prefilled
  new-version form, and a version history. No artboard was drawn and none is needed — every element
  it uses is already measured in `05`.
- ~~**Three prose strings still say `職務経歴書` where they now mean the whole set.**~~ **Closed —
  rewritten in the 2026-09-27 AI review** (`docs/checklists/native-read-cv.md` §3, `05` §6): §8's
  section label is `応募書類との照合`, §9's legend `縦線は評価基準・出題・応募書類が変わったところです。`,
  and §8's round-level line `数値の裏づけがない箇所が2つ。応募書類の…`, which also moved to its list's
  plain register. An AI review, not a native read.
- ~~**The `design/` artboards still draw `職務経歴書 v3`.**~~ **Closed — re-seeded in #22.** Every
  stamp in `design/*.dc.html` now reads `応募書類 v{n}` (`CV v{n}` in English), the rejected
  explorations DirectionA and DirectionC included for consistent terminology, and
  `design/suburi-directions.html` was rebuilt from those working files. The three prose strings in
  the item above were re-seeded into the artboards the same way on 2026-09-27.
- ~~**Practice mode's screens.**~~ **Closed — specified in §15 (#49).** Practice differs at the record
  frames (no timer, `録り直し可`) and delivers feedback per answer as well as at round end, and only
  realistic mode is drawn. Its shape was decided on 2026-09-27 (`06`) and is now specified from `05`
  components, the way §13 was: realistic's flow, text only and untimed; a re-take on the record
  frames until the take is transcribed; a per-answer frame after each commit, pending until scored,
  with the follow-up ready beside it; answer again; and round feedback at the end with no
  felt-pressure screen before it.
- **The four-round run.** Deferred as LATER and unshaped (decision log).
- **The role-context picker and add form** on Setup (§2), specified by the slice that builds them.
- **Loading, error and offline states** beyond the two History statuses and the missing-follow-up row.

---

## 13. CV — `/cv`, no artboard

**Purpose.** Put in, and read back, the material every round is scored against — and let extraction be
checked against the user's own text before anything depends on it.

Session-required like every other screen (`08` §5). Built entirely from `05` components; nothing here
needed a new one, which is why no artboard was drawn.

> **Every Japanese string in this section had an AI review on 2026-09-27, not a native read.** The
> user does not read Japanese and delegated `docs/checklists/native-read-cv.md` to Claude; every row
> in it was accepted as written, including the six amended from the 2026-09-24 draft (`05` §6, `06`).
>
> **#13's read already changed two words here, applied in #15:** a version is `バージョン`, never `版`,
> and Claim is `記載事項`, never `主張` (`05` §6). The strings below carry both.

### Two panels, side by side

`repeat(2, 1fr)` at the standard `14px` card gap, 1280px frame, `padding: 40px 44px` like every
screen. Left panel is the Japanese CV, right is the English one. Each is headed by a §3.3 section
label — `応募書類` and `CV` — and the two panels are independent: saving on one does nothing to the
other, and either may be empty while the other is not.

**Each panel's chrome is in its own language.** The Japanese panel's labels, hints, buttons and
messages are Japanese; the English panel's are English, on the same screen at the same time. A panel
is *about* one language's documents, so its chrome has an obvious language, which is not true of the
round screens.

> **This settled the bilingual chrome rule for this screen and no other.** The general rule was decided
> on 2026-09-27 (§0): round screens follow the round, app-level screens are in English. This screen
> keeps its per-panel rule, because it is about two languages' documents at once.

### Empty panel

One action and nothing else: an outline button (`05` §5.7) reading `応募書類を登録する` / `Add your
CV`, over a 12px `--ink-6` line naming what the set requires —
`履歴書が1通必要です。ほかに職務経歴書を1通と、補足資料を5つまで追加できます。` /
`One CV document is required. You can add up to five supporting documents.`

No placeholder version, no sample, no "get started" sequence. The panel states what is missing and
offers the one move that fixes it.

### Current version

| Element | Spec |
| --- | --- |
| Version stamp | `05` §5.9, but **top-left of the panel rather than bottom-right** — here it labels the thing being read, it is not the provenance footer of a score. `応募書類 v3` / `CV v3`, with `2026-08-30` beside it in mono. |
| Claim count | 11px mono, `--ink-label`, with the count of claims no answer has used (below): `記載事項 34件・未使用 12件` / `34 claims · 12 never used`. **`件`, never `点`** (`05` §6). |
| Documents | In `position` order. Each is a §3.3 section label — `履歴書` · `職務経歴書` · the user's own title for an additional document — over its text at 13px/1.9. |
| Claim spans | Each surviving claim's span **underlined** in its document's text: `border-bottom: 1px solid var(--accent-mid)`, or the heavier coverage mark below. Nothing else — no numbering, no margin notes, no hover card. |

**The underline is the whole point of this screen.** It is how extraction gets checked: the user reads
their own CV and a wrong span is visible as a phrase underlined that is not an assertion, or an
assertion left bare. That check is the answer to `CONTEXT.md`'s open question about extraction quality
(#20), and it is why the text is rendered in full rather than summarised into a claim list.

**Every underlined range is sliced from `cv_versions.body` by span** (`04`), never from model output,
and every span lies inside exactly one document's range. A span that crossed a document boundary was
dropped at save time and is not here to render.

### Coverage marks

Specified and built with the CV-grounding slice (#46), which is when citations began to exist.

**A claim an answer has used carries a heavier underline: `border-bottom: 2px solid var(--accent)`.**
A claim no answer has used keeps the `1px --accent-mid` line. The mark is the underline's weight and
nothing else — the same line, heavier and in the full accent — so the text still reads as the user's
own CV and the extraction check above still works on every claim.

| Element | Spec |
| --- | --- |
| Used | `2px --accent`. A claim is used when an answer cited it **or any claim it was carried forward from** (`cv_claims.supersedes_claim_id`, `04`), with either relation: an answer that contradicted a claim used it. |
| Never used | `1px --accent-mid`, as before. |
| Count | The never-used count beside the claim count, in the version stamp row (above). Zero is stated: `未使用 0件` / `0 never used`. |
| Legend | One 12px `--ink-6` line under the stamp row, always shown: `太い下線は、これまでの回答で使った記載事項です。` / `A heavier underline marks a claim one of your answers has used.` |

**Coverage is inherited down the carry-forward chain, never up it.** A claim of v3 carried from v1
reads as used if an answer cited the v1 claim; a v1 claim does not become used because an answer
cited its v3 descendant. So an old version's page (`/cv/versions/{id}`) shows what had been used *of
that version and its ancestors*, by the same rule, and the count on it is that version's own.

**It is read at render from `claim_citations`, never stored** (`04`): there is no coverage column to go
stale, and a citation written a minute ago is on the page at the next load.

**The history rows keep the plain claim count.** A never-used count on an old version is a figure
about material that version no longer puts in front of a scorer.

> **The two Japanese strings above have not had a native read** — `記載事項 34件・未使用 12件` and the
> legend. They are in `docs/checklists/native-read-round.md` §7 with the grounding region's.

### New version

An outline button `新しいバージョンをつくる` / `Create a new version` opens a form **prefilled with the current
version's documents** — same kinds, same titles, same text, same order, and each document's
`source_filename` if it had one. Changing one document does not
mean retyping the others, and the prefill is also what makes `cv_unchanged` a real risk worth refusing
server-side.

| | |
| --- | --- |
| Per document | A title (fixed for the three known kinds; a text input for `additional`) over a monospaced-width textarea at 13px/1.9. |
| Import | Beside each box, `ファイルから読み込む` / `Import from a file`, accepting `.docx` and `.pdf` — a text control in the §3.3 label style beside `外す`, for the same reason. **The text is extracted in the browser and dropped into that box, which stays editable.** The file is never uploaded (`07` §5.2). |
| After an import | The extracted text **replaces** the box's text, and the document's `source_filename` becomes the file's name. A 12px `--ink-6` line: `読み込んだ本文を確認して、必要なら直してください。保存した本文がそのまま評価に使われます。` / `Check the imported text and fix anything wrong. What you save is what gets scored.` |
| A failed import | An `--attention-mark` callout rail (`05` §5.8) under the box, which is left as it was. No text in the file (a scanned PDF): `このファイルからは文字を読み取れませんでした。スキャンした画像には文字情報がないため、本文を貼り付けてください。` / `No text could be read from this file. A scanned file has none — paste the text instead.` Anything else — damaged, password-protected, not really `.docx`/`.pdf`: `このファイルは開けませんでした。破損しているか、パスワードで保護されている可能性があります。本文を貼り付けてください。` / `This file could not be opened. It may be damaged or password-protected — paste the text instead.` |
| 履歴書 box only | An `--accent-mid` callout rail (`05` §5.8): `生年月日・住所・電話番号・顔写真・家族の情報は省いてかまいません。評価には使いません。` |
| Add | `補足資料を追加` / `Add a supporting document`, disabled at five. Japanese panels also offer `職務経歴書を追加` until one exists. |
| Remove | `外す` / `Remove` beside the 職務経歴書 and each additional document — never the required one. A text control in the §3.3 label style, not a §5.7 button: `05` draws no quiet variant, and a 48px outline beside every box outweighs the box. It removes a document from the unsaved form; nothing stored is touched. |
| Additional document | The title input is labelled `資料名` / `Title`, its box `本文` / `Text`; the pair is grouped as `補足資料` / `Supporting document`. |
| Order | Always the required document, then the 職務経歴書, then additional documents in the order added — `04`'s one order. A 職務経歴書 added after a supporting document still takes its place after the 履歴書. |
| Save | Solid primary `このバージョンを保存する` / `Save this version`, with the `05` §5.7 caption stating what it commits to: `保存すると、この内容でバージョンが確定します。あとから直すことはできません。` / `Saving fixes this version as it is. It cannot be edited afterwards.` While saving, the caption reads `記載事項を抽出しています。しばらくかかることがあります。` / `Extracting claims from your CV. This can take a while.` |

**The save control disables while a save is in flight**, and the panel states that extraction is
running. This is the client half of `cv_unchanged` (`07` §5.2); the server refuses a duplicate whether
or not the client got it right.

**Imported text is never saved unread.** The box is the editable copy, and what the user leaves in it
is what is sent — a PDF's broken line wraps and table columns get corrected before they become part of
an immutable version, not after.

### After a save

The panel returns to the current-version view, now showing the new version, with a 12px `--ink-6`
result line above it:

`34件を抽出しました。うち27件は前のバージョンから引き継ぎ、7件が新規です。除外は0件でした。` /
`34 claims extracted — 27 carried forward, 7 new. 0 dropped.`

**`spans_rejected` is shown whenever it is non-zero**, on an `--attention-mark` callout rail (`05`
§5.8): `2件は本文と一致しなかったため除きました。` / `2 claims were dropped — their quotes did not
match your text.` Zero is stated plainly in the result line rather than hidden, because a counter that
only appears when it is bad is a counter nobody learns to read.

On failure, nothing changes and the form keeps its contents: the version was not created (`07` §5.2),
so there is nothing to reconcile. The message is the catalogue's copy for `cv_extraction_failed`,
`cv_unchanged` or `rate_limited`, in that panel's language. **`rate_limited` adds a second line with
the clock time the save can be retried**, from `Retry-After`, in local 24-hour `HH:MM` rounded up to
the minute: `14:32から保存できます。` / `You can save again at 14:32.` A clock time rather than a
countdown, because it stays true however long the callout is on screen (`06`, #18).

### Version history

Below the current version, in the same panel: one row per older version, newest first — label, date,
claim count — at 12px, `--ink-6`, on `--rule-hairline` separators. A row is a link to that version at
**`/cv/versions/{id}`**, a server-rendered page in the same shape as the current-version view — stamp,
date, count, documents with their underlines — with no new-version action and a link back to `/cv`
(`06`, #16). An id that is not the user's, or not a version at all, is a 404. The page is also what a
CV stamp on an old answer will link to.

**Readable, never selectable.** There is no control that makes an older version current and none that
points a round at one (`07` §6). History here answers "what was I scored against in August?", which is
what the CV stamp on an old answer means.

### Refuses

- **No coverage figure beyond the two counts.** No percentage, no "coverage score", no bar: a share
  of the CV used is one step from a composite about the user, and a CV is not better for having every
  line said aloud. (The earlier refusal here — no coverage marks at all — was lifted by the
  CV-grounding slice, #46, which is when citations began to exist.)
- **No citation count per claim, and no list of the answers that used one.** The mark is binary.
  Which answers leaned on a claim is History's question, not this screen's.
- **No "contradicted" mark.** A contradiction is a finding about an answer and is shown where the
  answer is (§8); on this screen a contradicted claim reads as used.
- **No edit and no delete** — not a document, not a claim, not a version (`04` §6, `07` §6).
- **No version label input.** The label is derived, per language (`04`).
- **No upload of the file itself.** The browser extracts text; the file does not leave it.
- **No score, no quality figure, no "CV strength".** This screen shows what was extracted and where it
  came from. Rating a CV is a different product.

---

## 14. Status — `/status`, no artboard

**Purpose.** Show whether the two things `12` §6 watches for — scores quietly not landing and cost
drifting — have happened, and whether the job that watches is still running. Specified from `05`
components, like §13, before it is built (#55).

Session-required like every other screen (`08` §5), **the user's own page**: not an admin route (`07`
§6 — there are no roles) and not a sharing surface (§11 refusal 6). English chrome (§0). Reached from
Home's status line (§1); it is **not in the app header's nav**, which stays `Home · Progress · History
· CV` (`05` §5.1).

### Layout

The standard frame, `padding: 40px 44px`, **one card** at 1280px (`05` §4): a card header holding the
§3.3 section label `STATUS`, then the body at `26px 32px 32px`, its three blocks gapped `28px`, each
headed by a §3.3 section label.

### Staleness, first

**If `self-check` has not run for over 48 hours, the page says so before anything else** (`12` §6,
`06` 2026-09-28): an `--attention-mark` callout rail (`05` §5.8) at the top of the body —
`Self-check has not run since 2026-09-27 04:12. Every reading below is from that run or earlier.` —
or, with no run at all, `Self-check has never run. Nothing below has been checked.` A dead cron must
never read as "all clear". Nothing is shown when the last run is within 48 hours.

### Jobs — `JOBS`

Two rows on `--rule-hairline` separators, `padding: 11px 0`: the job name at 13px (`Self-check`,
`Weekly digest`), its schedule at 12px `--ink-6` (`Daily, 04:00–05:00`, `Mondays, 05:00–06:00`), and
right-aligned in 12px mono `--ink-3`, when it last ran — `2026-09-30 04:12`, or `Never` in
`--ink-9`. Times are Asia/Tokyo, 24-hour, as everywhere in this app (`06`, 2026-09-28).

### Checks — `CHECKS`

One row per `12` §6 row `self-check` covers, **always all ten, in `12` §6's order**, from the newest
`self-check` run. A grid `minmax(0,1fr) 140px 160px 96px`, rows on `--rule-hairline`, `padding: 11px
0`:

| Column | Spec |
| --- | --- |
| Check | 13px `--ink-2`: `Scores pending over 24 hours`, `Failed scores not retried`, `Spend this week`, `CV quotes not found in text`, `CV claims split`, `CV claims duplicated`, `CV longest unread run`, `CV quotes outside window`, `Rounds without feedback over 24 hours`, `Daily backup failed` |
| Reading | 13px mono, right-aligned: a count (`0`, `3`), code points (`1,071`), or dollars (`$0.84`). `—` in `--ink-9` when there is no reading |
| Threshold | 12px mono `--ink-label`, right-aligned: `above 0`, `above 2,000`, `above $2.10` |
| State | 12px, right-aligned: `Red` in `--attention-ink`/500; `OK` in `--ink-4`; `No reading` in `--ink-9` |

When spend includes a model without a price, its row is red regardless of the dollar threshold. Under
the check name, 12px `--attention-ink` names each unpriced model (or `missing model ID`). The dollar
reading counts priced rows only. Home's one line names the same model beside `Spend this week`. Last
week's digest names excluded models beneath its figures.

**No reading is not OK.** A CV counter whose current versions all predate the counter columns has no
reading (`04` `cv_versions`), and says so rather than showing `0`; so does `Daily backup failed`
anywhere without a backup key, which is everywhere but production (#56). With no run at all, every row
reads `—` and `No reading`.

Under the table, 12px/1.7 `--ink-6`: `Spend counts the stored token columns only, priced at
lib/ai/models.ts's rates. Unpriced models are named and excluded from the dollar figure. The threshold
is 3 × $0.70 per round started this week, with a floor of one round.` — the loose-until-re-measured
caveat of `12` §6, stated where the number is read.

### Last week — `LAST WEEK`

From the newest `digest` run: the week it covers (`2026-09-21 – 2026-09-27`) at 12px mono `--ink-6`,
then a two-column list of label (13px `--ink-3`) and figure (13px mono, right-aligned): `Rounds
started`, `Rounds completed`, `Tokens in`, `Tokens out`, `Spend`, and the near-duplicate guard's week
(#47; `06`, 2026-09-29): `Near-miss questions` — a count — `Near-miss similarity`, and `Questions
reused as duplicates`. **Near-miss similarity is one row holding three figures**, `0.412 – 0.655 –
0.871`, lowest, median and highest to three decimals, with `lowest – median – highest` under the
label in 11px `--ink-6`; `—` in `--ink-9` when the week had no near-miss. With no digest run: `No
weekly digest has run yet.` at 12px `--ink-6`.

Under the list, 12px/1.7 `--ink-6`: `A near-miss is a generated question that went into the bank
beside a similar one, below the duplicate threshold of 0.90. At or above it, the existing question is
reused. The threshold is a guess; these figures are what it gets tuned from.` The `0.90` is read from
the constant, not written.

### Refuses

- **No text from the record** — no transcript, CV, claim or note, and no id rendered either. The
  run holds counts and ids only (`04` `cron_readings`, `12` §7); model ids are configuration identifiers,
  not record text. The ids behind a red check stay in the database for investigation, not on the page.
- **No share, export or public link** (§11 refusal 6), and **no run-now button**: a run comes from the
  cron, or by hand with `CRON_SECRET` (`07` §5.17); the page reads, it never writes.
- **No delete, no acknowledge, no mute.** A red check clears when a later run finds it clear, and not
  otherwise.
- **No score** of any kind (§11 refusal 1). Spend is money, not a measure of the user.

---

## 15. Practice mode — the round's frames, no artboard

**Purpose.** The same round with the pressure taken out and the scores let in: no clock, a take that
can be recorded again, each answer's scores as soon as they exist, a second go at the same question,
and the round's feedback at the end with no rating asked first (PRD §2, US-5, US-8).

Only realistic mode was drawn. **Practice's shape was decided on 2026-09-27 (`06`) and is specified
here from `05` components, before it was built (#49)** — the way §13 was. Everything §3–§8 says holds
in a practice round unless this section says otherwise, and every string is in the round's language
(§0); the Japanese ones are in `docs/checklists/native-read-round.md` §10, accepted by the owner on 2026-10-05.

The round header (`05` §5.2) names the mode: `English · Practice · 3 questions`, `日本語・練習・3問`.
A practice round is chosen on Setup (§2), where the mode's line already says what it is.

### What a practice round never shows

- **No speaker line and no speech**: practice is text only (§3).
- **No clock.** No `1:04 / 4:00`, no `最長` line, no `4分で自動的に止まります。` and no one-take line.
  The 15-minute runaway guard still ends a take and keeps it (`03` §7), and is never drawn: the
  waveform scrolls at a fixed pace and has no remainder line to fill.
- **No felt-pressure screen** (§7), and no `緊張度` stamp on the feedback.
- **No promise that feedback is withheld.** The record frames' footer sentence is instead
  `Each answer's scores appear once it is scored. The round's feedback comes at the end.` /
  `回答ごとの採点は、済みしだい出ます。講評はラウンドの最後にまとめて出ます。`

### Record, with a re-take — §3–§5 in practice

- **Asked.** The question at 19px, the outline `Start recording` button, and two lines at 12px/1.75
  `--ink-6`: `You can record again until the take is transcribed.` /
  `文字起こしをするまでは、録り直せます。`, then §3's `止めたあとに文字起こしを直せます。`
- **Recording.** §4's status and waveform, without the timer. The outline button reads
  `Stop recording` / `録音を停止` — stopping keeps the take and does not transcribe it — with no caption
  beside it.
- **Take held** — the state practice adds between §4 and §5. Stopping opens the answer slot and
  uploads the take (`07` §5.6); while that runs the frame says `Uploading the take.` /
  `録音をアップロードしています。` Then, with the question still at 19px and unmoved:
  - the status line, in `--ink-label`: `Take recorded — not transcribed yet` /
    `録音済み — 文字起こし前`;
  - a solid primary `Transcribe this take` / `この録音を文字起こしする`, captioned
    `Once it is transcribed, the take is final and cannot be recorded again.` /
    `文字起こしをすると、この録音で確定します。録り直しはできなくなります。`;
  - the outline record button, now `Record again` / `録り直す`, captioned
    `Recording again replaces this take.` / `録り直すと、いまの録音は置き換わります。`
- **The re-take replaces the take in the same answer** — the same row and the same object, until it is
  transcribed (`07` §5.6). It is offered here and nowhere after: §5's transcript is final, as in
  realistic mode. While the take is being transcribed the frame says `Transcribing the take.` /
  `文字起こしをしています。`
- **A reload before the transcript** shows the question again, as §3 does: the take was in the tab.
  Recording then is a re-take onto the answer already opened.

### Transcript correction — §6 in practice

Unchanged, meter included: the diff is stored in both modes (US-6). Only the commit's caption
differs where §6's would promise silence — under a follow-up's own answer, or an answer given again:
`Sending scores this answer. Its scores appear on the next screen once it is scored.` /
`送ると、この回答を採点します。採点が済むと、次の画面に出ます。`

### The per-answer frame — after every commit

3-column grid, as §6 and §7: the answer at `span 2`, what comes next in the last column. The header's
step is the answer's own.

**The answer.**
- The step in 11px mono `0.16em` and, right-aligned, the answer's figures — both exactly as §8's
  per-answer region sets them.
- The question at 15px/1.85 `--ink-2`.
- **The rubric's score rows** (`05` §5.3), one per dimension, in the rubric's order.
- **Until the score lands, the frame says so and does not spin**: every row reads `Not scored yet` /
  `採点中` (§8's words), and one sentence in the information tone (`05` §5.8) sits under them:
  `This answer is being scored. Its scores appear here once it is scored; you can go on without waiting.` /
  `この回答を採点しています。済むとここに出ます。待たずに先へ進めます。` The frame reads the round
  (`07` §5.5) every few seconds while the score is pending and fills the rows when it lands. Nothing
  on the frame waits for it.
- **A score that failed** reads `Not scored` / `未採点` on every row, with one sentence in the
  attention tone: `This answer could not be scored. It is kept as it is.` /
  `この回答は採点できませんでした。回答はそのまま残っています。`
- **Its flags, once scored** — callout rails under the rows, and only for an answer that went through
  the CV check (§8's rule):
  - one `--attention-mark` rail per unsupported span, in the order the spans stand in the answer:
    `Unsupported — nothing in CV v3 backs “raised the whole team's productivity”.` /
    `裏づけなし —「チーム全体の生産性を上げた」に対応する記述が応募書類 v3にない。` — §8's sentence
    without the question number, the quote sliced from the corrected text by its stored span;
  - or, with none, §8's `--ink-9` rail: `Unsupported — nothing flagged against CV v3.`;
  - and §8's wrong-language line, when the scorer read the answer in the other language.

**What comes next**, under the section label `Next` / `このあと`. One solid primary, with its caption:

| The round is on | Shown | Primary | Caption |
| --- | --- | --- | --- |
| the answer's follow-up | `└ Follow-up` / `└ 深掘り` over the follow-up's text at 13px/1.75 `--ink-2` — **ready beside the scores** | `Answer the follow-up` / `深掘りに答える` | §6's `The answer above is saved and scored as it is. It cannot be changed.` |
| the next question | its step, `Question 2 / 3` — not its text | `Go to the next question` / `次の質問へ進む` | the same |
| the end of the round | — | `Go to the feedback` / `講評に進む` | `Closes the round and writes its feedback. Practice asks for no pressure rating.` / `ラウンドを終えて、講評をまとめます。練習では緊張度を聞きません。` |
| a follow-up that could not be generated | §6's `followup_generation_failed` sentence, attention tone | `Go on` / `先へ進む` | §6's caption |
| a follow-up not stored when the page loaded | §6's plain sentence, information tone | `Go on` / `先へ進む` | §6's caption |

`Go to the feedback` completes the round **without a rating** (`07` §5.12) and opens §8; while it runs
the caption reads `Writing the findings.` / `講評をまとめています。` The two `Go on` rows are §6's
"after the commit" frame, folded into this one: in practice the saved answer is shown with its scores.

**Answer again.** Below a `--rule-section` rule, an outline button `Answer again` /
`もう一度答える`, captioned
`A new answer beside this one, scored on its own, with no follow-up. This one stays as it is.` /
`新しい回答として、この回答の横に残します。別に採点し、深掘りはつきません。この回答はそのまま残ります。`

The round's stamp (`05` §5.9) closes the column: this frame shows scores.

### Answering again

- The same prompt is asked again on the record frames above, and the header's step says so:
  `Question 1 / 3 · again`, `第1問 / 3問・再回答` — on a follow-up, `Question 1 / 3 · follow-up · again`,
  `第1問 / 3問・深掘り・再回答`.
- **Nothing is written until a take exists** (§4). Until then a text link, `Back to the scores` /
  `採点に戻る`, returns to the frame it came from.
- It goes through record, re-take, transcript and correction like any answer, and its commit opens
  **its own per-answer frame**, whose `Next` is wherever the round already was. It makes no follow-up,
  and it can itself be answered again.
- **The first answer is never touched** (§11, refusal 3): the new answer is a row beside it at the
  same position (`04` `answers`).

### Resume

A practice round reloads onto, in this order: an answer-again that is open and not yet sent, on its
own record or transcript frame; the open answer to the round's current prompt, as §3–§5; otherwise
**the per-answer frame of the answer sent last**, with `Next` read from where the round stands. A
round with nothing sent yet reloads onto its first question. So a reload never loses an answer's
scores, and the frame after the last answer is the one that leads to the feedback.

### Round feedback — §8 in practice

§8, with these differences:

- **Reached from the last per-answer frame**, never through §7. The header says `Practice` / `練習`,
  and the footer carries no `緊張度` line.
- **An answer given again has its own page in the pager**, straight after the answer it follows:
  `Question 1 · again` / `第1問・再回答` — `again 2`, `再回答2` for a second one — with its own figures
  and score rows, headed `Question 1 / 3 · again`. It has no follow-up row. A scored retry of a
  follow-up answer also has its own page, headed as a follow-up given again. A second retry carries
  `again 2` / `再回答2` in its heading and pager label.
- **The round-level findings, and `Checked against your CV`, use the first answers and their
  follow-ups when one scored.** If none scored, they use scored answers given again under the new
  feedback prompt versions (`07` §5.12, `06`).
- The two sentences that stand in for missing findings do not mention a rating:
  `The findings for this round are not ready. The round is complete, and every score above is kept.` /
  `このラウンドの講評はまだできていません。ラウンドは終了し、上の採点はすべて残っています。` and
  `No answer in this round could be scored, so there are no findings for this round. The round is complete.` /
  `このラウンドには採点できた回答がないため、講評はありません。ラウンドは終了しています。`

### Refuses

- **No composite**, here either: the per-answer frame is score rows, never a total or a comparison of
  the two answers to one question.
- **No "better" or "worse" between an answer and the one given again.** Two sets of rows, each read on
  its own.
- **No timer, countdown or elapsed time while recording**, and nothing that draws the guard.
- **No discarding an answer.** Answer again adds a row; nothing removes or replaces one (§11).
