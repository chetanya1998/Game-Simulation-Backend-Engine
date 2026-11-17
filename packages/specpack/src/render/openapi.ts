import { idToKey } from '@gamex/model';
import type { CompiledModel, CVariable } from '@gamex/engine';
import { GENERATED_HEADER, type FileMap } from './common.js';
import { errorCodesOf, isRewarded, isStore } from './model-facts.js';
import { toYaml } from './yaml.js';

function valueSchema(
  v: CVariable,
  enumValues: readonly string[] | undefined,
): Record<string, unknown> {
  switch (v.type) {
    case 'int':
      return {
        type: 'integer',
        ...(v.min === undefined ? {} : { minimum: v.min }),
        ...(v.max === undefined ? {} : { maximum: v.max }),
      };
    case 'number':
    case 'timestamp':
      return { type: 'number' };
    case 'bool':
      return { type: 'boolean' };
    case 'enum':
      return { type: 'string', enum: [...(enumValues ?? [])] };
    default:
      return {};
  }
}

/** gamex/backend/openapi.yaml — the economy endpoints every player-facing action needs. */
export function renderOpenApi(c: CompiledModel, files: FileMap): void {
  const m = c.model;
  const enumOf = (key: string): readonly string[] | undefined =>
    m.variables.find((v) => idToKey(v.id) === key)?.enumValues;
  const stateProps: Record<string, unknown> = {
    screen: { type: 'string', enum: [...c.states.keys()] },
  };
  for (const r of c.resources.values())
    stateProps[r.key] = {
      type: 'integer',
      minimum: 0,
      ...(r.cap === undefined ? {} : { maximum: r.cap }),
    };
  for (const v of c.variables.values()) stateProps[v.key] = valueSchema(v, enumOf(v.key));

  const paths: Record<string, unknown> = {
    '/players/{playerId}/state': {
      get: {
        operationId: 'getPlayerState',
        summary: 'Current wallet, progress and counters of a player',
        parameters: [{ $ref: '#/components/parameters/PlayerId' }],
        responses: {
          '200': {
            description: 'Player state',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/PlayerState' } },
            },
          },
        },
      },
    },
    '/balance': {
      get: {
        operationId: 'getBalance',
        summary: 'All tunables (the contents of gamex/balance/*.json)',
        responses: {
          '200': {
            description: 'Balance values by key',
            content: {
              'application/json': { schema: { type: 'object', additionalProperties: true } },
            },
          },
        },
      },
    },
  };
  for (const a of c.actions.values()) {
    const body: Record<string, unknown> = {};
    const required: string[] = [];
    if (a.outcomes !== undefined) {
      body['outcome'] = {
        type: 'string',
        enum: a.outcomes.map((o) => o.id),
        description: 'Result reported by the game client; validated server-side.',
      };
      required.push('outcome');
    }
    if (isRewarded(a)) {
      body['adVerification'] = { $ref: '#/components/schemas/AdVerification' };
      required.push('adVerification');
    }
    if (isStore(a)) {
      body['receipt'] = { $ref: '#/components/schemas/StoreReceipt' };
      required.push('receipt');
    }
    const errors = errorCodesOf(a);
    paths[`/players/{playerId}/actions/${a.id}`] = {
      post: {
        operationId: idToKey(a.id),
        summary: m.actions.find((x) => x.id === a.id)?.name ?? a.id,
        description: `Runs action "${a.id}" server-side. Rules: gamex/backend/RULES.md. Golden cases: gamex/tests/golden/action-${a.id}.json.`,
        parameters: [
          { $ref: '#/components/parameters/PlayerId' },
          { $ref: '#/components/parameters/IdempotencyKey' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', additionalProperties: false, properties: body, required },
            },
          },
        },
        responses: {
          '200': {
            description: 'Action applied',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ActionResult' } },
            },
          },
          '409': {
            description: 'Action rejected by a rule',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['result', 'error'],
                  properties: {
                    result: { const: 'rejected' },
                    error:
                      errors.length === 0 ? { type: 'string' } : { type: 'string', enum: errors },
                  },
                },
              },
            },
          },
        },
      },
    };
  }
  for (const p of c.placements.values()) {
    if (p.triggerState === undefined) continue;
    paths[`/players/{playerId}/placements/${p.id}/eligibility`] = {
      get: {
        operationId: `${idToKey(p.id)}Eligibility`,
        summary: `Whether ${p.format} placement "${p.id}" may be shown now`,
        parameters: [{ $ref: '#/components/parameters/PlayerId' }],
        responses: {
          '200': {
            description: 'Eligibility',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Eligibility' } },
            },
          },
        },
      },
    };
  }

  const doc = {
    openapi: '3.1.0',
    info: {
      title: `${m.meta.name} economy API`,
      version: `${String(m.meta.modelVersion)}.0.0`,
      description: `Server-authoritative economy of ${m.meta.name}, generated from gamex/game-model.json. ${GENERATED_HEADER}.`,
    },
    paths,
    components: {
      parameters: {
        PlayerId: { name: 'playerId', in: 'path', required: true, schema: { type: 'string' } },
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          description: 'Retries with the same key return the first response and never apply twice.',
          schema: { type: 'string', minLength: 8 },
        },
      },
      schemas: {
        PlayerState: { type: 'object', additionalProperties: false, properties: stateProps },
        Deltas: {
          type: 'object',
          description: 'Numbers: change; other values: new value.',
          additionalProperties: { type: ['number', 'boolean', 'string'] },
        },
        ActionResult: {
          type: 'object',
          required: ['result', 'deltas', 'state'],
          properties: {
            result: { const: 'ok' },
            outcome: { type: 'string' },
            deltas: { $ref: '#/components/schemas/Deltas' },
            state: { $ref: '#/components/schemas/PlayerState' },
          },
        },
        Eligibility: {
          type: 'object',
          required: ['eligible'],
          properties: { eligible: { type: 'boolean' }, reason: { type: 'string' } },
        },
        AdVerification: {
          type: 'object',
          required: ['network', 'token'],
          description:
            'Server-side verification (SSV) of a completed rewarded video. Each token is accepted once.',
          properties: { network: { type: 'string' }, token: { type: 'string' } },
        },
        StoreReceipt: {
          type: 'object',
          required: ['store', 'receipt'],
          properties: {
            store: { type: 'string', enum: ['app-store', 'google-play'] },
            receipt: { type: 'string' },
          },
        },
      },
    },
  };
  files.set('gamex/backend/openapi.yaml', {
    ownership: 'generated',
    content: toYaml(doc, GENERATED_HEADER),
  });
}
