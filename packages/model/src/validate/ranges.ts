import { evalCurve, type Curve } from '../curves.js';
import type { Distribution, GameModel } from '../schema/game-model.js';
import type { IssueCollector, Path } from './collector.js';

function checkCurve(curve: Curve, path: Path, ref: string, issues: IssueCollector): void {
  if (curve.min !== undefined && curve.max !== undefined && curve.min > curve.max) {
    issues.error(
      'CURVE_RANGE',
      [...path, 'min'],
      `Curve min (${String(curve.min)}) is greater than max (${String(curve.max)})`,
      { nodeRef: ref },
    );
  }
  if (curve.type === 'piecewise') {
    const segments = curve.params.segments;
    segments.forEach((s, i) => {
      const segPath = [...path, 'params', 'segments', i];
      const isLast = i === segments.length - 1;
      if (isLast && s.upTo !== undefined) {
        issues.error(
          'CURVE_PIECEWISE_OPEN_END',
          [...segPath, 'upTo'],
          'The last piecewise segment must not have "upTo" (it covers every remaining tier)',
          { nodeRef: ref },
        );
      }
      if (!isLast && s.upTo === undefined) {
        issues.error(
          'CURVE_PIECEWISE_ORDER',
          segPath,
          'Only the last piecewise segment may omit "upTo"',
          { nodeRef: ref },
        );
      }
      const prev = segments[i - 1]?.upTo;
      if (s.upTo !== undefined && prev !== undefined && s.upTo <= prev) {
        issues.error(
          'CURVE_PIECEWISE_ORDER',
          [...segPath, 'upTo'],
          `Segment upTo values must increase (${String(prev)} then ${String(s.upTo)})`,
          { nodeRef: ref },
        );
      }
      checkCurve(s.curve, [...segPath, 'curve'], ref, issues);
    });
    return;
  }
  const from = curve.params.from ?? 1;
  const first = evalCurve(curve, from);
  if (!first.ok)
    issues.error(
      'CURVE_NOT_EVALUABLE',
      path,
      `Curve cannot be evaluated at its first tier ${String(from)}: ${first.error}`,
      { nodeRef: ref },
    );
}

function checkDistribution(d: Distribution, path: Path, ref: string, issues: IssueCollector): void {
  const lo = d.type === 'uniform' ? d.min : 'min' in d ? d.min : undefined;
  const hi = d.type === 'uniform' ? d.max : 'max' in d ? d.max : undefined;
  if (lo !== undefined && hi !== undefined && lo > hi) {
    issues.error(
      'DISTRIBUTION_RANGE',
      [...path, 'min'],
      `Distribution min (${String(lo)}) is greater than max (${String(hi)})`,
      { nodeRef: ref },
    );
  }
}

/** Layer 5: values sit inside their declared ranges; curves, variables and personas are well formed. */
export function checkRanges(model: GameModel, issues: IssueCollector): void {
  model.constants.forEach((c, i) => {
    const ref = `const:${c.id}`;
    const path = ['constants', i];
    if (c.min !== undefined && c.max !== undefined && c.min > c.max) {
      issues.error(
        'CONSTANT_RANGE',
        [...path, 'min'],
        `min (${String(c.min)}) is greater than max (${String(c.max)})`,
        { nodeRef: ref, hint: 'Swap min and max.' },
      );
      return;
    }
    if (typeof c.value === 'number') {
      if (c.min !== undefined && c.value < c.min) {
        issues.error(
          'CONSTANT_OUT_OF_RANGE',
          [...path, 'value'],
          `value ${String(c.value)} is below min ${String(c.min)}`,
          { nodeRef: ref, hint: 'Change the value or widen the range.' },
        );
      }
      if (c.max !== undefined && c.value > c.max) {
        issues.error(
          'CONSTANT_OUT_OF_RANGE',
          [...path, 'value'],
          `value ${String(c.value)} is above max ${String(c.max)}`,
          { nodeRef: ref, hint: 'Change the value or widen the range.' },
        );
      }
      if (c.integer === true && !Number.isInteger(c.value)) {
        issues.error(
          'CONSTANT_NOT_INTEGER',
          [...path, 'value'],
          `value ${String(c.value)} must be an integer`,
          { nodeRef: ref },
        );
      }
    } else {
      checkCurve(c.value, [...path, 'value'], ref, issues);
    }
    if (c.step !== undefined && c.min !== undefined && c.max !== undefined) {
      const steps = (c.max - c.min) / c.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        issues.error(
          'CONSTANT_STEP',
          [...path, 'step'],
          `step ${String(c.step)} does not divide the range ${String(c.min)}…${String(c.max)} evenly`,
          {
            nodeRef: ref,
            hint: 'Sliders and sweeps need (max − min) to be a whole number of steps.',
          },
        );
      }
    }
  });

  model.resources.forEach((r, i) => {
    if (r.cap !== undefined && r.starting > r.cap) {
      issues.error(
        'RESOURCE_START_ABOVE_CAP',
        ['resources', i, 'starting'],
        `starting value ${String(r.starting)} is above the cap ${String(r.cap)}`,
        { nodeRef: `res:${r.id}` },
      );
    }
  });

  model.variables.forEach((v, i) => {
    const ref = `var:${v.id}`;
    const path = ['variables', i];
    const expected = v.type === 'bool' ? 'boolean' : v.type === 'enum' ? 'string' : 'number';
    if (typeof v.initial !== expected) {
      issues.error(
        'VARIABLE_INITIAL_TYPE',
        [...path, 'initial'],
        `initial value ${JSON.stringify(v.initial)} does not match type "${v.type}"`,
        { nodeRef: ref },
      );
    }
    if (v.type === 'enum') {
      if (v.enumValues === undefined || v.enumValues.length === 0) {
        issues.error(
          'VARIABLE_ENUM_VALUES',
          [...path, 'type'],
          'enum variables need "enumValues"',
          { nodeRef: ref },
        );
      } else if (typeof v.initial === 'string' && !v.enumValues.includes(v.initial)) {
        issues.error(
          'VARIABLE_INITIAL_TYPE',
          [...path, 'initial'],
          `initial value "${v.initial}" is not one of enumValues`,
          { nodeRef: ref },
        );
      }
    } else if (v.enumValues !== undefined) {
      issues.warning(
        'VARIABLE_ENUM_VALUES',
        [...path, 'enumValues'],
        `enumValues is ignored for type "${v.type}"`,
        { nodeRef: ref },
      );
    }
    if (v.type === 'int' && typeof v.initial === 'number' && !Number.isInteger(v.initial)) {
      issues.error(
        'VARIABLE_INITIAL_TYPE',
        [...path, 'initial'],
        `initial value ${String(v.initial)} must be an integer`,
        { nodeRef: ref },
      );
    }
    if (
      typeof v.initial === 'number' &&
      ((v.min !== undefined && v.initial < v.min) || (v.max !== undefined && v.initial > v.max))
    ) {
      issues.error(
        'VARIABLE_OUT_OF_RANGE',
        [...path, 'initial'],
        `initial value ${String(v.initial)} is outside ${String(v.min ?? '-∞')}…${String(v.max ?? '∞')}`,
        { nodeRef: ref },
      );
    }
  });

  model.personas.forEach((p, i) => {
    const ref = `persona:${p.id}`;
    checkDistribution(p.sessionsPerDay, ['personas', i, 'sessionsPerDay'], ref, issues);
    checkDistribution(p.sessionLengthSeconds, ['personas', i, 'sessionLengthSeconds'], ref, issues);
    checkDistribution(p.skill, ['personas', i, 'skill'], ref, issues);
  });
  if (model.personas.length > 0) {
    const total = model.personas.reduce((sum, p) => sum + p.share, 0);
    if (Math.abs(total - 1) > 1e-9) {
      issues.error(
        'PERSONA_SHARES',
        ['personas'],
        `persona shares add up to ${String(Math.round(total * 1e6) / 1e6)}, not 1`,
        {
          hint: 'Shares are fractions of the simulated population.',
        },
      );
    }
  }
}
