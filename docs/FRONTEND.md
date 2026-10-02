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
      brand-mark.tsx         the isometric tile mark
      iso-art.tsx            the isometric tiles: the hero's, and the quiet states'
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
    unit/                    627 unit tests
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

Light is the default. Dark is opt-in through the header toggle, stored in
`localStorage` and applied by a blocking inline script in `<head>` before the
first paint, so there is no flash on load or on a navigation. The system
preference is deliberately not followed — see **Decisions**.

Paper, white and a 1px hairline. The pastels are accents only -- a badge, a
tile, an active state -- and they are fills, never text: anything set on one of
them is set in ink, which is what keeps it at AA. The three evidence colours are
the only ones that are text colours in their own right, and each clears 4.5:1 on
the surface it sits on.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--color-paper` | `#F7F5F0` | `#17123F` | page background |
| `--color-surface` | `#FFFFFF` | `#1D1849` | panels and cards |
| `--color-wash` | `#EFECF7` | `#262059` | quiet fills, chips |
| `--color-ink` | `#251D5C` | `#ECE9FF` | body text, primary buttons |
| `--color-ink-2` | `#5B5484` | `#B6B0DD` | secondary text |
| `--color-line` | `#D7D4DE` | `#373159` | hairline rules, ink at 15% |
| `--color-on-ink` | `#F7F5F0` | `#17123F` | type on an ink or verified fill |
| `--color-primary` | `#605EA7` | `#A7A4E6` | links, focus, hover |
| `--color-accent-teal` | `#11C8D5` | `#11C8D5` | tile fills |
| `--color-accent-pink` | `#FC79A4` | `#FC79A4` | tile fills |
| `--color-accent-sage` | `#C6CDAA` | `#C6CDAA` | tile fills |
| `--color-ring` | `#A499FF` | `#A499FF` | focus halo |
| `--color-herb` | `#5A6B34` | `#C0D184` | Ayurvedic |
| `--color-drug` | `#0A6D75` | `#67DBE4` | allopathic |
| `--color-verified` | `#A8143F` | `#FF9EBB` | literature-verified |
| `--color-mechanism` | `#8A5410` | `#E9B55E` | mechanism-based |
| `--color-insufficient` | `#5C5A7A` | `#A9A4C4` | insufficient evidence |

Selection is `#A499FF` on `#211C4D` in both themes.

Type: one family. IBM Plex Sans at 400 for body, 500 for labels and table
headings, 600 for headings; IBM Plex Mono for PMIDs and identifiers and nothing
else. There is no display cut and no display weight: a reference tool is read
rather than announced. Headings set at `-0.015em` and a leading of 1.15; `h1` is
`clamp(2rem, 4.5vw, 3.5rem)`, so 56px at most, and `h2` is 24px rising to 32.
Body is 16px at 1.6, and nothing on a page is smaller than 14px. Only the hero
is centred; every other heading and paragraph is left-aligned.

Shapes: 42px pills for the controls -- buttons, inputs, badges -- and 14px
(`--radius-card`) for panels and cards, because a 42px corner around a block of
text reads as a marketing card rather than as a reference table. 10px
(`--radius-tight`) for a block nested inside one of those. Full-width bands and
the page edges are square.

Separation is a 1px hairline, not a shadow. `panel` and `card-surface` are
white with a rule and no elevation; `heading-rule` puts a rule under a section
heading and `ruled-list` puts one between the rows of a list, which is what
separates the medicine browser, the pipeline stages and the no-finding pairs in
place of a stack of cards. `--shadow-lift` is left for the things that really do
float over the page -- the drawer, the comboboxes -- and `--tile-shadow` for the
isometric tiles, its own token because it has to stay dark in the dark theme,
where the ink token is nearly white.

Layout: one 1440px column (`--container-page`, the `page-shell` utility),
centred, with a 16/32/48px gutter, on an 8px grid. `section-pad` is 48px of
block padding, opening to 64 and then 80 on wider screens; the hairlines do the
separating, so the padding does not have to. Reading columns are capped in
characters (`max-w-[70ch]` and narrower), because a 1440px line of body text is
unreadable.

Motion, all of it switched off under `prefers-reduced-motion`: the home counts
count up once when they scroll into view, the search box glows on focus, results
reveal once, the combination lines draw themselves in as SVG strokes, the
warning drawer slides in from the right over a blurred backdrop, page
transitions fade, the swap button rotates, and the hero's three tiles bob.

## The hero's isometric tiles

The home page leads with the flow the reader came for: "Describe a problem. See
what the literature records.", one line saying what the database is, and two
calls to action -- **Describe a problem** first, **Check a pair** second. Behind
them sit a faint isometric line grid and three pastel tiles. All of it is
decorative. The headline says the whole thing in words and the page reads the
same with every tile removed, which is what the rest of this section is arranged
around.

**They are drawn, not fetched.** `iso-art.tsx` is inline SVG and nothing else:
no image file, no 3D library, no runtime. One slab -- a rhombus top face and two
side faces in a 2:1 projection -- carries five motifs: a herb leaf, a capsule, a
cited paper, a caution shield and a confidence flag, one for each thing this
database actually holds. Three of them float in the hero; the others mark the
404, the error and the empty states. The side faces are the same pastel darkened
by an ink overlay rather than by a second set of colour values, so a tile cannot
drift away from the palette, and the motifs are projected onto the top face by
`matrix(1, .5, -1, .5, 0, 0)`, which is exactly the transform that maps the
square they are drawn in onto that rhombus.

**The grid is the floor they stand on.** Two families of lines at thirty
degrees, drawn at seven per cent and masked by a radial gradient so they fade
out well before the edges of the hero. At that weight it reads as paper rather
than as something to look at.

**They are in the first response.** The tiles are server-rendered markup, so the
hero is composed in the first paint and there is nothing to wait for, nothing to
fail, and no state where the hero is half-drawn. An end-to-end test loads the
page with every script chunk blocked and asserts the hero is still composed.

**They are `aria-hidden` and take no pointer events.** The field sits behind the
headline on its own layer, and a test clicks the hero's own call to action
through it.

**Motion is given up readily.** Each tile bobs on its own period and phase. Both
ends of the keyframe are the resting position and the drift is at the midpoint,
so when `prefers-reduced-motion` collapses the duration -- which the one rule at
the bottom of `globals.css` does for every animation in the app -- the tile
lands where it belongs rather than stopping mid-air. An end-to-end test captures
the field twice, a second and a half apart, and requires the two to be
byte-identical.

**The hero is one screen.** `--nav-h` in `globals.css` is the header's own
height and the hero is `min(calc(100svh - var(--nav-h)), 42rem)`, so the
headline and both buttons are above the fold without scrolling; the headline
size, the hero's padding and the tile offsets are all `clamp`ed off the
viewport, so a short laptop screen gives up whitespace and headline size rather
than a call to action. The 42rem cap is the other half of it: on a tall screen a
full viewport of hero is mostly empty canvas, and the cap lets the first figures
show below it. A test asserts the fit at 1366x768, 1440x900 and 1536x864. `svh`
rather than `vh` so a mobile browser's retracting toolbar cannot crop it.

**What it costs.** About 3 KB of markup, no JavaScript and no network request.

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
npm test              # 627 unit tests (Vitest)
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
| The hero is drawn in SVG, not in WebGL | It replaced a three.js and Theatre.js scene. The scene cost about 277 KB gzipped, more than the rest of this app's JavaScript put together, for one decorative element that had to be built twice over -- once flat for the first paint and the fallbacks, once in 3D -- and a marquee hero wants pastel shapes in the margins rather than one lit object in the middle. The tiles are markup, cost nothing and cannot fail. |
| The hero's tiles are the only looping animation in the app | `globals.css` says every other animation runs once, in response to something the reader did. This is a deliberate exception for three decorative elements: it is off under `prefers-reduced-motion` and the page is complete without it. |
| Results, the browse list and the pipeline are ruled rows, not cards | A card per row turns a 53-row catalogue into 53 boxes and buries the one column a reader is scanning. A hairline between rows and columns that line up is what a reference tool looks like, and it fits far more on a screen. Cards are kept where a row really is a record with its own fields: an option, a documented interaction, a recorded use. |
| The safety line stays on the home figures, and nowhere else | Everything else around those four numbers was cut, but "most searched pairs turned up nothing" is not a description of the UI -- without it, four figures read as a claim that the remaining pairs are fine. The rest of the disclaimer is in the footer, once per page. |
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
