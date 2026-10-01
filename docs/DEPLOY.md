# Deploying on Render

Two services: the API (Python) and the web front end (Node). The API has to
exist first, because the web service needs its URL; then the API has to be told
the web service's URL, because a browser will not let one talk to the other
without it. That circle is the only awkward part, and it is broken by setting
one variable after both services exist.

Nothing here provisions a database. The API builds its own SQLite read model
during the build, from the CSV and JSON files already in this repository.

Everything below can also be done in one step with the blueprint
([../render.yaml](../render.yaml)); that route is at the end.

## Before you start

- The repository is on GitHub (or GitLab), and the branch you want to deploy is
  pushed.
- `python -m unittest discover -s tests` passes locally.
- You have a Render account, with the repository connected to it.

## 1. Create the API service

1. Go to **https://dashboard.render.com** and sign in.
2. Click **+ New** (top right) → **Web Service**.
3. Under **Git Provider**, pick this repository. Click **Connect**.
4. Fill in the form:
   - **Name**: `hdi-api`
   - **Language**: `Python 3`
   - **Branch**: `main`
   - **Region**: whichever is closest to your readers (`Singapore` for India)
   - **Root Directory**: leave empty
   - **Build Command**:
     ```
     pip install -r requirements.txt && python -m hdi.seed
     ```
   - **Start Command**:
     ```
     python -m hdi.api
     ```
   - **Instance Type**: `Free`
5. Expand **Advanced**.
   - **Health Check Path**: `/health`
   - Click **Add Environment Variable** twice and add:

     | Key | Value |
     |---|---|
     | `PYTHON_VERSION` | `3.11.9` |
     | `HOST` | `0.0.0.0` |

     Do **not** set `PORT`. Render assigns it and `hdi/api.py` reads it from the
     environment. Setting it yourself makes the service unreachable.

     Leave `ALLOWED_ORIGINS` out for now — step 3 adds it.
6. Click **Deploy Web Service**.
7. Wait for the log to end with `Serving on http://0.0.0.0:<port>` and the
   status to turn **Live**. The build runs `python -m hdi.seed`, which prints
   the row counts it wrote; if it fails, the problem is in the reference files,
   not in Render.
8. Copy the service URL from the top of the page. It looks like
   `https://hdi-api.onrender.com`. Open `https://hdi-api.onrender.com/health` in
   a tab — it should return `{"status": "ok", ...}` with the row counts.

## 2. Create the web service

1. **+ New** → **Web Service**, and pick the same repository again.
2. Fill in the form:
   - **Name**: `hdi-web`
   - **Language**: `Node`
   - **Branch**: `main`
   - **Region**: the same one as the API
   - **Root Directory**: `web`
   - **Build Command**:
     ```
     npm ci && npm run build
     ```
   - **Start Command**:
     ```
     npm run start
     ```
   - **Instance Type**: `Free`
3. Expand **Advanced** and add:

   | Key | Value |
   |---|---|
   | `NODE_VERSION` | `22` |
   | `NEXT_PUBLIC_API_URL` | the API URL from step 1.8, with no trailing slash |

   `NEXT_PUBLIC_API_URL` is read in the browser as well as on the server, so it
   must be the API's public URL. An internal hostname will render the pages but
   leave every search and every lookup failing.

   It is also baked into the build, so changing it later needs a redeploy, not
   just a restart.
4. Click **Deploy Web Service**.
5. Wait for **Live** and copy the web URL, something like
   `https://hdi-web.onrender.com`.

## 3. Let the browser talk to the API

The pages render, but the search box, "describe a problem" and "check two
medicines" all call the API from the reader's browser. Until the API allows the
web service's origin, those calls are blocked by the browser and the page
reports that the database server is not responding.

1. Open the **hdi-api** service → **Environment** in the left sidebar.
2. Click **Add Environment Variable**:

   | Key | Value |
   |---|---|
   | `ALLOWED_ORIGINS` | the web URL from step 2.5, with no trailing slash |

   For example `https://hdi-web.onrender.com`. Several origins can be given,
   comma-separated, with no spaces needed:
   `https://hdi-web.onrender.com,https://www.example.com`.

   Do not set it to `*` unless you mean it. The API serves nothing per-user, so
   a wildcard is not a security hole here, but it also makes the allow-list
   pointless.
3. Click **Save, rebuild, and deploy** and wait for **Live** again.

## 4. Check it

Open the web URL and confirm:

- The home page shows four counts under "From papers to answers". If they are
  missing, the server cannot reach the API: check `NEXT_PUBLIC_API_URL`.
- Typing `Indian Ginseng` in the search box returns Ashwagandha, with "matched
  Indian Ginseng" beside it. If nothing happens, the browser is being blocked:
  check `ALLOWED_ORIGINS` on the API.
- **Describe a problem** → "my sugar is high" → **Show options** returns two
  columns and a "combinations to avoid" panel.
- **How it works** shows the classifier scores and the per-class bars.

## Environment variables, in one table

| Service | Key | Value | Why |
|---|---|---|---|
| hdi-api | `PYTHON_VERSION` | `3.11.9` | The version the project is tested on. |
| hdi-api | `HOST` | `0.0.0.0` | Listen on every interface so the platform can reach it. |
| hdi-api | `PORT` | *(set by Render — do not add it)* | The assigned port. |
| hdi-api | `ALLOWED_ORIGINS` | the web service's URL | Which browser origins may call the API. |
| hdi-web | `NODE_VERSION` | `22` | The version the project is built with. |
| hdi-web | `NEXT_PUBLIC_API_URL` | the API service's URL | Where both the server and the browser find the API. |

Neither service needs an API key. The backend uses none on the request path
(`docs/BACKEND_API.md`), and nothing in the front end sends one.

## Free services sleep

Both services are on the free plan, which **spins down after about 15 minutes
without traffic**. The next request wakes the service, which takes roughly 30
seconds to a minute. In that window:

- the first page load is slow;
- if the web service wakes before the API does, the page will say the database
  server is not responding. Reloading after a few seconds fixes it.

Free instances also get a limited number of hours per month across the account.
If this matters, move both services to a paid instance type: the only change is
**Instance Type** on each service, and nothing in the code or the configuration
depends on it.

## The blueprint route

[../render.yaml](../render.yaml) declares both services. With it:

1. **+ New** → **Blueprint**.
2. Pick this repository and the branch, then **Connect**.
3. Render reads `render.yaml` and shows both services. It will ask for the three
   variables marked `sync: false`, because their values are URLs that do not
   exist yet:
   - `hdi-api` → `PORT`: leave it blank.
   - `hdi-api` → `ALLOWED_ORIGINS`: leave it blank for now.
   - `hdi-web` → `NEXT_PUBLIC_API_URL`: leave it blank for now.
4. **Apply**. Both services build.
5. When both are live, set `NEXT_PUBLIC_API_URL` on `hdi-web` to the API's URL
   and `ALLOWED_ORIGINS` on `hdi-api` to the web service's URL, then redeploy
   both. This is the same circle as step 3 above; the blueprint saves the form
   filling, not the one manual step.

## If something is wrong

| What you see | What it is |
|---|---|
| Build fails on `python -m hdi.seed` | A reference file is invalid. Run `python -m hdi.validate_reference` locally. |
| API is live but `/health` 404s | The start command is wrong; it must be `python -m hdi.api`. |
| API never becomes live | `HOST` is not `0.0.0.0`, or `PORT` was set by hand. |
| Pages render with no counts | The web server cannot reach the API. Check `NEXT_PUBLIC_API_URL` and that the API is awake. |
| Pages render but search does nothing | `ALLOWED_ORIGINS` on the API does not include the web URL. |
| Everything is slow on the first visit | A free service waking up. |
| `/stats` has `classifier: null` | `ml/reports/metrics.json` is missing from the deployed commit. Run `python ml/evaluate.py` and commit it. |
