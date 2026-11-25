# GameX Engine

Turn a game idea into a buildable, testable, repo-native spec.

GameX Engine reads a game design document (and, optionally, your game repo), turns it into one canonical
**Game Model**, lets you review every detected item, explores outcomes with deterministic simulation
(reachability, Monte Carlo players, parameter sweeps, sensitivity, exploit search), and writes a **Spec Pack**
into your repo — `AGENTS.md`, balance files, formulas, backend contracts, golden tests and build tasks — so
coding agents can build the backend straight from it.

> Status: Phases 0–4 done (model, engine, Spec Pack + CLI, ingestion & extraction). See [`docs/PLAN.md`](docs/PLAN.md).

## Quick start (development)

```bash
corepack enable
```

```bash
pnpm install
```

```bash
pnpm check
```

```bash
node packages/cli/dist/gamex.js doctor
```

Write a Spec Pack into a game repo that has `gamex/game-model.json`:

```bash
node packages/cli/dist/gamex.js sync --cwd path/to/game-repo
```

Or start from a design document and code: GameX lists the files it would send, asks for
confirmation, extracts a candidate model with Claude, lets you review it, and writes the Spec Pack:

```bash
ANTHROPIC_API_KEY=… node packages/cli/dist/gamex.js init --cwd path/to/game-repo
```

No API key? Use `--provider agent` to answer the extraction requests with your own agent session.

Requires Node ≥ 22.18.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — for designers and engineers
- [Phase plan](docs/PLAN.md)
- [Decisions (ADRs)](docs/DECISIONS/)
- [Agent instructions](AGENTS.md)

## License

[Apache-2.0](LICENSE)
