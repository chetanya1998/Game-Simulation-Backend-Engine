import type { GameModel } from '@gamex/model';
import { MD_HEADER, code, jsonFile, mdTable, snake, type FileMap } from './common.js';

const refId = (ref: string): string => ref.slice(ref.indexOf(':') + 1);

function label(text: string): string {
  return text
    .replace(/[:;"#{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** gamex/state-machine.json and gamex/STATE_MACHINE.md (with a Mermaid diagram). */
export function renderStateMachine(model: GameModel, files: FileMap): void {
  const sm = model.stateMachine;
  files.set('gamex/state-machine.json', {
    ownership: 'generated',
    content: jsonFile({
      initial: refId(sm.initial),
      states: sm.states.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        kind: s.kind,
        duration: s.duration,
      })),
      transitions: sm.transitions.map((t) => ({
        id: t.id,
        from: refId(t.from),
        to: t.to === 'return' ? 'return' : refId(t.to),
        trigger: t.trigger === 'ui' || t.trigger === 'auto' ? t.trigger : refId(t.trigger),
        outcome: t.outcome,
        guard: t.guard,
        beginsMission: t.beginsMission,
        endsMission: t.endsMission,
      })),
    }),
  });

  const callers = new Map<string, Set<string>>();
  for (const t of sm.transitions) {
    if (t.to === 'return') continue;
    const target = sm.states.find((s) => `state:${s.id}` === t.to);
    if (target?.kind === 'overlay')
      callers.set(target.id, (callers.get(target.id) ?? new Set()).add(refId(t.from)));
  }
  const lines = ['stateDiagram-v2', `  [*] --> ${snake(refId(sm.initial))}`];
  for (const s of sm.states)
    lines.push(`  ${snake(s.id)}: ${label(`${s.code ?? ''} ${s.name ?? s.id}`)}`);
  for (const t of sm.transitions) {
    const trigger = t.trigger === 'ui' || t.trigger === 'auto' ? t.trigger : refId(t.trigger);
    const text = label(
      `${trigger}${t.outcome === undefined ? '' : ` (${t.outcome})`}${t.guard === undefined ? '' : ` if ${t.guard}`}`,
    );
    const targets =
      t.to === 'return' ? [...(callers.get(refId(t.from)) ?? [])].sort() : [refId(t.to)];
    for (const to of targets) lines.push(`  ${snake(refId(t.from))} --> ${snake(to)}: ${text}`);
  }
  const rows = sm.transitions.map((t) => [
    t.id,
    refId(t.from),
    t.to === 'return' ? '(return)' : refId(t.to),
    t.trigger === 'ui' || t.trigger === 'auto' ? t.trigger : refId(t.trigger),
    t.outcome ?? '',
    t.guard === undefined ? '' : code(t.guard),
    [t.beginsMission === true ? 'begins mission' : '', t.endsMission === true ? 'ends mission' : '']
      .filter(Boolean)
      .join(', '),
  ]);
  files.set('gamex/STATE_MACHINE.md', {
    ownership: 'generated',
    content: `${MD_HEADER}

# Screen flow — ${model.meta.name}

${String(sm.states.length)} screens, ${String(sm.transitions.length)} transitions. Start: ${code(refId(sm.initial))}. Machine-readable:
[\`state-machine.json\`](./state-machine.json).

\`\`\`mermaid
${lines.join('\n')}
\`\`\`

## Screens

${mdTable(
  ['Code', 'Id', 'Name', 'Kind'],
  sm.states.map((s) => [s.code ?? '', s.id, s.name ?? '', s.kind]),
)}

## Transitions

Triggers: \`ui\` = player navigation, \`auto\` = taken as soon as the guard holds, otherwise the action that
causes it (with the outcome it follows). \`(return)\` goes back to the screen the overlay was opened from.

${mdTable(['Id', 'From', 'To', 'Trigger', 'Outcome', 'Guard', 'Mission'], rows)}
`,
  });
}
