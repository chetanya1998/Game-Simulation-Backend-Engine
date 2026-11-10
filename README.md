# GameX Engine

Turn a game idea into a buildable, testable, repo-native spec.

GameX Engine reads a game design document (and, optionally, your game repo), turns it into one canonical
**Game Model**, lets you review every detected item, explores outcomes with deterministic simulation
(reachability, Monte Carlo players, parameter sweeps, sensitivity, exploit search), and writes a **Spec Pack**
into your repo — `AGENTS.md`, balance files, formulas, backend contracts, golden tests and build tasks — so
coding agents can build the backend straight from it.

> Status: early development (Phase 0 — foundation). See [`docs/PLAN.md`](docs/PLAN.md).

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

Requires Node ≥ 22.18.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — for designers and engineers
- [Phase plan](docs/PLAN.md)
- [Decisions (ADRs)](docs/DECISIONS/)
- [Agent instructions](AGENTS.md)

## License

[Apache-2.0](LICENSE)
