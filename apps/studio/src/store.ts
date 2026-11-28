import type {
  ExploreReport,
  ReachabilityReport,
  SensitivityResult,
  SimulationResult,
} from '@gamex/engine';
import { validateGameModel, type GameModel } from '@gamex/model';
import { create } from 'zustand';
import { ApiError, api, type Mode } from './lib/api.ts';
import type { ReviewLedger } from './lib/ledger.ts';
import { applyParams, cleanParams, type Params } from './lib/variants.ts';
import { pool } from './engine/pool.ts';
import type { ThemePreference } from './theme.ts';

export type ViewId =
  | 'sources'
  | 'review'
  | 'entities'
  | 'economy'
  | 'states'
  | 'parameters'
  | 'scenario'
  | 'outcomes'
  | 'compare'
  | 'specpack';

export type VariantId = 'A' | 'B';

export interface PlanFile {
  path: string;
  kind: string;
  bytes: number;
  sha256: string;
  reason: string;
}
export interface Plan {
  files: PlanFile[];
  excluded: { path: string; reason: string }[];
  totalBytes: number;
  estimate?: { batches: number; requests: number; inputTokens: number };
}

export interface ServerState {
  mode: 'server';
  repo: string;
  model: GameModel | null;
  modelIssues: { severity: string; code: string; message: string }[];
  candidate: GameModel | null;
  report: unknown;
  ledger: ReviewLedger;
  plan: Plan | null;
  sources: string[];
  providers: { anthropic: boolean; agent: boolean; recorded: boolean };
  defaultProvider: string;
  busy: string | null;
}

export interface Scenario {
  seed: number;
  days: number;
  players: number;
  personas: string[];
}

export interface Notice {
  kind: 'info' | 'error' | 'success';
  text: string;
}

interface Store {
  mode: Mode;
  view: ViewId;
  theme: ThemePreference;
  notice?: Notice | undefined;
  busy?: string | undefined;
  server?: ServerState | undefined;
  /** The model the studio works on: the saved gamex/game-model.json, or an imported file. */
  model?: GameModel | undefined;
  /** Unsaved overrides per variant, by constant key. */
  variants: Record<VariantId, Params>;
  active: VariantId;
  scenario: Scenario;
  runs: Partial<Record<VariantId, { result: SimulationResult; params: Params; ms: number }>>;
  progress?: { done: number; total: number } | undefined;
  reachability?: ReachabilityReport | undefined;
  explore?: ExploreReport | undefined;
  sensitivity?: SensitivityResult | undefined;

  setView: (view: ViewId) => void;
  setTheme: (theme: ThemePreference) => void;
  notify: (notice: Notice | undefined) => void;
  refresh: () => Promise<void>;
  loadModel: (model: GameModel) => void;
  setParam: (key: string, value: number | undefined) => void;
  setActive: (v: VariantId) => void;
  copyVariant: (from: VariantId, to: VariantId) => void;
  setScenario: (patch: Partial<Scenario>) => void;
  simulate: (which: readonly VariantId[]) => Promise<void>;
  runExplore: () => Promise<void>;
  runSensitivity: () => Promise<void>;
  saveVariant: (v: VariantId) => Promise<void>;
  task: <T>(name: string, fn: () => Promise<T>) => Promise<T | undefined>;
}

const DEFAULT_SCENARIO: Scenario = { seed: 1, days: 7, players: 100, personas: [] };

function errorText(error: unknown): string {
  if (error instanceof ApiError)
    return error.hint === undefined ? error.message : `${error.message} ${error.hint}`;
  return error instanceof Error ? error.message : String(error);
}

export const useStudio = create<Store>((set, get) => ({
  mode: 'static',
  view: 'sources',
  theme: 'system',
  variants: { A: {}, B: {} },
  active: 'A',
  scenario: DEFAULT_SCENARIO,
  runs: {},

  setView: (view) => {
    set({ view });
  },
  setTheme: (theme) => {
    set({ theme });
  },
  notify: (notice) => {
    set({ notice });
  },

  async task(name, fn) {
    set({ busy: name, notice: undefined });
    try {
      return await fn();
    } catch (error) {
      set({ notice: { kind: 'error', text: errorText(error) } });
      return undefined;
    } finally {
      set({ busy: undefined, progress: undefined });
    }
  },

  async refresh() {
    if (get().mode !== 'server') return;
    const server = await api<ServerState>('GET', '/api/state');
    set({ server });
    const current = get().model;
    if (
      server.model !== null &&
      (current === undefined || JSON.stringify(current) !== JSON.stringify(server.model))
    ) {
      get().loadModel(server.model);
    }
  },

  loadModel(model) {
    set({
      model,
      variants: { A: {}, B: {} },
      runs: {},
      explore: undefined,
      sensitivity: undefined,
      reachability: undefined,
      scenario: { ...get().scenario, personas: model.personas.map((p) => p.id) },
    });
    void pool()
      .run((w) => w.reachability(model))
      .then((reachability) => {
        if (get().model === model) set({ reachability });
      })
      .catch(() => undefined);
  },

  setParam(key, value) {
    const { active, variants } = get();
    const next = Object.fromEntries(Object.entries(variants[active]).filter(([k]) => k !== key));
    if (value !== undefined) next[key] = value;
    set({ variants: { ...variants, [active]: next } });
  },
  setActive: (active) => {
    set({ active });
  },
  copyVariant(from, to) {
    const { variants } = get();
    set({ variants: { ...variants, [to]: { ...variants[from] } } });
  },
  setScenario(patch) {
    set({ scenario: { ...get().scenario, ...patch } });
  },

  async simulate(which) {
    const { model, scenario, variants } = get();
    if (model === undefined) return;
    await get().task('simulate', async () => {
      for (const v of which) {
        const params = cleanParams(model, variants[v]);
        const started = performance.now();
        const result = await pool().simulate(
          model,
          {
            seed: scenario.seed,
            days: scenario.days,
            playersPerPersona: scenario.players,
            ...(scenario.personas.length === model.personas.length
              ? {}
              : { personas: scenario.personas }),
            ...(Object.keys(params).length === 0 ? {} : { params }),
          },
          (done, total) => {
            set({ progress: { done, total } });
          },
        );
        set({
          runs: {
            ...get().runs,
            [v]: { result, params, ms: Math.round(performance.now() - started) },
          },
        });
      }
      set({ notice: { kind: 'success', text: `Simulated ${which.join(' and ')}.` } });
    });
  },

  async runExplore() {
    const { model, active, variants } = get();
    if (model === undefined) return;
    const m = applyParams(model, cleanParams(model, variants[active]));
    const explore = await get().task('explore', () => pool().run((w) => w.explore(m)));
    if (explore !== undefined) set({ explore });
  },

  async runSensitivity() {
    const { model, scenario, active, variants } = get();
    if (model === undefined) return;
    const m = applyParams(model, cleanParams(model, variants[active]));
    const sensitivity = await get().task('sensitivity', () =>
      pool().run((w) =>
        w.sensitivity(m, {
          seed: scenario.seed,
          days: scenario.days,
          playersPerPersona: Math.min(scenario.players, 40),
        }),
      ),
    );
    if (sensitivity !== undefined) set({ sensitivity });
  },

  async saveVariant(v) {
    const { model, variants, mode } = get();
    if (model === undefined) return;
    const next = applyParams(model, cleanParams(model, variants[v]));
    const check = validateGameModel(next);
    if (!check.ok) {
      set({
        notice: {
          kind: 'error',
          text: `Variant ${v} makes the model invalid: ${check.issues[0]?.message ?? ''}`,
        },
      });
      return;
    }
    if (mode === 'server') {
      const r = await get().task('save', () =>
        api<{ modelVersion: number }>('PUT', '/api/model', { model: next }),
      );
      if (r === undefined) return;
      await get().refresh();
      set({
        notice: {
          kind: 'success',
          text: `Saved variant ${v} to gamex/game-model.json (version ${String(r.modelVersion)}).`,
        },
      });
    } else {
      get().loadModel(next);
      set({
        notice: {
          kind: 'success',
          text: `Variant ${v} is now the working model (export it from Sources).`,
        },
      });
    }
  },
}));
