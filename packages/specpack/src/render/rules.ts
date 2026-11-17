import type { CompiledModel } from '@gamex/engine';
import { MD_HEADER, code, constCase, editable, type FileMap } from './common.js';
import { errorCodesOf, isRewarded, isStore } from './model-facts.js';

/** gamex/backend/RULES.md — server-authoritative rules, with editable narrative sections. */
export function renderRules(c: CompiledModel, files: FileMap): void {
  const m = c.model;
  const sections = [...c.actions.values()].map((a) => {
    const node = m.actions.find((x) => x.id === a.id);
    const lines = [
      `### ${code(a.id)}${node?.name === undefined ? '' : ` — ${node.name}`}`,
      '',
      `Actor: ${a.actor}. Endpoint: \`POST /players/{playerId}/actions/${a.id}\`.`,
      '',
    ];
    lines.push('Checks, in order (the first failure is returned):', '');
    let i = 1;
    for (const p of a.preconditions)
      lines.push(`${String(i++)}. ${code(p.source)} — else ${code(a.errorCode)}`);
    for (const r of a.rules)
      if (r.blocking)
        lines.push(
          `${String(i++)}. ${code(r.expr.source)} (rule ${code(r.id)}) — else ${code(r.errorCode)}`,
        );
    for (const p of a.placements)
      lines.push(
        `${String(i++)}. placement ${code(p.id)} is eligible — else its rule's code or ${code('PLACEMENT_NOT_ELIGIBLE')}`,
      );
    for (const cost of a.costs)
      lines.push(
        `${String(i++)}. has at least ${code(cost.amount.source)} ${cost.resourceId} — else ${code(`INSUFFICIENT_${constCase(cost.resourceId)}`)}`,
      );
    if (i === 1) lines.push('_No checks: always allowed._');
    lines.push('', 'Then, all computed from the state before the action:', '');
    for (const cost of a.costs)
      lines.push(`- spend ${code(cost.amount.source)} ${cost.resourceId}`);
    for (const e of a.effects) lines.push(`- ${e.op} ${code(e.key)}: ${code(e.value.source)}`);
    for (const o of a.outcomes ?? [])
      for (const e of o.effects)
        lines.push(`- if outcome is "${o.id}": ${e.op} ${code(e.key)}: ${code(e.value.source)}`);
    for (const p of a.placements)
      for (const e of [...p.onShow, ...p.reward])
        lines.push(`- (${p.id}) ${e.op} ${code(e.key)}: ${code(e.value.source)}`);
    if (isRewarded(a))
      lines.push(
        '',
        '**Rewarded video:** grant only after server-side verification of the ad network callback; each token once (`ad_claims.verification_token` is unique).',
      );
    if (isStore(a))
      lines.push(
        '',
        '**Purchase:** validate the store receipt server-side; each receipt once (`purchases.receipt_id` is unique).',
      );
    if (a.outcomes !== undefined)
      lines.push(
        '',
        `**Mission result:** the client reports one of ${a.outcomes.map((o) => code(o.id)).join(', ')}; the server applies only the effects of that outcome.`,
      );
    lines.push(
      '',
      `Error codes: ${errorCodesOf(a).map(code).join(', ') || '_none_'}. Golden cases: \`tests/golden/action-${a.id}.json\`.`,
    );
    return lines.join('\n');
  });
  const placementSections = [...c.placements.values()].map((p) => {
    const where =
      p.triggerState === undefined
        ? `when action ${code(p.triggerAction ?? '')} runs`
        : `on entering ${code(p.triggerState)}`;
    const conds = [
      ...p.eligibility.map((e) => code(e.source)),
      ...p.rules
        .filter((r) => r.blocking)
        .map((r) => `${code(r.expr.source)} (rule ${code(r.id)})`),
    ];
    return `- ${code(p.id)} (${p.format}${p.inWorld ? ', in-world' : ''}) — shown ${where}${conds.length === 0 ? '' : ` if ${conds.join(' and ')}`}${p.inWorld ? '' : `; never in ${[...p.forbidden].sort().map(code).join(', ')}`}.`;
  });
  files.set('gamex/backend/RULES.md', {
    ownership: 'editable',
    content: `${MD_HEADER}

# Server-authoritative rules — ${m.meta.name}

The backend owns every balance and counter. The client may request actions and report mission results; the
server checks the rules below, applies effects atomically, and records every change in \`ledger\`. Every
request carries an \`Idempotency-Key\`; a retry returns the stored response and changes nothing.

${editable('overview', '_Team notes: architecture, services, deployment. GameX keeps this section when it regenerates the file._')}

## Actions

${sections.join('\n\n')}

## Ads and purchases

${placementSections.join('\n')}

## Anti-cheat

- Never trust client-side balances, counters or timestamps; use server time for cooldowns.
- Rewarded rewards only after server-side verification; IAP only after receipt validation.
- Limits and cooldowns are stored as counters and timestamps (\`…_count_…\`, \`…_last_at\`) and reset by scope
  (mission, session, day).

${editable('anti-cheat-notes', '_Team notes on fraud signals, rate limits and monitoring._')}
`,
  });
}
