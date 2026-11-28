# ADR 0009 — Studio: local server, API, worker pool

- Status: Accepted (Phase 5). `gamex/sources/` was confirmed by the maintainer (it is written into users' repos).
- Date: 2026-11-28

## Context

ADR 0002 §5 chose a localhost server (per-launch token; it serves the UI, reads and writes the repo
safely, and makes AI calls server-side) plus a static offline build. ARCHITECTURE §9 lists the stack.
This ADR records how both were built.

## Decisions

### `gamex studio` (packages/cli/src/studio-server.ts)

1. **Network:**
   - Plain `node:http`, bound to `127.0.0.1` only (any free port, or `--port`).
   - The printed link is `http://127.0.0.1:PORT/#token=…`. The token is 24 random bytes, in the URL
     _fragment_, so it is never sent in a request line or logged.
   - The page moves the token to `sessionStorage`, removes it from the address bar, and sends it as
     `x-gamex-token` on every `/api` call. The server compares it in constant time.
2. **Other sites cannot drive it:**
   - A `Host` other than `127.0.0.1:PORT` or `localhost:PORT` gets 421, which stops DNS rebinding.
   - Any `Origin` other than the server's own gets 403.
   - There is no CORS.
   - Every response carries a strict CSP:
     - scripts, workers and connections from `'self'` only;
     - no inline script;
     - `frame-ancestors 'none'`.
   - Every response also carries `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, COOP and CORP.
   - Request bodies are capped at 4 MB.
3. **Static files:** the server serves the built studio, refuses paths outside its folder, and falls
   back to `index.html`. The CLI bundle ships the studio in `dist/studio/` (copied by tsup after
   `@gamex/studio` builds).
4. **API.** JSON `{ ok, data | error: { code, message, hint } }`.
   - `GET /api/state`
   - `POST /api/upload`
   - `POST /api/ingest/plan`
   - `POST /api/ingest/confirm`
   - `POST /api/extract`
   - `POST /api/review`
   - `PUT /api/model`
   - `POST /api/specpack/preview`
   - `POST /api/specpack/write`

   Writing operations run one at a time (409 `BUSY` otherwise). The server reuses the CLI's step
   functions (`discoverPlan`, `savePlan`, `extractStep`, `applyLedger`, `writeModelFile`, `syncPack`),
   so the studio and the CLI cannot drift apart.

5. **Uploads go to `gamex/sources/<name>`** (maintainer's choice):
   - names must be plain and end in `.md .markdown .txt .pdf .json .yaml .yml .toml`;
   - files are created only, never overwritten (409);
   - files are capped at 256 KB;
   - files are refused if the deny-list or path policy would refuse them, or if the text scan finds a
     secret;
   - files are never written through a symlinked folder.

   Discovery still skips `gamex/`, except `gamex/sources/`, which it walks (never through a symlink).
   Files there are design or config inputs, cited in provenance as `gamex/sources/GDD.md §7.2 / line 150`.

6. **Confirmation is exact:**
   - `POST /api/ingest/confirm` carries the list the user saw, as path + SHA-256 pairs.
   - It succeeds only if that equals the current plan; otherwise 409 `PLAN_CHANGED`.
   - Extraction then re-checks the hashes, as `gamex extract` does (ADR 0008).

### The studio app (apps/studio)

7. **Two modes, one bundle.** With a token, the studio is in server mode. Without one (a static host,
   or a file server), it is in static mode:
   - import a `game-model.json`, explore, simulate, export it;
   - download the Spec Pack as a zip (fflate; `AGENTS.md` holds just the GameX section);
   - Review and extraction are disabled.
     Asset URLs are relative (`base: './'`), so the build works from any folder.
8. **Worker pool (Comlink):**
   - up to 4 module workers;
   - a run is split into `2 × workers` player ranges (`playerRange`); the results are merged with
     `aggregateResults`;
   - every player has its own seeded stream, so the **outputHash equals `gamex sim`'s** for the same
     model, seed, days, players and params (tested in unit tests for 1, 3 and 7 chunks, and in the E2E
     test against the built CLI);
   - exploration, sensitivity, reachability and the Spec Pack renderer also run in workers.
9. **Variants A and B** are override sets (`params` by constant key), simulated against the same
   model. Equal seeds mean common random numbers, so a difference between A and B comes from the
   parameters alone. "Save variant" writes the overrides into the model (`PUT /api/model`, status
   `edited`, modelVersion + 1). The Spec Pack is always generated from the saved model.
10. **The review ledger in the browser** mirrors `@gamex/extract`'s format and `itemHash`, because the
    browser may not import that package (depcruise rule). A unit test asserts that the hashes are
    identical.
11. **Stack:**
    - React 19 and Zustand.
    - React Flow with ELK (layered layout) for the entity map, economy and state machine. Screens and
      transitions with reachability problems are outlined.
    - ECharts (SVG renderer, tree-shaken) with Okabe–Ito colours.
    - Themes: CSS variables on `:root[data-theme]`; the setting follows the system until the user
      toggles it, and the choice is kept in `localStorage`.
    - KPI deltas show direction only (▲/▼), not good/bad colours, because whether a change is good
      depends on the KPI.
    - No web fonts, CDNs or analytics.

### Tests

12. **`pnpm --filter @gamex/studio test:e2e`** runs Playwright against the built CLI and studio, after
    `pnpm build`:
    - **The full flow without the CLI**, starting from the sample repo without its GDD: upload the GDD
      → scan → confirm → extract (recorded answers) → approve all → save → graphs → move the
      `interstitialMinGapSeconds` slider on B → run A and B → compare → save B → preview → write the
      Spec Pack → the golden runner passes. The A and B hashes are compared with `gamex sim` (B with
      `--param`).
    - **Themes:** every view in light and dark, with contrast checks (text ≥ 7:1 on page and panel,
      muted text ≥ 4.5:1) and the manual toggle. Screenshots go to `apps/studio/e2e-output/`, which CI
      uploads as an artifact.
    - **Static build:** served by a plain file server; import the Swarm model → run (hash equals the
      CLI's) → preview → download the zip and check its contents.
    - **Offline:** every test blocks all requests not addressed to the studio's own origin and asserts
      that none were attempted; console errors fail the test.

    The screenshots are inspected, not compared pixel by pixel: font rendering differs between
    machines, and pixel baselines would make CI flaky for no gain.

## Consequences

- Extraction is the only step that leaves the machine, and it runs in the server process, never in the
  browser.
- A user can go from a GDD to a written Spec Pack in the browser alone (Phase 5 acceptance).
