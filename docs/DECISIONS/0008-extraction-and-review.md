# ADR 0008 — Ingestion, extraction and review

- Status: Accepted (Phase 4). The review ledger format (§8) is written into users' repos: confirm before 1.0.
- Date: 2026-11-25

## Context

ARCHITECTURE §5 describes ingestion, LLM extraction and review in outline. This ADR records what
was built, including where it departs from that outline and why.

## Decisions

### Ingestion (`@gamex/ingest`)

1. **One reader.** `SafeFileSystem` is the only way target-repo files are read. It applies these
   checks in order: path inside the root, never following symlinks (they are listed as excluded),
   skipped folders (`.git node_modules Library Temp obj bin build dist .gradle .idea .vscode gamex …`),
   the hard deny-list, `.gitignore`/`.gamexignore` in every directory, the extension allowlist, and the
   size cap (256 KB). `readText` adds a content scan for secrets: private-key headers; AWS, Anthropic,
   OpenAI-style, GitHub, Slack, Google and Stripe keys; JWTs; and assignments such as `token = "…"`
   whose value is ≥ 20 characters with Shannon entropy ≥ 3.5 bits per character. A file with a
   suspected secret is excluded as a whole.
2. **Discovery** classifies files as `design` (README, GDD/design/spec names, `docs/`), `config`
   (balance/economy/… names, config folders) or `code` (tuning/config names, or ≥ 5 numeric constants).
   `--include <path>` adds a file but never bypasses a safety rule.
3. **The plan is the contract.** `gamex ingest` prints every file that would be sent, with its size and
   the reason, and every excluded file, with the reason. It needs `--yes` or an interactive "y". The
   confirmed plan (`gamex/.work/ingest.json`) stores each file's SHA-256. `extract` re-runs discovery
   and refuses (`INPUTS_CHANGED`, exit 1) if a confirmed file changed or is no longer safe to read.
   `readChunks` checks each file's hash again as it reads, so only the confirmed bytes are ever sent.
4. **Chunks** carry stable ids: `path#Lstart-end`, or `path#pN` for PDF pages. Markdown is split per
   level-2 section and keeps its heading path. Other files are split into line windows. Provenance
   locations name the nearest numbered heading (`§7.2 / line 150`).

### Extraction (`@gamex/extract`)

5. **Four passes per batch** (the outline's passes A–D): `inventory` (meta, entities, resources,
   constants, variables), `flow` (states, transitions, actions), `monetization` (placements, rules,
   trace invariants, forbidden states) and `gaps`. Later passes receive a "known items" list (ids,
   keys, values) built from the earlier answers, so references line up.
   - The pass schemas are **not** the Game Model schema. They are flat and strict, use nullable fields
     instead of optional ones, arrays of `{name, ref}` instead of records, and no recursion. This makes
     them valid structured-output schemas and easy for any agent to fill in.
   - Not extracted: personas, KPIs and economy flows (generated deterministically, below), aggregate
     invariants, and Level 2 combat blocks (still hand-modelled).
6. **Providers** sit behind `LlmProvider.complete(request, zodSchema)`:
   - `AnthropicProvider` (`@anthropic-ai/sdk`):
     - streaming with `finalMessage()`;
     - structured outputs via `output_config.format = betaZodOutputFormat(schema)`;
     - `effort` defaults to `high`;
     - the documents block is marked `cache_control: ephemeral`, so it is cached and reused by all four
       passes;
     - **server-side fallbacks are on by default** (`fallbacks: 'default'`, beta
       `server-side-fallback-2026-07-01`), so an overloaded model does not fail a run;
     - refusals and `max_tokens` stops become `LlmError`.
   - The model is the user's choice: `--model`, then `GAMEX_MODEL`, then `gamex/config.json`, then
     `claude-opus-5-5`.
   - `AgentHandoffProvider` writes self-contained requests (system prompt, documents, instructions and
     JSON Schema) to `gamex/.work/handoff/requests/`. It reads answers from `responses/` and re-asks
     when a request's content hash changes. No API key is needed.
   - `RecordedProvider` replays recordings keyed by request id. It refuses a recording whose request
     hash no longer matches, and it captures every request so tests can assert on exactly what would
     have been sent.
   - `RecordingProvider` saves validated answers from a live run.
7. **Retries:** every answer is Zod-validated. An invalid answer is re-asked up to twice, with the
   validation errors fed back. After that the run fails with `LlmError` (exit 3). The outline said
   "surface as a gap rather than fail", but a pass that returns nothing would leave a hollow model that
   looks complete, so a hard failure is the honest outcome.

### Assembly: the LLM proposes, deterministic code decides

8. **Provenance is attached by our code.** Each proposal cites a chunk id and a verbatim quote.
   `verifyEvidence` looks for the quote in that chunk, then in other chunks of the same file: first
   exactly, then after normalizing markdown emphasis, table pipes, quotes, whitespace and case.
   - The provenance points at the real source line, and its excerpt is that source line, not the
     LLM's text.
   - Confidence: `high` for an exact match, `medium` for a fuzzy one, `low` when the quote is not found.
   - For constants, the number must appear in the cited line (digits, separators, percentages, number
     words). Otherwise confidence drops one level and the item is listed for checking.
   - Items with no evidence become `assumed` with `source: "gamex:assumed"`.
9. **Merge:**
   - Ids are normalized to kebab-case, and changed ids are reported as aliases. Proposals with the same
     id are merged.
   - Transitions and placements that share an id but differ in from/to/trigger (or format/trigger) get
     suffixed ids (`continue-2`).
   - For constants, **config and code values beat design-document values**. Differing values are kept
     in `provenance.alternatives`, reported as conflicts, and raised as `contradiction` gaps. These are
     the drift candidates for Phase 6.
   - There is no fuzzy name matching, because false merges are worse than duplicates the reviewer can
     reject.
10. **Defaults** are generated with fixed rules:
    - three personas, `assumed`;
    - KPIs: per resource, progression, per ad format, per IAP;
    - a source → wallet → sink flow per resource.
11. **Repair by removal:** the candidate is validated, and every error removes the smallest thing that
    makes it valid.
    - A dangling reference inside a list of references is removed from that list; anything else removes
      its node. This repeats until no errors remain.
    - Nothing is "fixed" by guessing. For example, a placement in a forbidden state is removed, not
      moved.
    - Every removal is listed in a gap.
12. **Gaps by fixed rules:**
    - conflicting sources;
    - removed proposals;
    - unverified evidence;
    - default personas;
    - missing revenue assumptions;
    - every assumed item that no other gap covers.

    These come on top of the gaps the LLM reports.

### Review

13. **Ledger** `gamex/review.json` (committed):

    ```json
    {
      "version": 1,
      "default": "approve",
      "decisions": [{ "ref": "placement:rewarded-revive", "decision": "approve", "hash": "…" }]
    }
    ```

    - Decisions are `approve`, `reject`, `assume` or `edit` (`set`: fields to replace, `null` removes
      a field; `id` and `provenance` cannot change).
    - `default` covers items with no decision. `"pending"` leaves them out.
    - `hash` (optional) is the item's content hash without its status. If the item changes after
      re-extraction, the decision no longer applies and the item is asked about again. Interactive
      review always records it; hand-written decision files may leave it out.
    - The outline's `$EDITOR` edit is replaced by `set` in the ledger, which agents and CI can write.

14. **Promote:**
    - approved items become `confirmed`, but assumed items stay `assumed` (approving a placeholder does
      not make it a decision);
    - `assume` marks an item assumed;
    - `edit` marks it `edited`;
    - rejected and undecided items are left out, and so is anything that then dangles (reported as
      `cascaded`);
    - `gamex/game-model.json` is written only when the result is valid; `modelVersion` goes up when the
      content hash changes.
15. **Working files** live in `gamex/.work/`, which gets its own `.gitignore` (`*`). The Spec Pack's
    generated `gamex/.gitignore` is never created early, so `sync` does not see a conflict.

## Consequences

- With the authored Swarm Rescue recordings, `gamex init --yes --decisions accept-all.json` on the
  sample repo gives a model that validates with zero errors and zero warnings, and a Spec Pack with
  63 golden cases, all passing in the reference runner. This matches the hand-written model.
- The committed recordings are **authored stand-ins** for LLM answers, derived from the hand-written
  model (`"origin": "authored"`). They test the deterministic pipeline offline; they say nothing about
  extraction quality. The opt-in live test (`GAMEX_LIVE=1`) and
  `pnpm --filter @gamex/fixtures record --live` measure the real thing.
