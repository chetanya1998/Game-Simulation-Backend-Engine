# Fixture: Swarm Rescue

The first end-to-end test case for GameX Engine (master prompt §11).

| Path               | Purpose                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GDD.md`           | GDD-style design document. Undecided numbers are marked **[ASSUMED]**; open questions are in §9.                                               |
| `sample-repo/`     | A tiny "game repo": README, an economy config and a C# tuning class. Tests copy `GDD.md` into a temporary copy of it to exercise `gamex init`. |
| `sample-repo/.env` | **Planted canary** (not a secret). Repo-safety tests assert it is never read or sent to an LLM.                                                |
| `test/`            | Sanity tests that keep the fixture consistent with the master prompt.                                                                          |

Later phases add `swarm-rescue.game-model.json` (Phase 1) and expected outputs under `expected/`.
