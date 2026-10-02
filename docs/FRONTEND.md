# Front end — `web/`

The browsing and lookup interface over the backend API. It holds no medical
content of its own: every medicine name, use, caution, interaction, warning,
count and score on screen was read out of a response from `python -m hdi.api`,
and a test suite fails the build if any of them is ever written into a source
file here.

Read [BACKEND_API.md](BACKEND_API.md) and [RECOMMEND_API.md](RECOMMEND_API.md)
first. The rules there — four distinct result states, no dose, no brand name, no
unnegated safety claim, nothing marked reviewed — are what this front end exists
to present faithfully.

## Running it locally

Two terminals, because they are two services.

**Terminal 1 — the backend:**

```powershell
cd E:\ayurveda-hdi
.\venv\Scripts\activate
python -m hdi.seed                 # once, or after changing a reference file
$env:ALLOWED_ORIGINS = "http://localhost:3000"
python -m hdi.api                  # http://127.0.0.1:8000
```

On macOS or Linux:

```bash
source venv/bin/activate
python -m hdi.seed
ALLOWED_ORIGINS=http://localhost:3000 python -m hdi.api
```

`ALLOWED_ORIGINS` already defaults to `http://localhost:3000`, so for the normal
case the plain `python -m hdi.api` is enough. Set it when the front end is on a
different port.

**Terminal 2 — the front end:**

```powershell
cd E:\ayurveda-hdi\web
npm install                        # once
npm run dev                        # http://localhost:3000
```

Open http://localhost:3000. If the backend is not running, every page says so
and names the command that starts it, rather than showing an empty list.

For a production build:

```powershell
npm run build
npm run start
```

## Structure

```
web/
  src/
    app/                     routes (App Router)
      layout.tsx             fonts, theme script, header, footer
      globals.css            the design tokens and the motion rules
      page.tsx               /                home, with the problem form
      ask/page.tsx           /ask             describe a problem
      check/page.tsx         /check           check two medicines
      medicines/page.tsx     /medicines       search and browse all of them
      medicines/[id]/        /medicines/{id}  one medicine
      how-it-works/page.tsx  /how-it-works    the pipeline, the classifier
      not-found.tsx          404
      error.tsx              last-resort error boundary
    components/
      ui/                    the shadcn/ui primitives actually used
      site-header.tsx        nav and the theme toggle
      site-footer.tsx        disclaimer, scope, how-it-works link
      home/hero-art.tsx      the hero's drawn layers: hills, grass, branches, motes
      home/hero-particles.tsx  loads the WebGL particle field after first paint
      home/particle-field.ts the particle field itself (three)
      home/scene-motion.tsx  parallax depth and scene reveals
      disc-mark.tsx          the small vermilion disc the quiet states carry
      medicine-search.tsx    the /medicines search box (alias-aware)
      medicine-combobox.tsx  one-medicine picker, for /check
      medicine-token-input.tsx   "what you already take"
      recommend-answer.tsx   every state /recommend can answer with
      ask-form.tsx           the form around it, on / and on /ask
      option-card.tsx        one option, dimmed when already taken
      warning-graph.tsx      "combinations to avoid": hubs and lines
      warning-drawer.tsx     one warning row in detail
      interaction-row.tsx    one stored interaction pair
      medicine-browser.tsx   the filter and search on /medicines
      count-up.tsx           the home page's counting numbers
      api-unreachable.tsx    "the database server is not responding"
    hooks/
      use-medicine-search.ts debounced, abortable search
    lib/
      api.ts                 the typed client, timeouts and error states
      types.ts               response types, written from real responses
      warnings.ts            hub resolution and warning grouping
      options.ts             marking what the reader already takes
      forbidden.ts           the honesty scan
      text.ts                shared copy and small helpers
  tests/
    fixtures/                44 real captured responses
    unit/                    645 unit tests
    e2e/                     the end-to-end suite and the screenshot run
```

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:8000` | Where the backend is. Read on the server **and** in the browser, so it must be a URL the reader's browser can reach. |
| `E2E_PORT` | `3100` | The port the end-to-end suite serves the app on. |

There are no API keys. The backend needs none, and
`tests/unit/honesty.test.tsx` fails if anything resembling a credential appears
in a source file.

See [.env.example](../web/.env.example).

## Design tokens

Light is the default for every page a reader works in -- `/ask`, `/check`,
`/medicines`, a medicine page, `/how-it-works`. Dark is opt-in through the
header toggle, stored in `localStorage` and applied by a blocking inline script
in `<head>` before the first paint, so there is no flash on load or on a
navigation. The system preference is deliberately not followed -- see
**Decisions**.

The home page's four scenes are the exception: they are night scenes by design
and always dark. They sit inside `.night`, a class that carries exactly the
dark theme's token values, so anything rendered in a scene looks as it would in
the dark theme. The `dark:` variant matches inside `.night` too.

Paper, ink and a 1px hairline. Vermilion is the one accent and is used
sparingly: the hero's disc, the primary button, an active state, the scroll
progress line, the chapter marks. The three evidence colours are the only other
text colours, and each clears 4.5:1 on the surface it sits on.

| Token | Light | Dark / `.night` | Used for |
|---|---|---|---|
| `--color-paper` | `#F4F1EA` | `#0D0B0A` | page background |
| `--color-surface` | `#FBFAF6` | `#161311` | panels and cards |
| `--color-wash` | `#EBE7DE` | `#1F1B18` | quiet fills, chips |
| `--color-ink` | `#14110F` | `#F4F1EA` | body text |
| `--color-ink-2` | `#5E5C58` | `#8A8884` | secondary text (stone) |
| `--color-line` | `#D2CFC9` | `#302E2C` | hairline rules, ink at 15% |
| `--color-on-ink` | `#F4F1EA` | `#0D0B0A` | type on an ink fill |
| `--color-primary` | `#C41D16` | `#FF5C50` | vermilion as text: links, active states |
| `--color-primary-fill` | `#E0231C` | `#E0231C` | vermilion as a fill: the primary button, the disc, the progress line |
| `--color-on-primary` | `#FFFFFF` | `#FFFFFF` | type on the vermilion fill |
| `--color-charred` | `#0D0B0A` | `#0D0B0A` | the scenes' near-black |
| `--color-night` | `#0F1520` | `#0F1520` | the scenes' night blue |
| `--color-stone` | `#8A8884` | `#8A8884` | stone, for the scenes' fixed palette |
| `--color-herb` | `#4A6431` | `#A9C27F` | Ayurvedic |
| `--color-drug` | `#1D5C7C` | `#84C3E3` | allopathic |
| `--color-verified` | `#B01710` | `#FF7A6E` | literature-verified |
| `--color-mechanism` | `#84500E` | `#E9B55E` | mechanism-based |
| `--color-insufficient` | `#5E5C58` | `#A3A09A` | insufficient evidence |

Contrast, measured: stone is `#8A8884` on charred (5.6:1) and night blue
(5.2:1), and darkens to `#5E5C58` on paper (5.9:1). The vermilion fill
`#E0231C` is 4.2:1 on paper, short of AA for body-size text, so vermilion
*text* is a step deeper on paper (`#C41D16`, 5.3:1) and a step lighter on
charred (`#FF5C50`, 6.5:1); white on the fill is 4.7:1. Selection is white on
the vermilion fill in both themes. Focus is a 2px vermilion outline, offset
2px, so it shows on a vermilion button as well as on paper.

Type: Onest for everything that is read, loaded through `next/font/google` at
300, 400, 500 and 600; IBM Plex Mono for PMIDs and identifiers and nothing
else. Headings are weight 400 at `-0.012em`; `h1` and a scene's one line
(`scene-heading`) are `clamp(2rem, 4vw, 2.875rem)` at a leading of 1.1. Body is
17px at 1.6 -- weight 300 inside a night scene, 400 on the tool pages, where it
has to carry dense reading. Chapter labels (`chapter-label`, "01 — Describe a
problem") are tracked capitals at 14px. Nothing readable is smaller than 14px.

Shapes: 6px (`--radius-field`, `--radius-card`) for buttons, inputs, cards and
panels, 4px (`--radius-tight`) for a block nested inside one of those. The pill
(`--radius-pill`) is kept for small badges and nothing else. Every border is a
1px hairline at about 15% of the ink.

Separation is a 1px hairline, not a shadow. `panel` and `card-surface` are a
surface with a rule and no elevation; `heading-rule` puts a rule under a
section heading and `ruled-list` puts one between the rows of a list, which is
what separates the medicine browser, the pipeline stages, the pair-check result
and the no-finding pairs. `--shadow-lift` is left for the things that really
do float over the page -- the drawer, the comboboxes.

Layout: one 1440px column (`--container-page`, the `page-shell` utility),
centred, with a 16/32/48px gutter, on an 8px grid. `section-pad` is 48px of
block padding, opening to 64 and then 80 on wider screens. Reading columns are
capped in characters (`max-w-[70ch]` and narrower).

Badges: every severity, status and confidence badge carries an icon as well as
its full wording, so no state is said by colour alone. The pair check's status
badges are a book with a tick (documented), a crossed-out search (nothing
documented) and a question mark (insufficient evidence); the evidence level on
the right of the row carries a bar-chart icon.

Motion, all of it switched off under `prefers-reduced-motion`: on the home page
the disc pulses slowly, the grass and branches sway, motes drift, the hills and
the corners move with the scroll at different depths, each scene fades up 24px
once as it enters the viewport, and the particle field drifts (see below).
Everywhere: the scroll progress line fills with the scroll position, the home
counts count up once, the search box rings on focus, results reveal once, the
combination lines draw themselves in, the warning drawer slides in, page
transitions fade, and the swap button rotates.

## The home page's scenes

The home page is a scroll story in four scenes, one short line each, then the
problem form. A 1px hairline runs down the left -- 96px in on a wide screen,
48px on a tablet, 16px on a phone -- and each chapter label sits on it with a
small vermilion mark, so the four scenes read as one line.

| Scene | Ground | What it holds |
|---|---|---|
| 01 Describe a problem | night blue to charred | The hero. "Describe a problem. See what the literature records.", one subhead line, **Describe a problem** (vermilion) and **Check a pair** (outlined). A vermilion disc behind the top of the headline, two hills, grass and a leafy branch in both bottom corners, drifting motes, a "Scroll" cue. |
| 02 Search the literature | charred | "One fixed PubMed search for every herb and drug pair." and five light numerals separated by hairlines: herbs, drugs, pairs searched, abstracts read, documented interactions (in vermilion). |
| 03 Curated by hand | night blue | "NLP finds the sentences. A person checks each one." beside two ruled placeholder rows, one per confidence state. |
| 04 Check a pair | night blue to charred | A vermilion ring and dot, "Pick a herb and a medicine.", the way into `/check` and `/ask`, and the disclaimer. |

**Every figure is live.** Scene 02's numbers come from the `/stats` response the
page is rendered with; none is written in a source file, and the honesty tests
fail if one is. The five figures are split into two groups that keep the
existing test ids: `scope-strip` (herbs, drugs, and under them the drug-class
and condition counts) and `pipeline-card` (pairs searched, abstracts read,
documented interactions, and under them the candidate-sentence count). The line
saying most searched pairs turned up nothing stays under the figures.

**The placeholder rows name nothing.** Scene 03's rows read "[Medicine name]
with [Herb name]" and "PubMed [PMID]". They show the two states a sentence can
be in -- "Verified by a curator" and "Auto-extracted, not yet reviewed" (with a
dashed border) -- not a record from the database.

**The drawn layers are in the first response.** `home/hero-art.tsx` is inline
SVG and CSS: the hills, the grass blades and the branch's leaves are generated
from a few parameters at render time, server-side, so the hero is composed in
the first paint with nothing to wait for. It is `aria-hidden`, takes no pointer
events, and an end-to-end test loads the page with every script chunk blocked
and asserts it is still drawn.

**Parallax and reveals are CSS variables and classes.** `home/scene-motion.tsx`
writes the scroll position to `--scroll` on the scenes root once per frame at
most, and each `.parallax` layer turns it into a translate through its own
`--depth`: the disc and the far hill trail the page, the near hill less so, and
the foreground corners move ahead of it. Scene reveals are hidden only after
that component has marked the document `reveal-ready`, and anything already on
screen is marked revealed first, so with scripts off every scene is simply
there and nothing visible blinks out.

**The hero is one screen.** The header lies over it, transparent and in the
night palette, and the hero pads itself by `--nav-h`; it is `clamp(34rem,
100svh, 60rem)` tall. The disc is sized by the narrower of height and width and
lifted so its lower edge clears the subhead, which therefore always sits on
night, not on vermilion. A test asserts the headline and both buttons are above
the fold at 1366x768, 1440x900 and 1536x864.

**The header.** On the home page it is transparent over the hero and takes a
charred backdrop once the reader scrolls; on every other page it is a solid
paper or charred bar. A small vermilion dot and the wordmark "Ayurvedic HDI",
the four links, the theme toggle, and a 2px vermilion progress line along its
bottom edge, written straight to a transform so scrolling never re-renders it.

**The problem form stays on the home page,** after the scenes and in the
site's own theme, because the home page has answered a described problem in
place since that was introduced, and the end-to-end suite drives it there.

## The particle field (Three.js)

Behind the hero headline, slow pollen and embers drift up through the night in
vermilion and stone, and the camera eases a little toward the pointer and the
scroll position. It is an enhancement over a hero that is already complete, so
it is only ever added, never waited for.

- **Plain `three`**, no react-three-fiber, drei or Theatre. `home/particle-field.ts`
  imports only the eight classes it uses; one `Points` object with a small
  shader does all of it, and the drift is computed on the GPU from one time
  uniform, so a frame costs the CPU a few uniform writes.
- **Loaded after first paint.** `home/hero-particles.tsx` dynamic-imports the
  field once the browser is idle (`requestIdleCallback`, with a timeout), so
  `three` is in its own chunk and not in the page's first JavaScript.
- **Skipped when it should be.** Under `prefers-reduced-motion`, or when a WebGL
  context cannot be created (probed before anything is downloaded), the field
  never loads and the static hero -- gradient, disc, drawn layers, CSS motes --
  is what the reader sees. Switching reduced motion on mid-visit tears it down.
- **Cheap while it runs.** `devicePixelRatio` is capped at 1.5; the loop pauses
  while the tab is hidden or the hero is off screen; the canvas is sized to the
  hero, not the window.
- **Out of the way.** The canvas is `aria-hidden` with `pointer-events: none`.
  While it runs, the hero carries `data-webgl="on"`, which hides the CSS motes
  so the two never double up.
- **Cleaned up.** On unmount it stops the loop, disconnects its observers and
  listeners, disposes the geometry, material and renderer, forces the context
  loss and removes the canvas.

**What it costs.** Measured on the production build: the home page's
first-load JavaScript is 221.6 KB gzipped, against 222.1 KB before this theme
-- the header, scene motion and particle loader add nothing measurable. The
particle field is one lazily loaded chunk of 132.1 KB gzipped (536.7 KB raw),
fetched after first paint and never under reduced motion or without WebGL.

## How the honesty rules are enforced

The rules are in the task this front end was built to: nothing medical
hardcoded, never the words "safe to take", never a dose, never a brand name,
absent data shown as absent, "literature-verified" only when the API says so.
They are not left to review. `web/src/lib/forbidden.ts` implements the same
scan the backend applies to its own files, with the same calibration, and the
tests apply it in four places:

1. **Over this app's source.** Every file under `src/` is scanned for a medicine
   name, a condition name, a drug class name, a brand name, a count or a score
   from `/stats`, and for forbidden wording. The names and numbers it looks for
   are read from `data/reference/*.csv` and from a live `/stats` response, so
   the check cannot go stale.
2. **Over every captured response.** All 44 fixtures, every string.
3. **Over what a component renders.** Each `/recommend` fixture is mounted and
   the resulting text scanned; the same for every stored interaction record.
4. **Over what a browser renders.** The end-to-end suite scans the real page
   text on every page it visits.

The scan's own calibration is pinned in both directions
(`tests/unit/forbidden.test.ts`): it must catch "is safe alongside" and it must
leave alone "This does not mean the combination is safe", which is the wording
this project is required to print.

## Tests

```powershell
cd web
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm test              # 645 unit tests (Vitest)
npm run build         # production build
npm run e2e           # end-to-end, needs the backend running
npm run screenshots   # writes docs/screenshots/
```

The end-to-end suite talks to a real `python -m hdi.api` with the real seeded
database. Nothing is stubbed, because a suite that passed against a mock would
say nothing about whether what a reader sees came out of the database. It
starts the Next.js server itself; the backend it checks for and refuses to run
without, naming the command to start it.

The browser calls the API directly for search, options and pair checks, so the
backend must allow the suite's origin:

```powershell
$env:ALLOWED_ORIGINS = "http://127.0.0.1:3100,http://localhost:3100"
python -m hdi.api
```

The suite checks that before the first test and says exactly this if it is
missing.

Install the browser once with `npx playwright install chromium`.

## Decisions

Recorded so they can be overruled rather than rediscovered. Each is the more
conservative of the options that were open.

| Decision | Why |
|---|---|
| Dark mode is opt-in only; `prefers-reduced-motion` is honoured but `prefers-color-scheme` is not | The approved design calls light the default. Switching a reader into dark on a setting they never chose here would contradict that. The toggle and the stored choice cover the case. |
| `GET /medicines/{id}` gained a `recorded_uses` field | The medicine detail columns are NULL for every row by design, so a medicine page had nothing sourced to show. The use rows already existed in the knowledge layer with no route onto them. Added beside the existing projection, so no field that was already returned changed. |
| The browse page filters in the browser; the home box searches the backend | The catalogue is 53 rows and frozen, so filtering it client-side is instant. A reader typing a name they know needs the backend's alias resolution and its ranking, which is a different job, and the browse page's empty state says so. |
| Placeholders name no medicine | A placeholder reading "Ashwagandha, Haldi, Metformin" is medical content written into the front end, which is the thing the honesty tests forbid. The box says which kinds of names are recognised instead. |
| Pages that are read, not driven, fetch on the server | `/`, `/medicines`, `/medicines/{id}` and `/how-it-works` render with their data already in the HTML. The interactive pages fetch from the browser, which is what makes CORS necessary at all. |
| Warnings are grouped by level, hub and reason, never by reason alone | Merging across levels could put a mechanism-based caution under a literature-verified heading. All three must match before two warnings share a row. |
| An option the reader already takes is dimmed, not removed | They asked about it. A list that quietly dropped it would be hiding something; the card says "You take this" and keeps the pros, cons and cautions. |
| The drawer lists every severity folded into a row | A row can merge pairs whose severities were derived separately, and picking one of them to display would be inventing a summary. |
| The warning panel prints the API's three summary figures without asserting arithmetic between them | They do not always sum. See **Limitations**. |
| The lines are measured from the rendered rows, not laid out on a fixed grid | The same code then draws them whether the hub sits beside the rows on a wide screen or above them on a narrow one. |
| `overflow-wrap: anywhere` on prose elements | Several values the API returns are single unbroken tokens (a label `set_id`, `abstracts_screened_no_interaction_language_found`). Only `anywhere` counts toward a grid track's minimum width, and without it a 47-character identifier widened a column past a 360px screen. |
| ESLint is pinned to 9.x | ESLint 10 is incompatible with the React plugin the framework's shared config bundles: it crashes on `contextOrFilename.getFilename is not a function`. 9.39.5 is what the framework's config is built against. |
| `ml/evaluate.py` writes `metrics.json` as well as `eval.md` | `/stats` serves real classifier metrics and the only machine-readable form was the confusion matrix. Both files are written from the same computed scores in one pass, so they cannot disagree, and nothing parses the prose report. |
| The classifier's model description says "unigrams and bigrams" | It previously read "word 1-2 grams", which the forbidden-output scan reads as a number next to a unit. The model is unchanged. |
| The particle field is the only WebGL, and it is optional | Everything the hero says is markup: the gradient, the disc, the drawn layers and the motes are in the first response. The field is 132 KB gzipped of decoration, so it loads after first paint, only with WebGL and only without reduced motion, and the page is complete without it. Plain `three` with eight named imports rather than react-three-fiber or drei, because one `Points` object with a shader needs none of their machinery. |
| The home scenes loop; nothing else does | The disc's pulse, the sway, the motes, the scroll cue and the particle field loop. All are decorative and aria-hidden, all stop under `prefers-reduced-motion` -- the looping keyframes start and end at rest, so a collapsed animation lands where it belongs -- and every other animation in the app runs once, in response to something the reader did. |
| The home scenes are always dark; the tool pages stay light by default | The scenes are a night scene by design, so they carry `.night` whatever the toggle says. A page a reader works in is dense and is read for longer, so it keeps paper and ink unless the reader chooses dark. |
| Vermilion has two values for text and one for fills | The fill `#E0231C` is 4.2:1 on paper, short of AA for body-size text. Text and active states use `#C41D16` on paper and `#FF5C50` on charred; the fill keeps the exact vermilion, with white type at 4.7:1. |
| The problem form stays on the home page, after the scenes | The home page has answered a described problem in place since that was introduced, and the end-to-end suite drives the form there. It follows the theme like every other tool rather than being forced dark. |
| The pair check keeps "First medicine" and "Second medicine" | The pickers accept any herb or drug in either slot -- a herb-and-herb check is a real state with its own answer -- so labelling them "Herb" and "Medicine" would describe a constraint the form does not have, and a swap would put a drug under "Herb". |
| Scene 02 shows five figures in a row and two more under them | The row is the five the scene is about. The candidate-sentence and condition counts are kept as a line under their groups because the end-to-end suite checks each figure against `/stats`, and dropping a live figure to save a line is a loss of information, not a style choice. |
| Scene reveals hide only once the script has confirmed it can show them | A reveal that starts hidden in CSS leaves the page blank for a reader with scripts off. The script marks anything already on screen as revealed before it arms the rest, so nothing visible blinks out. |
| Results, the browse list and the pipeline are ruled rows, not cards | A card per row turns a 53-row catalogue into 53 boxes and buries the one column a reader is scanning. A hairline between rows and columns that line up is what a reference tool looks like, and it fits far more on a screen. Cards are kept where a row really is a record with its own fields: an option, a documented interaction, a recorded use. |
| The safety line stays under the home figures | Everything else around the figures was cut, but "most searched pairs turned up nothing" is not a description of the UI -- without it, the figures read as a claim that the remaining pairs are fine. The short disclaimer closes scene 04 and is in the footer on every page. |
| Screenshots are a record, not a baseline | Nothing compares them to a reference image. A font-rendering difference would fail such a test and say nothing about the project. |
| The end-to-end suite refuses to run without the backend | Otherwise a stopped backend produces a page full of "not responding" and a dozen confusing failures instead of one clear one. |

## Limitations

- **Nothing here has been reviewed by a clinician**, and the front end says so on
  every option, every use row and every page footer. The presentation is
  careful; the data underneath still needs the expert review listed in
  [RECOMMEND_API.md](RECOMMEND_API.md).
- **The three figures in `combination_summary` do not always add up.**
  `pairs_checked` also counts a check against a whole drug class the reader
  named, and a class check that produces nothing is not added to
  `pairs_with_no_finding_not_listed`. So `warnings_listed +
  pairs_with_no_finding_not_listed` can be less than `pairs_checked`. The panel
  prints all three as the API gives them and makes no claim about their sum; a
  test asserts the inequality rather than an equality. Fixing the accounting is
  a backend change.
- **Only Chromium is tested.** The end-to-end suite runs one browser. Nothing in
  the app uses a feature that is Chromium-only, but Safari and Firefox are not
  checked.
- **The condition classifier's scores overstate real performance**, which the
  how-it-works page says in the backend's own words. A reader can misread the
  bars as a measure of how well it will handle their wording.
- **A medicine page's PubMed links are read out of the `source_note` prose**,
  because that is the only place a use row's citation is carried. A note that
  cites a paper without writing "PMID" produces no link; the note itself is
  always shown.
- **Brand names are matched but never printed**, with one exception: a token the
  reader typed themselves is echoed back in the "what you said you take"
  readback, because it is what they wrote.
- **Free deployments sleep.** On the free plan the first request after a quiet
  period finds the API asleep, and the page reports it as not responding until
  it wakes. See [DEPLOY.md](DEPLOY.md).
- **The `web/tests/fixtures/` responses are a snapshot.** They were captured
  from a real backend and the types are checked against them, but re-seeding
  with changed reference files will make them stale. Re-capture by calling each
  endpoint again.
