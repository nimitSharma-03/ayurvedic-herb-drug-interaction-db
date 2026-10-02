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
      brand-mark.tsx         the capsule mark
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
    unit/                    621 unit tests
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

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--color-paper` | `#F5F8F6` | `#0E1915` | page background |
| `--color-surface` | `#FFFFFF` | `#15231E` | panels and cards |
| `--color-wash` | `#E3F0E9` | `#1A2D26` | quiet fills, chips |
| `--color-ink` | `#14231E` | `#E4EEE9` | body text |
| `--color-ink-2` | `#4B5C55` | `#A6B6AF` | secondary text |
| `--color-line` | `#D7E2DC` | `#25382F` | hairline borders |
| `--color-herb` | `#1D684C` | `#6CC69E` | Ayurvedic |
| `--color-drug` | `#2E4A8A` | `#A0B4EC` | allopathic |
| `--color-verified` | `#B42318` | `#F28B80` | literature-verified |
| `--color-mechanism` | `#9A5800` | `#E9B55E` | mechanism-based |
| `--color-insufficient` | `#5D6A65` | `#9CA9A3` | insufficient evidence |

Type: Lora 600 for headings and medicine names, Source Sans 3 for body, IBM Plex
Mono for PMIDs and nothing else. Shapes: panels 22px, cards 14–16px, inputs
13px, pills fully rounded, one soft shadow, 1px hairlines.

Motion, all of it switched off under `prefers-reduced-motion`: the home counts
count up once when they scroll into view, the search box glows on focus, results
reveal once, the combination lines draw themselves in as SVG strokes, the
warning drawer slides in from the right over a blurred backdrop, page
transitions fade, and the swap button rotates.

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
npm test              # 621 unit tests (Vitest)
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
