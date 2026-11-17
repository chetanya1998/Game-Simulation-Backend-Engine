import type { FileMap } from './common.js';
import { GENERATED_HEADER } from './common.js';

const skill = (name: string, description: string, body: string): string => `---
name: ${name}
description: ${description}
---

<!-- ${GENERATED_HEADER} -->

${body}
`;

/** Portable SKILL.md files for coding agents working in the game repo. */
export function renderSkills(files: FileMap): void {
  files.set('gamex/skills/gamex-change-balance/SKILL.md', {
    ownership: 'generated',
    content: skill(
      'gamex-change-balance',
      'Change a tunable (reward, cost, limit, cooldown, curve) of the game economy safely. Use when asked to rebalance or change any economy number.',
      `# Change balance

1. Find the constant in \`gamex/game-model.json\` (\`constants\`, by id) — never edit \`gamex/balance/*.json\`.
2. Change \`value\` (stay inside \`min\`/\`max\`, or widen them deliberately) and set \`provenance.status\` to \`edited\`.
3. Run \`gamex validate\` and fix every error it reports (file, line and a hint are given).
4. Run \`gamex sim\` and compare KPIs and invariants with \`gamex/reports/latest-sim.md\`.
5. Run \`gamex sync\` to regenerate the Spec Pack, then review the diff (balance, goldens, report).
6. If a golden case changes, the rule changed: make sure that was intended and mention it in the PR.`,
    ),
  });
  files.set('gamex/skills/gamex-run-sim/SKILL.md', {
    ownership: 'generated',
    content: skill(
      'gamex-run-sim',
      'Run the deterministic economy simulation and exploration, and read the results. Use to check the effect of a change or answer balance questions.',
      `# Run the simulation

- \`gamex sim --days 7 --players 100 --seed 1\` — Monte Carlo players per persona; same seed ⇒ same result.
- \`gamex sim --param interstitialMinGapSeconds=240\` — try a value without editing the model.
- \`gamex sim --sweep coinsVictoryBase=25,50,100\` — compare several values (common random numbers).
- \`gamex explore\` — unreachable screens, dead ends, never-true conditions, reward loops, ad safety.
- Add \`--json\` for machine-readable output.

Read invariant results first (any \`fail\` is a broken rule), then KPIs and findings. Results come from
assumed personas; they compare designs, they do not predict real players.`,
    ),
  });
  files.set('gamex/skills/gamex-implement-task/SKILL.md', {
    ownership: 'generated',
    content: skill(
      'gamex-implement-task',
      'Implement one backend task from gamex/tasks/ until its golden cases pass. Use when asked to build part of the game backend.',
      `# Implement a task

1. Open the task in \`gamex/tasks/\` (they are ordered; do earlier ones first). Read only the inputs it lists.
2. Implement against \`gamex/backend/openapi.yaml\` and \`gamex/backend/RULES.md\`; read every number from
   \`gamex/balance/*.json\`.
3. Write an adapter for the golden runner (see \`gamex/tests/README.md\`) and run
   \`node gamex/tests/runner/run-golden.ts\` — the task is done when its listed cases pass.
4. Never change golden files or generated files to make tests pass; if a rule seems wrong, change the Game
   Model through \`gamex\` and discuss it.`,
    ),
  });
}
