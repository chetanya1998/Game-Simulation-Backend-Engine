import type { GameModel } from '@gamex/model';
import { minimalModel } from '../helpers.ts';

/** The minimal model with one planted defect of every kind the reachability analysis must find. */
export function brokenFlowModel(): GameModel {
  const m = minimalModel();
  const prov = m.entities[0]?.provenance as GameModel['entities'][number]['provenance'];
  const s = (id: string): GameModel['stateMachine']['states'][number] => ({
    id,
    kind: 'menu',
    provenance: prov,
  });
  m.stateMachine.states.push(s('secret'), s('void'), s('loop-a'), s('loop-b'));
  const t = (
    id: string,
    from: string,
    to: string,
    extra: Partial<GameModel['stateMachine']['transitions'][number]> = {},
  ) =>
    m.stateMachine.transitions.push({
      id,
      from: `state:${from}`,
      to: `state:${to}`,
      trigger: 'ui',
      provenance: prov,
      ...extra,
    });
  t('from-secret', 'secret', 'menu'); // secret is unreachable
  t('into-void', 'menu', 'void'); // void is a dead end
  t('into-loop', 'menu', 'loop-a'); // loop-a ⇄ loop-b is a trap
  t('loop-ab', 'loop-a', 'loop-b');
  t('loop-ba', 'loop-b', 'loop-a');
  t('impossible-exit', 'victory', 'menu', { guard: 'tier > 10' }); // tier is declared 0…10
  m.actions.push({
    id: 'impossible',
    actor: 'player',
    preconditions: ['heroHp > 1000'],
    costs: [],
    effects: [],
    errorCode: 'NEVER',
    provenance: prov,
  });
  t('try-impossible', 'menu', 'menu', { trigger: 'action:impossible' });
  m.monetization.placements.push({
    id: 'banner-never',
    format: 'banner',
    trigger: { state: 'state:menu' },
    eligibility: ['tier < 0'],
    provenance: prov,
  });
  return m;
}
