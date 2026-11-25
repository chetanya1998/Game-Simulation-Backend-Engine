import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import {
  AgentHandoffProvider,
  AnthropicProvider,
  BudgetExceeded,
  EMPTY_LEDGER,
  HandoffPending,
  LlmError,
  RecordedProvider,
  RecordingProvider,
  ReviewLedgerSchema,
  assembleCandidate,
  decide,
  estimateExtraction,
  promote,
  resolveModel,
  reviewItems,
  runExtraction,
  type AssemblyReport,
  type Decision,
  type Effort,
  type LlmProvider,
  type PromoteSummary,
  type ReviewLedger,
} from '@gamex/extract';
import { discoverInputs, readChunks, type IngestPlan, type PlannedInput } from '@gamex/ingest';
import {
  computeContentHash,
  serializeGameModel,
  validateGameModel,
  type GameModel,
} from '@gamex/model';
import { CliError, MODEL_PATH, runAsync, syncPack, toIssue, type IssueOut } from './commands.js';
import type { Io } from './types.js';

export const WORK_DIR = 'gamex/.work';
export const PLAN_PATH = `${WORK_DIR}/ingest.json`;
export const CANDIDATE_PATH = `${WORK_DIR}/candidate.json`;
export const REPORT_PATH = `${WORK_DIR}/extraction-report.json`;
export const LEDGER_PATH = 'gamex/review.json';
export const CONFIG_PATH = 'gamex/config.json';

interface Base {
  json?: boolean;
  cwd?: string;
}

interface IngestOptions extends Base {
  yes?: boolean;
  include: string[];
  maxBytes?: string;
}

interface ExtractOptions extends Base {
  provider?: string;
  recordings?: string;
  record?: string;
  model?: string;
  effort?: string;
  budget?: string;
  batchChars?: string;
}

interface ReviewOptions extends Base {
  decisions?: string;
  default?: string;
}

/** The confirmed ingest plan, as saved in gamex/.work/ingest.json. */
interface SavedPlan {
  version: 1;
  confirmed: true;
  include: string[];
  maxBytes?: number;
  files: PlannedInput[];
  excluded: IngestPlan['excluded'];
  totalBytes: number;
}

const rootOf = (o: Base): string => resolve(o.cwd ?? process.cwd());

function positive(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new CliError(`--${name} must be a positive integer, got "${value}"`, 2, 'USAGE');
  return n;
}

/** Writes a file under gamex/.work/, which ignores itself in git. */
function writeWork(root: string, rel: string, content: string): void {
  const dir = join(root, WORK_DIR);
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  if (!existsSync(join(dir, '.gitignore'))) writeFileSync(join(dir, '.gitignore'), '*\n');
  writeFileSync(join(root, rel), content);
}

function readJson(path: string, what: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new CliError(
      `Cannot read ${what} at ${path}: ${error instanceof Error ? error.message : String(error)}`,
      3,
      'IO_ERROR',
    );
  }
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

// ─── ingest ──────────────────────────────────────────────────────────────────────────────────────

interface IngestStep {
  plan: SavedPlan;
  human: string[];
}

async function ingestStep(io: Io, o: IngestOptions): Promise<IngestStep> {
  const root = rootOf(o);
  const maxBytes = positive('max-bytes', o.maxBytes);
  const plan = discoverInputs(root, {
    include: o.include,
    ...(maxBytes === undefined ? {} : { maxBytes }),
  });
  if (plan.files.length === 0) {
    throw new CliError(
      `No design documents, config or tuning code found in ${root}.`,
      1,
      'NO_INPUTS',
      'Add a GDD (e.g. docs/GDD.md) or name files with --include <path>.',
    );
  }
  const chunks = await readChunks(plan, maxBytes === undefined ? {} : { maxBytes });
  const estimate = estimateExtraction(chunks);
  const human = [
    `Files that will be sent to the LLM (${String(plan.files.length)}, ${kb(plan.totalBytes)}, ≈${String(estimate.inputTokens)} input tokens over ${String(estimate.requests)} requests before caching):`,
    ...plan.files.map(
      (f) => `  + ${f.path.padEnd(40)} ${f.kind.padEnd(6)} ${kb(f.bytes).padStart(9)}  ${f.reason}`,
    ),
    `Excluded (${String(plan.excluded.length)}):`,
    ...plan.excluded.map((e) => `  - ${e.path.padEnd(40)} ${e.reason}`),
  ];
  if (o.yes !== true) {
    if (io.prompt === undefined || o.json === true) {
      io.stderr(`${human.join('\n')}\n`);
      throw new CliError(
        'Confirmation needed before any file is sent to an LLM.',
        2,
        'CONFIRMATION_REQUIRED',
        'Check the list above, then re-run with --yes.',
      );
    }
    io.stderr(`${human.join('\n')}\n`);
    const answer = await io.prompt('Send these files to the LLM provider? [y/N] ');
    if (!/^y(es)?$/i.test(answer.trim())) {
      throw new CliError('Not confirmed; nothing was sent.', 1, 'NOT_CONFIRMED');
    }
  }
  const saved: SavedPlan = {
    version: 1,
    confirmed: true,
    include: o.include,
    ...(maxBytes === undefined ? {} : { maxBytes }),
    files: [...plan.files],
    excluded: [...plan.excluded],
    totalBytes: plan.totalBytes,
  };
  writeWork(root, PLAN_PATH, `${JSON.stringify(saved, null, 2)}\n`);
  return { plan: saved, human: [...human, `✔ Plan confirmed and saved to ${PLAN_PATH}`] };
}

// ─── extract ─────────────────────────────────────────────────────────────────────────────────────

function readConfigModel(root: string): string | undefined {
  const path = join(root, CONFIG_PATH);
  if (!existsSync(path)) return undefined;
  const value = readJson(path, 'the GameX config') as { model?: unknown };
  return typeof value.model === 'string' ? value.model : undefined;
}

function makeProvider(root: string, o: ExtractOptions): { provider: LlmProvider; model?: string } {
  const kind = o.provider ?? 'anthropic';
  let provider: LlmProvider;
  let model: string | undefined;
  if (kind === 'anthropic') {
    if ((process.env['ANTHROPIC_API_KEY'] ?? '') === '') {
      throw new CliError(
        'ANTHROPIC_API_KEY is not set.',
        3,
        'NO_API_KEY',
        'Set ANTHROPIC_API_KEY, or use --provider agent to answer the requests with your own agent session.',
      );
    }
    const effort = o.effort ?? 'high';
    if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(effort))
      throw new CliError(
        `--effort must be low, medium, high, xhigh or max, got "${effort}"`,
        2,
        'USAGE',
      );
    model = resolveModel({
      flag: o.model,
      env: process.env['GAMEX_MODEL'],
      config: readConfigModel(root),
    }).model;
    provider = new AnthropicProvider({ model, effort: effort as Effort });
  } else if (kind === 'agent') {
    provider = new AgentHandoffProvider(join(root, WORK_DIR, 'handoff'));
  } else if (kind === 'recorded') {
    if (o.recordings === undefined)
      throw new CliError('--provider recorded needs --recordings <dir>', 2, 'USAGE');
    provider = RecordedProvider.fromDirectory(resolve(o.recordings));
  } else {
    throw new CliError(
      `--provider must be anthropic, agent or recorded, got "${kind}"`,
      2,
      'USAGE',
    );
  }
  if (o.record !== undefined) provider = new RecordingProvider(provider, resolve(o.record));
  return { provider, ...(model === undefined ? {} : { model }) };
}

/** Re-discovers the inputs and keeps exactly the confirmed files; refuses if any of them changed. */
function confirmedPlan(root: string): IngestPlan {
  const path = join(root, PLAN_PATH);
  if (!existsSync(path)) {
    throw new CliError(
      `No confirmed ingest plan at ${PLAN_PATH}.`,
      2,
      'NO_INGEST_PLAN',
      'Run `gamex ingest` first to choose and confirm the files.',
    );
  }
  const saved = readJson(path, 'the ingest plan') as SavedPlan;
  const fresh = discoverInputs(root, {
    include: saved.include,
    ...(saved.maxBytes === undefined ? {} : { maxBytes: saved.maxBytes }),
  });
  const now = new Map(fresh.files.map((f) => [f.path, f]));
  const changed = saved.files
    .filter((f) => now.get(f.path)?.sha256 !== f.sha256)
    .map((f) => f.path);
  if (changed.length > 0) {
    throw new CliError(
      `These confirmed files changed or can no longer be read safely: ${changed.join(', ')}.`,
      1,
      'INPUTS_CHANGED',
      'Run `gamex ingest` again to review and confirm the new inputs.',
    );
  }
  const files = saved.files.flatMap((f) => now.get(f.path) ?? []);
  return {
    root,
    files,
    excluded: fresh.excluded,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
  };
}

interface ExtractStep {
  done: boolean;
  data: unknown;
  human: string[];
  pending?: readonly string[];
}

function reportLines(report: AssemblyReport, model: GameModel): string[] {
  const c = report.counts;
  return [
    `✔ Candidate model: ${String(c['states'])} screens, ${String(c['transitions'])} transitions, ${String(c['actions'])} actions, ${String(c['placements'])} placements, ${String(c['constants'])} constants, ${String(c['rules'])} rules, ${String(model.gaps.length)} gaps`,
    ...report.conflicts.map(
      (x) =>
        `  ⚠ conflict ${x.ref}: using ${x.chosen.value} from ${x.chosen.source} ${x.chosen.location}; also ${x.others.map((y) => `${y.value} (${y.source} ${y.location})`).join(', ')}`,
    ),
    ...report.unverified.map((u) => `  ⚠ quote not found for ${u.ref} in ${u.chunk}: "${u.quote}"`),
    ...report.valueMismatches.map(
      (v) => `  ⚠ ${v.ref} = ${String(v.value)} is not stated in "${v.excerpt}"`,
    ),
    ...report.dropped.map(
      (d) => `  ✖ left out ${d.ref}${d.in === undefined ? '' : ` (in ${d.in})`}: ${d.reason}`,
    ),
  ];
}

async function extractStep(io: Io, o: ExtractOptions): Promise<ExtractStep> {
  const root = rootOf(o);
  const plan = confirmedPlan(root);
  const { provider, model } = makeProvider(root, o);
  const batchChars = positive('batch-chars', o.batchChars);
  const budgetTokens = positive('budget', o.budget);
  const chunks = await readChunks(plan);
  let run;
  try {
    run = await runExtraction(chunks, provider, {
      ...(batchChars === undefined ? {} : { batchChars }),
      ...(budgetTokens === undefined ? {} : { budgetTokens }),
      ...(o.json === true
        ? {}
        : {
            onProgress: (m: string) => {
              io.stderr(`  … ${m}\n`);
            },
          }),
    });
  } catch (error) {
    if (error instanceof HandoffPending) {
      return {
        done: false,
        pending: error.pending,
        data: { pending: error.pending, directory: `${WORK_DIR}/handoff` },
        human: [
          `… ${String(error.pending.length)} request(s) are waiting for your agent in ${WORK_DIR}/handoff/requests/.`,
          `  Answer each in ${WORK_DIR}/handoff/responses/<same name>.json (see ${WORK_DIR}/handoff/README.md), then run the command again.`,
        ],
      };
    }
    if (error instanceof BudgetExceeded) throw new CliError(error.message, 1, 'BUDGET_EXCEEDED');
    if (error instanceof LlmError) throw new CliError(error.message, 3, 'LLM_ERROR');
    throw error;
  }
  const candidate = assembleCandidate(run.outputs, chunks);
  writeWork(root, CANDIDATE_PATH, serializeGameModel(candidate.model));
  writeWork(
    root,
    REPORT_PATH,
    `${JSON.stringify({ provider: run.provider, model, usage: run.usage, requests: run.requests, report: candidate.report }, null, 2)}\n`,
  );
  const u = run.usage;
  return {
    done: true,
    data: {
      provider: run.provider,
      model,
      usage: u,
      report: candidate.report,
      candidate: CANDIDATE_PATH,
    },
    human: [
      `✔ Extracted with ${run.provider}${model === undefined ? '' : ` (${model})`}: ${String(run.requests.length)} requests${u.inputTokens === 0 ? '' : `, ${String(u.inputTokens)} input (${String(u.cacheReadTokens)} cached) / ${String(u.outputTokens)} output tokens`}`,
      ...reportLines(candidate.report, candidate.model),
      `  Saved to ${CANDIDATE_PATH}. Next: \`gamex review\`.`,
    ],
  };
}

// ─── review ──────────────────────────────────────────────────────────────────────────────────────

function loadLedger(root: string): ReviewLedger {
  const path = join(root, LEDGER_PATH);
  if (!existsSync(path)) return EMPTY_LEDGER;
  const parsed = ReviewLedgerSchema.safeParse(readJson(path, 'the review ledger'));
  if (!parsed.success) {
    throw new CliError(
      `${LEDGER_PATH} is not a valid review ledger: ${parsed.error.issues.map((i) => `/${i.path.join('/')}: ${i.message}`).join('; ')}`,
      1,
      'LEDGER_INVALID',
    );
  }
  return parsed.data;
}

const KEYS: Record<string, Decision | 'skip' | 'all' | 'quit'> = {
  a: 'approve',
  r: 'reject',
  s: 'assume',
  k: 'skip',
  A: 'all',
  q: 'quit',
};

async function interactive(
  io: Io & { prompt: NonNullable<Io['prompt']> },
  candidate: GameModel,
  start: ReviewLedger,
): Promise<ReviewLedger> {
  let ledger = start;
  const pending = reviewItems(candidate, ledger).filter((i) => i.decision === 'pending');
  for (const [n, item] of pending.entries()) {
    const p = item.provenance;
    io.stderr(
      `\n[${String(n + 1)}/${String(pending.length)}] ${item.ref} — ${item.name} (${p.status}, ${p.confidence} confidence)\n` +
        `  ${p.source}${p.location === '' ? '' : ` ${p.location}`}: ${p.excerpt}\n`,
    );
    let choice: Decision | 'skip' | 'all' | 'quit' | undefined;
    while (choice === undefined) {
      const key = (
        await io.prompt(
          '  [a]pprove  [r]eject  a[s]sume  [k] skip  [A] approve all remaining  [q] quit > ',
        )
      ).trim();
      choice = KEYS[key];
    }
    if (choice === 'quit') break;
    if (choice === 'skip') continue;
    if (choice === 'all') {
      for (const rest of pending.slice(n)) ledger = decide(ledger, rest.ref, 'approve');
      break;
    }
    ledger = decide(ledger, item.ref, choice);
  }
  return ledger;
}

interface ReviewStep {
  ok: boolean;
  data: unknown;
  issues: IssueOut[];
  human: string[];
}

function summaryLine(s: PromoteSummary): string {
  return `${String(s.approved)} approved, ${String(s.assumed)} assumed, ${String(s.edited)} edited, ${String(s.rejected)} rejected, ${String(s.pending.length)} without a decision (left out)`;
}

async function reviewStep(io: Io, o: ReviewOptions): Promise<ReviewStep> {
  const root = rootOf(o);
  const candidatePath = join(root, CANDIDATE_PATH);
  if (!existsSync(candidatePath)) {
    throw new CliError(
      `No candidate model at ${CANDIDATE_PATH}.`,
      2,
      'NO_CANDIDATE',
      'Run `gamex extract` first.',
    );
  }
  const parsed = validateGameModel(readFileSync(candidatePath, 'utf8'), { source: CANDIDATE_PATH });
  if (parsed.model === undefined) {
    const err = new CliError(
      'The candidate model is invalid.',
      1,
      'CANDIDATE_INVALID',
      'Run `gamex extract` again.',
    );
    (err as CliError & { issues: unknown }).issues = parsed.issues;
    throw err;
  }
  const candidate = parsed.model;
  let ledger = loadLedger(root);
  if (o.decisions !== undefined) {
    const file = ReviewLedgerSchema.safeParse(readJson(resolve(o.decisions), 'the decisions file'));
    if (!file.success)
      throw new CliError(
        `${o.decisions} is not a valid decisions file: ${file.error.issues.map((i) => `/${i.path.join('/')}: ${i.message}`).join('; ')}`,
        2,
        'USAGE',
        'Expected {"version": 1, "default"?: "approve", "decisions": [{"ref": "…", "decision": "approve"}]}.',
      );
    for (const d of file.data.decisions) {
      ledger = decide(ledger, d.ref, d.decision, {
        ...(d.set === undefined ? {} : { set: d.set }),
        ...(d.note === undefined ? {} : { note: d.note }),
      });
    }
    if (file.data.default !== undefined) ledger = { ...ledger, default: file.data.default };
  }
  if (o.default !== undefined) {
    if (!['approve', 'reject', 'assume', 'pending'].includes(o.default))
      throw new CliError(
        `--default must be approve, reject, assume or pending, got "${o.default}"`,
        2,
        'USAGE',
      );
    ledger = { ...ledger, default: o.default as NonNullable<ReviewLedger['default']> };
  }
  if (
    o.decisions === undefined &&
    o.default === undefined &&
    io.prompt !== undefined &&
    o.json !== true
  ) {
    ledger = await interactive({ ...io, prompt: io.prompt }, candidate, ledger);
  }
  mkdirSync(join(root, 'gamex'), { recursive: true });
  writeFileSync(join(root, LEDGER_PATH), `${JSON.stringify(ledger, null, 2)}\n`);

  let promoted;
  try {
    promoted = promote(candidate, ledger);
  } catch (error) {
    return {
      ok: false,
      data: { ledger: LEDGER_PATH },
      issues: [
        {
          severity: 'error',
          code: 'REVIEW_INCOMPLETE',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      human: [
        `✖ ${error instanceof Error ? error.message : String(error)}`,
        `  Decisions saved to ${LEDGER_PATH}.`,
      ],
    };
  }
  const { summary, issues } = promoted;
  const model = promoted.model;
  const modelPath = join(root, MODEL_PATH);
  let version = 1;
  if (existsSync(modelPath)) {
    const previous = validateGameModel(readFileSync(modelPath, 'utf8')).model;
    if (previous !== undefined) {
      version =
        previous.meta.modelVersion +
        (computeContentHash(previous) === computeContentHash(model) ? 0 : 1);
    }
  }
  model.meta.modelVersion = version;
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length === 0) writeFileSync(modelPath, serializeGameModel(model));
  return {
    ok: errors.length === 0,
    data: {
      summary,
      ledger: LEDGER_PATH,
      model: errors.length === 0 ? MODEL_PATH : null,
      modelVersion: version,
    },
    issues: issues.map(toIssue),
    human: [
      `${errors.length === 0 ? '✔' : '✖'} Review: ${summaryLine(summary)}`,
      ...summary.cascaded.map(
        (d) =>
          `  ✖ also left out ${d.ref}${d.in === undefined ? '' : ` (in ${d.in})`}: ${d.reason}`,
      ),
      ...summary.stale.map((r) => `  ⚠ decision for ${r} matches nothing in the candidate`),
      errors.length === 0
        ? `  Wrote ${MODEL_PATH} (model version ${String(version)}) and ${LEDGER_PATH}.`
        : `  ${MODEL_PATH} was not written; decisions saved to ${LEDGER_PATH}.`,
    ],
  };
}

// ─── commands ────────────────────────────────────────────────────────────────────────────────────

const collect = (value: string, previous: string[]): string[] => [...previous, value];

function ingestOptions(cmd: Command): Command {
  return cmd
    .option('--yes', 'confirm the file list without asking')
    .option(
      '--include <path>',
      'also send this file (still subject to every safety rule; repeatable)',
      collect,
      [],
    )
    .option('--max-bytes <n>', 'per-file size cap in bytes (default 262144)');
}

function extractOptions(cmd: Command): Command {
  return cmd
    .option(
      '--provider <name>',
      'anthropic (default), agent (answer with your own agent session) or recorded',
    )
    .option(
      '--model <name>',
      'LLM model (default: GAMEX_MODEL, gamex/config.json, then claude-opus-5-5)',
    )
    .option('--effort <level>', 'reasoning effort: low, medium, high (default), xhigh, max')
    .option('--budget <tokens>', 'refuse to start above this many estimated input tokens')
    .option('--batch-chars <n>', 'maximum characters of documents per request')
    .option('--recordings <dir>', 'recorded answers for --provider recorded')
    .option('--record <dir>', 'also save every answer as a recording in this directory');
}

export function registerExtractionCommands(program: Command, io: Io): void {
  const base = (cmd: Command): Command =>
    cmd
      .option('--json', 'print a single JSON result to stdout')
      .option('--cwd <dir>', 'game repo root (default: current directory)');

  ingestOptions(
    base(
      program
        .command('ingest')
        .description('Choose the files to read (safely) and confirm what will be sent to the LLM.'),
    ),
  ).action((o: IngestOptions) =>
    runAsync(io, 'ingest', o, async () => {
      const r = await ingestStep(io, o);
      return {
        ok: true,
        data: { files: r.plan.files, excluded: r.plan.excluded, totalBytes: r.plan.totalBytes },
        human: r.human.join('\n'),
      };
    }),
  );

  extractOptions(
    base(
      program
        .command('extract')
        .description(
          'Extract a candidate Game Model from the confirmed files (gamex/.work/candidate.json).',
        ),
    ),
  ).action((o: ExtractOptions) =>
    runAsync(io, 'extract', o, async () => {
      const r = await extractStep(io, o);
      return { ok: r.done, data: r.data, human: r.human.join('\n') };
    }),
  );

  base(
    program
      .command('review')
      .description(
        'Approve, reject or assume extracted items; writes gamex/review.json and gamex/game-model.json.',
      ),
  )
    .option(
      '--decisions <file>',
      'apply decisions from a file instead of asking ({"version":1,"default":"approve","decisions":[…]})',
    )
    .option(
      '--default <decision>',
      'decision for items without one: approve, reject, assume or pending',
    )
    .action((o: ReviewOptions) =>
      runAsync(io, 'review', o, async () => {
        const r = await reviewStep(io, o);
        return { ok: r.ok, data: r.data, issues: r.issues, human: r.human.join('\n') };
      }),
    );

  extractOptions(
    ingestOptions(
      base(program.command('init').description('ingest → extract → review → sync in one go.')),
    ),
  )
    .option(
      '--decisions <file>',
      'review decisions to apply (e.g. {"version":1,"default":"approve","decisions":[]})',
    )
    .option('--seed <n>', 'simulation seed for the Spec Pack report (default 1)')
    .option('--days <n>', 'simulated days for the report (default 7)')
    .option('--players <n>', 'players per persona for the report (default 100)')
    .action(
      (
        o: IngestOptions &
          ExtractOptions &
          ReviewOptions & { seed?: string; days?: string; players?: string },
      ) =>
        runAsync(io, 'init', o, async () => {
          const human: string[] = [];
          const ingest = await ingestStep(io, o);
          human.push(...ingest.human);
          const extract = await extractStep(io, o);
          human.push(...extract.human);
          if (!extract.done)
            return {
              ok: false,
              data: { step: 'extract', ...(extract.data as object) },
              human: human.join('\n'),
            };
          const review = await reviewStep(io, o);
          human.push(...review.human);
          if (!review.ok)
            return {
              ok: false,
              data: { step: 'review', ...(review.data as object) },
              issues: review.issues,
              human: human.join('\n'),
            };
          const root = rootOf(o);
          const model = validateGameModel(readFileSync(join(root, MODEL_PATH), 'utf8')).model;
          if (model === undefined)
            throw new CliError('The reviewed model could not be read back.', 3, 'IO_ERROR');
          const { pack, r } = syncPack(root, model, o);
          const ok = r.conflicts.length === 0;
          human.push(
            ok
              ? `✔ Spec Pack written: ${String(r.files.filter((f) => f.action === 'create' || f.action === 'update').length)} files, ${String(pack.goldens.reduce((n, g) => n + g.cases.length, 0))} golden cases`
              : `✖ Spec Pack not written: ${String(r.conflicts.length)} conflict(s); run \`gamex sync --force\` after checking them.`,
          );
          return {
            ok,
            data: {
              files: ingest.plan.files.length,
              extract: extract.data,
              review: review.data,
              written: r.written,
              conflicts: r.conflicts,
            },
            issues: review.issues,
            human: human.join('\n'),
          };
        }),
    );
}
