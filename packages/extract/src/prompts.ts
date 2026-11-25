import type { Chunk } from '@gamex/ingest';
import type { PassName } from './schemas.js';

export const PROMPT_VERSION = '1';

export const SYSTEM_PROMPT = `You read a mobile game's design documents and source files and propose items for its Game Model: a structured, simulatable description of the game. Your output is reviewed by a designer and checked by deterministic code, so accuracy and traceability matter more than completeness.

Rules:
- Propose only what the documents state or directly imply. Never invent numbers. When a value the model needs is not stated, either leave it out or propose it with "assumed": true and the closest stated placeholder.
- Every item cites evidence: the chunk id exactly as shown in a <chunk id="..."> tag, and a quote copied character for character from that chunk (a single line or sentence, at most 200 characters). Do not paraphrase quotes.
- If the same value appears in several sources (e.g. the design document and a config file or code), emit one proposal per source with the same id, each with its own evidence. Do not reconcile conflicting values yourself.
- Mark items "assumed": true when the source marks them as placeholders ("[ASSUMED]", "TBD", "placeholder", "not yet decided").
- Ids are kebab-case (lowercase words joined by hyphens, starting with a letter). The key of an id is its camelCase form: "max-revives-per-mission" → "maxRevivesPerMission". Screens use their designer code in the id when one exists: "S07 Laser Trial" → "s07-laser-trial".
- References are "<prefix>:<id>" with prefixes ent, res, const, var, action, rule, state, transition, placement, kpi, inv, gap.

Expressions are short formulas evaluated by a deterministic interpreter:
- Identifiers are keys of constants, variables and resources; built-ins are now (simulated seconds), state and prevState (screen ids as strings), persona.skill, persona.churnSensitivity.
- Operators: + - * / %, < <= > >= == !=, && || !, cond ? a : b. Strings are double-quoted ("victory"). Functions: min, max, clamp, abs, floor, ceil, round, curve(curveKey, n), eligible("placement-id").
- Preconditions, guards, eligibility, rules and invariants are boolean; amounts, weights and limits are numbers.
- Limits ("max 1 per mission", "3 per day") are written as limits/caps, not as hand-made counters; cooldowns ("at least 180 seconds apart") as cooldownSeconds.

Game Model concepts:
- constants: every tunable number (rewards, costs, limits, pacing, stats), with a unit and a balance file group. Values that depend on a tier or level are curves.
- variables: state that changes during play, with a scope saying when it resets (mission, session, day; player = never).
- actions: what the player, the system, the ad SDK or the store can do, with preconditions, costs, effects, limits, cooldowns and random outcomes (mission win/lose).
- states and transitions: the screen flow. A transition is triggered by "ui" (the player taps), "auto" (as soon as its guard holds) or an action (with the outcome it follows). Use beginsMission/endsMission at mission boundaries.
- placements: ad and IAP placements with format (rewarded, interstitial, banner, mrec, iap, offerwall), trigger (an action for rewarded/IAP, a state for interstitial/banner/MREC), eligibility, caps, cooldown and reward.
- rules: extra guards checked before actions run or placements are shown. invariants: properties that must always hold during play.
- gaps: open questions, missing decisions, contradictions and assumptions.`;

export interface PassContext {
  /** One line per item already proposed in earlier passes, e.g. "const:max-revives-per-mission (maxRevivesPerMission) = 1". */
  readonly known: readonly string[];
}

const INSTRUCTIONS: Record<PassName, string> = {
  inventory: `Pass 1 of 4 — inventory. Propose meta (name, genre, platforms, target markets), entities (heroes, enemies, bosses, NPCs, items, mechanics), resources (currencies and countable things), constants (every number: rewards, costs, limits, caps, cooldowns, levels, stats, prices, curves) and variables (game state the rules need: current mission level, last mission result, flags such as purchases, upgrade tiers). Prefer the values in config files and code when they exist, but still emit the design-document proposal as well (same id) so differences can be reviewed.`,
  flow: `Pass 2 of 4 — flow. Propose the screens (states) with their kind, the transitions between them (including returns from overlays and auto transitions after ads), the initial state, and the actions (missions with win/lose outcomes, rewarded-ad completions, purchases, upgrades, chests) with preconditions, costs, effects, limits and cooldowns. Use the constants and variables listed under "Known items" by their keys; when the flow needs one that is not known yet, add it to constants/variables.`,
  monetization: `Pass 3 of 4 — monetization. Propose every ad and IAP placement (one per screen or trigger where it appears), the rules that guard placements and actions (pacing, level gates, "never after X", purchases that remove ads), invariants that must always hold during play (e.g. "an interstitial is never shown after a defeat"), and the screens where UI ads are forbidden. Use the known keys and ids; add missing constants/variables to constants/variables.`,
  gaps: `Pass 4 of 4 — gaps. List the open questions the documents raise or leave open: missing decisions, ambiguities, contradictions between sources, and placeholder values that need a real number (group related placeholders into one gap). Relate each gap to the known items it concerns. Mark a gap blocking when a design, legal or monetization decision cannot be made without the answer.`,
};

/** The documents block: shared by every pass, so it is cached. */
export function renderDocuments(chunks: readonly Chunk[]): string {
  const parts = chunks.map((c) => {
    const attrs = [
      `id="${c.id}"`,
      `path="${c.path}"`,
      `kind="${c.kind}"`,
      c.page === undefined
        ? `lines="${String(c.startLine)}-${String(c.endLine)}"`
        : `page="${String(c.page)}"`,
      ...(c.heading === undefined ? [] : [`heading="${c.heading.replaceAll('"', "'")}"`]),
    ];
    return `<chunk ${attrs.join(' ')}>\n${c.text}\n</chunk>`;
  });
  return `<documents>\n${parts.join('\n')}\n</documents>`;
}

export function renderInstructions(pass: PassName, context: PassContext): string {
  const known =
    context.known.length === 0
      ? ''
      : `\n\nKnown items (from earlier passes; reference them, do not repeat them):\n${context.known.join('\n')}`;
  return `${INSTRUCTIONS[pass]}${known}\n\nReturn JSON matching the response schema.`;
}
