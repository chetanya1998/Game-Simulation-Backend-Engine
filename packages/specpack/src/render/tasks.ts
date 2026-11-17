import type { CompiledModel } from '@gamex/engine';
import type { GoldenFile } from '../golden/schema.js';
import { MD_HEADER, code, editable, type FileMap } from './common.js';
import { isRewarded } from './model-facts.js';

interface Task {
  readonly slug: string;
  readonly title: string;
  readonly goal: string;
  readonly inputs: readonly string[];
  readonly goldens: readonly string[];
  readonly outOfScope: readonly string[];
}

/** gamex/tasks/NNN-*.md — ordered build tasks for coding agents, each done when its golden cases pass. */
export function renderTasks(
  c: CompiledModel,
  goldens: readonly GoldenFile[],
  files: FileMap,
): void {
  const casesOf = (subject: string): string[] =>
    goldens.find((g) => g.subject === subject)?.cases.map((x) => x.id) ?? [];
  const costCases = goldens.flatMap((g) =>
    g.cases.filter((x) => x.rule.includes('#cost-')).map((x) => x.id),
  );
  const actions = [...c.actions.values()];
  const tasks: Task[] = [
    {
      slug: 'wallet-and-ledger',
      title: 'Wallet and ledger',
      goal: `Store each player's ${[...c.resources.values()].map((r) => r.id).join(', ')} balance and record every change in an append-only ledger.`,
      inputs: [
        'backend/data-model.sql (wallet, ledger, idempotency_keys)',
        'balance/*.json',
        'backend/RULES.md',
      ],
      goldens: costCases,
      outOfScope: ['Individual actions (later tasks)', 'Analytics'],
    },
    {
      slug: 'player-state',
      title: 'Player state and counters',
      goal: 'Store progress, mission/session/day state and the generated counters; reset them by scope; serve GET /players/{playerId}/state.',
      inputs: [
        'backend/data-model.sql (player_state, mission_state, session_state, day_state)',
        'backend/openapi.yaml (getPlayerState)',
        'state-machine.json',
      ],
      goldens: [],
      outOfScope: ['Screen rendering (client)'],
    },
  ];
  if (actions.some(isRewarded)) {
    tasks.push({
      slug: 'rewarded-ad-verification',
      title: 'Rewarded ad verification',
      goal: 'Accept rewarded-video completions only through server-side verification callbacks; each token once.',
      inputs: [
        'backend/RULES.md (Ads and purchases)',
        'backend/data-model.sql (ad_claims)',
        'backend/openapi.yaml (AdVerification)',
      ],
      goldens: actions.filter(isRewarded).flatMap((a) => casesOf(`action:${a.id}`).slice(0, 1)),
      outOfScope: ['Choosing a mediation network'],
    });
  }
  for (const a of actions) {
    tasks.push({
      slug: a.id,
      title: `Action ${a.id}`,
      goal: `Implement POST /players/{playerId}/actions/${a.id} exactly as described in backend/RULES.md.`,
      inputs: [
        `backend/RULES.md (${a.id})`,
        `backend/openapi.yaml (${a.id})`,
        'formulas/FORMULAS.md',
        'balance/*.json',
      ],
      goldens: casesOf(`action:${a.id}`),
      outOfScope: ['Other actions', 'Client UI'],
    });
  }
  const placementGoldens = [...c.placements.values()]
    .filter((p) => p.triggerState !== undefined)
    .flatMap((p) => casesOf(`placement:${p.id}`));
  if (placementGoldens.length > 0) {
    tasks.push({
      slug: 'ad-pacing',
      title: 'Ad pacing and eligibility',
      goal: 'Serve GET /players/{playerId}/placements/{id}/eligibility so the client only shows ads the rules allow, and count impressions.',
      inputs: [
        'backend/RULES.md (Ads and purchases)',
        'backend/openapi.yaml (eligibility)',
        'state-machine.json',
      ],
      goldens: placementGoldens,
      outOfScope: ['Ad SDK integration in the client'],
    });
  }
  tasks.forEach((t, i) => {
    const n = String(i + 1).padStart(3, '0');
    files.set(`gamex/tasks/${n}-${t.slug}.md`, {
      ownership: 'editable',
      content: `${MD_HEADER}

# Task ${n} — ${t.title}

**Goal.** ${t.goal}

**Inputs.**
${t.inputs.map((x) => `- \`gamex/${x.split(' ')[0] ?? ''}\`${x.includes(' ') ? x.slice(x.indexOf(' ')) : ''}`).join('\n')}

**Acceptance.** Done when ${t.goldens.length === 0 ? 'the endpoints in the inputs behave as specified and later tasks can build on them' : `these golden cases pass against your implementation (see \`gamex/tests/README.md\` for the adapter): ${t.goldens.map(code).join(', ')}`}.

**Out of scope.** ${t.outOfScope.join('; ')}.

${editable('notes', '_Notes for this task (kept when GameX regenerates the file)._')}
`,
    });
  });
}
