import {
  canonicalStringify,
  gameModelJsonSchema,
  serializeGameModel,
  type GameModel,
} from '@gamex/model';
import {
  compileModel,
  explore,
  runSimulation,
  sensitivity as runSensitivity,
  type SimulationResult,
} from '@gamex/engine';
import { GENERATED_HEADER, generateGoldens, type GoldenOptions } from './golden/generate.js';
import { goldenJsonSchema, type GoldenFile } from './golden/schema.js';
import { agentsSection, renderShims } from './render/agents.js';
import { balanceJsonSchema, renderBalance } from './render/balance.js';
import type { FileMap } from './render/common.js';
import { renderFormulas } from './render/formulas.js';
import { renderOpenApi } from './render/openapi.js';
import { renderReadmes } from './render/readme.js';
import { renderReport } from './render/report.js';
import { renderRules } from './render/rules.js';
import { renderSkills } from './render/skills.js';
import { renderSql } from './render/sql.js';
import { renderStateMachine } from './render/state-machine.js';
import { renderTasks } from './render/tasks.js';
import { TEMPLATES } from './templates.generated.js';

export interface SpecPackOptions {
  readonly seed?: number;
  readonly days?: number;
  readonly playersPerPersona?: number;
  /** Also run one-at-a-time sensitivity for the report (slower). */
  readonly sensitivity?: boolean;
  readonly golden?: GoldenOptions;
}

export interface SpecPack {
  readonly files: FileMap;
  /** Body of the GameX section of AGENTS.md (the writer merges it into the existing file). */
  readonly agentsSection: string;
  readonly goldens: readonly GoldenFile[];
  readonly simulation: SimulationResult;
}

/**
 * Renders the whole Spec Pack from a Game Model. Pure and deterministic: the same model and options always
 * give byte-identical files (no timestamps, fixed ordering), which is what makes `gamex sync` idempotent.
 */
export function renderSpecPack(model: GameModel, options: SpecPackOptions = {}): SpecPack {
  const c = compileModel(model);
  const files: FileMap = new Map();
  files.set('gamex/game-model.json', {
    ownership: 'source',
    content: serializeGameModel({ ...model, $schema: './schema/game-model.schema.json' }),
  });
  files.set('gamex/schema/game-model.schema.json', {
    ownership: 'generated',
    content: canonicalStringify({ $comment: GENERATED_HEADER, ...gameModelJsonSchema() }),
  });
  files.set('gamex/schema/golden.schema.json', {
    ownership: 'generated',
    content: canonicalStringify({ $comment: GENERATED_HEADER, ...goldenJsonSchema() }),
  });
  files.set('gamex/schema/balance.schema.json', {
    ownership: 'generated',
    content: canonicalStringify({ $comment: GENERATED_HEADER, ...balanceJsonSchema() }),
  });

  renderBalance(model, files);
  renderStateMachine(model, files);
  renderFormulas(model, files);
  renderOpenApi(c, files);
  renderSql(c, files);
  renderRules(c, files);

  const goldens = generateGoldens(c, options.golden);
  for (const g of goldens)
    files.set(`gamex/tests/golden/${g.subject.replace(':', '-')}.json`, {
      ownership: 'generated',
      content: canonicalStringify(g),
    });
  for (const [path, content] of Object.entries(TEMPLATES))
    files.set(`gamex/${path}`, { ownership: 'generated', content });
  renderTasks(c, goldens, files);
  renderSkills(files);
  renderReadmes(model, files);
  renderShims(files);

  const simOptions = {
    seed: options.seed ?? 1,
    days: options.days ?? 7,
    playersPerPersona: options.playersPerPersona ?? 100,
  };
  const simulation = runSimulation(c, simOptions);
  const exploration = explore(model);
  const sens =
    options.sensitivity === true
      ? runSensitivity(model, {
          ...simOptions,
          playersPerPersona: Math.max(10, Math.floor(simOptions.playersPerPersona / 4)),
        })
      : undefined;
  renderReport({ sim: simulation, explore: exploration, sensitivity: sens }, files);

  return {
    files: new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    agentsSection: agentsSection(model),
    goldens,
    simulation,
  };
}
