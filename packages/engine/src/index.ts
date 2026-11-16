export { ENGINE_VERSION, SUPPORTED_SCHEMA_VERSION } from './version.js';
export { Rng, deriveSeed, mix32 } from './random.js';
export { LN2, dexp, dlog } from './dmath.js';
export { poisson, sample, standardNormal } from './distributions.js';
export { mean, percentileSorted, round6, summarize } from './stats.js';
export type { Summary } from './stats.js';
export { EngineModelError, EngineRuntimeError } from './errors.js';
export { compileModel } from './compile.js';
export type {
  CAction,
  CEffect,
  CExpr,
  COutcome,
  CPlacement,
  CRule,
  CState,
  CTransition,
  CompileOptions,
  CompiledModel,
} from './compile.js';
export {
  DEFAULT_PERSONA,
  controlKey,
  createWorld,
  envOf,
  evalBool,
  evalNum,
  evalValue,
  initialValues,
  placementEligibility,
  resetScope,
  worldKey,
} from './world.js';
export type { CreateWorldOptions, PersonaTraits, WorldState } from './world.js';
export {
  applyAction,
  availableOptions,
  checkAction,
  checkInvariantsAt,
  diffValues,
  guardHolds,
  perform,
  settle,
} from './step.js';
export type {
  ActionResult,
  Check,
  Deltas,
  EngineEvent,
  InvariantViolation,
  StepOption,
  StepOptions,
  StepResult,
} from './step.js';
export { distancesTo, successors } from './graph.js';
export { DEFAULT_POLICY_WEIGHTS, chooseOption, createPolicyContext } from './policy.js';
export type { Intent, PolicyContext, PolicyWeights } from './policy.js';
export {
  DEFAULT_CHURN,
  SECONDS_PER_DAY,
  simulatePlayer,
  simulatePlayers,
  resolveOptions,
} from './simulate.js';
export type {
  ChurnOptions,
  DaySnapshot,
  Evidence,
  PlayerSummary,
  SimulationOptions,
  TraceEvent,
} from './simulate.js';
export { aggregateResults, runSimulation } from './results.js';
export { analyzeReachability } from './reachability.js';
export type {
  ReachabilityIssue,
  ReachabilityOptions,
  ReachabilityReport,
  WitnessStep,
} from './reachability.js';
export { abstractEnvFor, abstractEval, neverTrue } from './intervals.js';
export type { Abstract, AbstractEnv } from './intervals.js';
export type {
  DailyAggregate,
  Finding,
  InvariantResult,
  KpiResult,
  PersonaResult,
  RunRecord,
  SimulationResult,
} from './results.js';
export { replay, searchExploits } from './exploit.js';
export type { ExploitFinding, ExploitOptions, ExploitReport } from './exploit.js';
export { gridSweep, latinHypercubeSweep, sensitivity, snap } from './sweep.js';
export type { SensitivityEntry, SensitivityResult, SweepResult, SweepRow } from './sweep.js';
export { checkPlacementSafety, explore } from './explore.js';
export type { ExploreReport, PlacementSafety } from './explore.js';
