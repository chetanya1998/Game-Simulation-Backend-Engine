import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Command } from 'commander';
import {
  EngineModelError,
  explore,
  gridSweep,
  latinHypercubeSweep,
  runSimulation,
  type SimulationResult,
} from '@gamex/engine';
import { formatIssue, validateGameModel, type GameModel, type Issue } from '@gamex/model';
import { renderSpecPack } from '@gamex/specpack';
import { writeSpecPack } from '@gamex/specpack/node';
import type { Io, JsonResult } from './types.js';

export const MODEL_PATH = 'gamex/game-model.json';

type IssueOut = JsonResult<unknown>['issues'][number];

class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly code: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

interface Common {
  json?: boolean;
  cwd?: string;
  model?: string;
}

function toIssue(i: Issue): IssueOut {
  return {
    severity: i.severity,
    code: i.code,
    message: formatIssue(i),
    ...(i.hint === undefined ? {} : { hint: i.hint }),
  };
}

/** Loads and validates the Game Model; throws CliError (exit 3 missing file, 1 invalid model). */
function loadModel(o: Common): { model: GameModel; path: string; issues: readonly Issue[] } {
  const root = resolve(o.cwd ?? process.cwd());
  const path =
    o.model === undefined
      ? join(root, MODEL_PATH)
      : isAbsolute(o.model)
        ? o.model
        : resolve(root, o.model);
  if (!existsSync(path)) {
    throw new CliError(
      `No Game Model at ${path}`,
      3,
      'MODEL_NOT_FOUND',
      `Create ${MODEL_PATH} (or pass --model <file>).`,
    );
  }
  const text = readFileSync(path, 'utf8');
  const result = validateGameModel(text, { source: relative(root, path) || path });
  if (!result.ok || result.model === undefined) {
    const err = new CliError(
      `The Game Model has ${String(result.issues.filter((i) => i.severity === 'error').length)} error(s)`,
      1,
      'MODEL_INVALID',
      'Fix the errors above, then run the command again.',
    );
    (err as CliError & { issues: readonly Issue[] }).issues = result.issues;
    throw err;
  }
  return { model: result.model, path, issues: result.issues };
}

function intOption(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < (name === 'seed' ? Number.MIN_SAFE_INTEGER : 1))
    throw new CliError(
      `--${name} must be ${name === 'seed' ? 'an integer' : 'a positive integer'}, got "${value}"`,
      2,
      'USAGE',
    );
  return n;
}

function keyValues(list: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const kv of list) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/.exec(kv);
    if (m === null)
      throw new CliError(
        `--param expects key=number (a constant key), got "${kv}"`,
        2,
        'USAGE',
        'Example: --param interstitialMinGapSeconds=240',
      );
    out[m[1] ?? ''] = Number(m[2]);
  }
  return out;
}

const collect = (value: string, previous: string[]): string[] => [...previous, value];

/** Runs a command body with uniform output, `--json` envelopes and exit codes. */
function run(
  io: Io,
  command: string,
  o: Common,
  body: () => { ok: boolean; data: unknown; issues?: IssueOut[]; human: string },
): void {
  try {
    const r = body();
    if (o.json === true)
      io.stdout(
        `${JSON.stringify({ ok: r.ok, command, data: r.data, issues: r.issues ?? [] } satisfies JsonResult<unknown>)}\n`,
      );
    else io.stderr(r.human.endsWith('\n') ? r.human : `${r.human}\n`);
    if (!r.ok) process.exitCode = 1;
  } catch (error) {
    let cli: CliError;
    if (error instanceof CliError) cli = error;
    else if (error instanceof EngineModelError) cli = new CliError(error.message, 1, 'MODEL_ERROR');
    else cli = new CliError(error instanceof Error ? error.message : String(error), 3, 'INTERNAL');
    const issues: IssueOut[] = [
      ...((cli as CliError & { issues?: readonly Issue[] }).issues ?? []).map(toIssue),
      {
        severity: 'error',
        code: cli.code,
        message: cli.message,
        ...(cli.hint === undefined ? {} : { hint: cli.hint }),
      },
    ];
    if (o.json === true)
      io.stdout(
        `${JSON.stringify({ ok: false, command, data: null, issues } satisfies JsonResult<null>)}\n`,
      );
    else
      io.stderr(
        `${issues.map((i) => `✖ ${i.message}${i.hint === undefined || i.message.includes(i.hint) ? '' : ` — ${i.hint}`}`).join('\n')}\n`,
      );
    process.exitCode = cli.exitCode;
  }
}

function simSummary(r: SimulationResult): unknown {
  return {
    record: r.record,
    kpis: r.kpis,
    invariants: r.invariants,
    findings: r.findings,
    personas: r.personas.map((p) => ({
      id: p.id,
      players: p.players,
      churned: p.churned,
      retention: p.daily.map((d) => d.retention),
    })),
  };
}

function humanSim(r: SimulationResult): string {
  const lines = [
    `Simulated ${String(r.record.playersPerPersona)} players × ${String(r.record.personas.length)} personas × ${String(r.record.days)} days (seed ${String(r.record.seed)}, output ${r.record.outputHash.slice(0, 12)})`,
    '',
    'Invariants:',
  ];
  for (const i of r.invariants)
    lines.push(
      `  ${i.status === 'pass' ? '✔' : i.status === 'fail' ? '✖' : '–'} ${i.id}: ${i.message}`,
    );
  lines.push('', 'KPIs:');
  for (const k of r.kpis)
    lines.push(`  ${k.id}: ${k.value === null ? `— (${k.note ?? ''})` : String(k.value)}`);
  if (r.findings.length > 0)
    lines.push('', 'Findings:', ...r.findings.map((f) => `  ${f.severity}: ${f.message}`));
  return lines.join('\n');
}

export function registerCommands(program: Command, io: Io): void {
  const common = (cmd: Command): Command =>
    cmd
      .option('--json', 'print a single JSON result to stdout')
      .option('--cwd <dir>', 'game repo root (default: current directory)')
      .option('--model <file>', `Game Model file (default: ${MODEL_PATH})`);

  common(
    program
      .command('validate')
      .description('Check the Game Model: schema, references, formulas, ranges and design rules.'),
  ).action((o: Common) => {
    run(io, 'validate', o, () => {
      const { issues } = loadModel(o);
      const warnings = issues.filter((i) => i.severity === 'warning');
      return {
        ok: true,
        data: { errors: 0, warnings: warnings.length },
        issues: issues.map(toIssue),
        human: `✔ The Game Model is valid${warnings.length === 0 ? '' : ` (${String(warnings.length)} warning(s))`}\n${warnings.map((w) => `  ⚠ ${formatIssue(w)}`).join('\n')}`,
      };
    });
  });

  common(
    program
      .command('sim')
      .description('Run the deterministic Monte Carlo simulation (or a sweep).'),
  )
    .option('--seed <n>', 'random seed (same seed ⇒ same result)')
    .option('--days <n>', 'days to simulate (default 7)')
    .option('--players <n>', 'players per persona (default 100)')
    .option('--persona <id>', 'simulate only this persona (repeatable)', collect, [])
    .option('--param <key=value>', 'override a constant by key (repeatable)', collect, [])
    .option(
      '--sweep <key=v1,v2,...>',
      'grid sweep over values of a constant (repeatable)',
      collect,
      [],
    )
    .option(
      '--lhs <keys>',
      'Latin-hypercube sweep over comma-separated constant keys (within their ranges)',
    )
    .option('--samples <n>', 'samples for --lhs (default 10)')
    .action(
      (
        o: Common & {
          seed?: string;
          days?: string;
          players?: string;
          persona: string[];
          param: string[];
          sweep: string[];
          lhs?: string;
          samples?: string;
        },
      ) => {
        run(io, 'sim', o, () => {
          const { model } = loadModel(o);
          const options = {
            seed: intOption('seed', o.seed, 1),
            days: intOption('days', o.days, 7),
            playersPerPersona: intOption('players', o.players, 100),
            ...(o.persona.length === 0 ? {} : { personas: o.persona }),
          };
          if (o.sweep.length > 0 || o.lhs !== undefined) {
            const sweep =
              o.lhs !== undefined
                ? latinHypercubeSweep(
                    model,
                    o.lhs.split(',').map((s) => s.trim()),
                    intOption('samples', o.samples, 10),
                    options,
                  )
                : gridSweep(
                    model,
                    Object.fromEntries(
                      o.sweep.map((s) => {
                        const [key = '', values = ''] = s.split('=');
                        const nums = values.split(',').map(Number);
                        if (key === '' || nums.some((n) => !Number.isFinite(n)))
                          throw new CliError(`--sweep expects key=v1,v2,…, got "${s}"`, 2, 'USAGE');
                        return [key, nums];
                      }),
                    ),
                    options,
                  );
            return {
              ok: true,
              data: sweep,
              human: [
                `${sweep.method} sweep, ${String(sweep.rows.length)} runs:`,
                ...sweep.rows.map(
                  (r) =>
                    `  ${JSON.stringify(r.params)} → ${Object.entries(r.kpis)
                      .map(([k, v]) => `${k}=${String(v)}`)
                      .join(
                        ' ',
                      )}${r.failedInvariants.length === 0 ? '' : ` ✖ ${r.failedInvariants.join(', ')}`}`,
                ),
              ].join('\n'),
            };
          }
          const r = runSimulation(model, { ...options, params: keyValues(o.param) });
          const failing = r.invariants.filter(
            (i) => i.status === 'fail' && i.severity === 'blocking',
          );
          return { ok: failing.length === 0, data: simSummary(r), human: humanSim(r) };
        });
      },
    );

  common(
    program
      .command('explore')
      .description('Reachability, never-true conditions, exploit search and ad-placement safety.'),
  ).action((o: Common) => {
    run(io, 'explore', o, () => {
      const { model } = loadModel(o);
      const r = explore(model);
      const lines = [
        `${r.ok ? '✔' : '✖'} ${String(r.reachability.states)} screens, ${String(r.reachability.explored.nodes)} states explored, ${String(r.exploits.searched.nodes)} adversarial states`,
        ...r.reachability.issues.map((i) => `  ${i.severity}: ${i.kind} ${i.ref} — ${i.message}`),
        ...r.exploits.findings.map((f) => `  ${f.severity}: ${f.kind} — ${f.message}`),
        ...r.placements
          .filter((p) => !p.safe)
          .map((p) => `  error: ${p.placement} can appear in ${p.forbiddenHits.join(', ')}`),
      ];
      return {
        ok: r.ok,
        data: {
          ok: r.ok,
          reachability: { issues: r.reachability.issues, explored: r.reachability.explored },
          exploits: r.exploits,
          placements: r.placements,
        },
        human: lines.join('\n'),
      };
    });
  });

  common(
    program
      .command('sync')
      .description('Write (or update) the Spec Pack in gamex/ from the Game Model.'),
  )
    .option('--force', 'overwrite generated files that were edited by hand')
    .option('--dry-run', 'show what would change, write nothing')
    .option('--sensitivity', 'also rank constants by KPI sensitivity in the report (slower)')
    .option('--seed <n>', 'simulation seed for the report (default 1)')
    .option('--days <n>', 'simulated days for the report (default 7)')
    .option('--players <n>', 'players per persona for the report (default 100)')
    .action(
      (
        o: Common & {
          force?: boolean;
          dryRun?: boolean;
          sensitivity?: boolean;
          seed?: string;
          days?: string;
          players?: string;
        },
      ) => {
        run(io, 'sync', o, () => {
          const { model } = loadModel(o);
          const root = resolve(o.cwd ?? process.cwd());
          const pack = renderSpecPack(model, {
            seed: intOption('seed', o.seed, 1),
            days: intOption('days', o.days, 7),
            playersPerPersona: intOption('players', o.players, 100),
            sensitivity: o.sensitivity === true,
          });
          const r = writeSpecPack(root, pack, {
            force: o.force === true,
            dryRun: o.dryRun === true,
          });
          const count = (a: string): number => r.files.filter((f) => f.action === a).length;
          const changed = r.files.filter((f) => f.action !== 'unchanged' && f.action !== 'skip');
          const human = [
            r.conflicts.length > 0
              ? `✖ Nothing written: ${String(r.conflicts.length)} conflict(s). Re-run with --force to overwrite, or move your changes into the Game Model.`
              : `${o.dryRun === true ? 'Would write' : '✔ Spec Pack written'}: ${String(count('create'))} created, ${String(count('update'))} updated, ${String(count('delete'))} deleted, ${String(count('unchanged'))} unchanged`,
            ...changed.map(
              (f) =>
                `  ${f.action.padEnd(9)} ${f.path}${f.reason === undefined ? '' : ` — ${f.reason}`}`,
            ),
          ];
          return {
            ok: r.conflicts.length === 0,
            data: {
              written: r.written,
              files: r.files,
              conflicts: r.conflicts,
              goldenCases: pack.goldens.reduce((n, g) => n + g.cases.length, 0),
              outputHash: pack.simulation.record.outputHash,
            },
            issues: r.conflicts.map((c) => ({
              severity: 'error' as const,
              code: 'SYNC_CONFLICT',
              message: `${c.path}: ${c.reason ?? ''}`,
              hint: 'Use --force to overwrite.',
            })),
            human: human.join('\n'),
          };
        });
      },
    );
}
