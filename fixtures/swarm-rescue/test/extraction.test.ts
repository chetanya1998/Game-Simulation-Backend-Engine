import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleCandidate, promote, RecordedProvider, runExtraction } from '@gamex/extract';
import { discoverInputs, readChunks } from '@gamex/ingest';
import { validateGameModel, type GameModel } from '@gamex/model';
import { beforeAll, describe, expect, it } from 'vitest';

const here = new URL('../', import.meta.url).pathname;
const SAMPLE = join(here, 'sample-repo');
const RECORDINGS = join(here, 'recordings');
const handModel = JSON.parse(
  readFileSync(join(here, 'swarm-rescue.game-model.json'), 'utf8'),
) as GameModel;
const CANARIES = [
  'planted-canary',
  'PLANTED-SSH-KEY',
  'PLANTED-PEM',
  'Zq8vR2xLm4Tn7Wp3Ys6Kd9Fh1Jb5Gc0',
];

/** The sample repo plus planted secrets of every kind the deny-list and the secret scan cover. */
function plantedRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gamex-swarm-'));
  cpSync(SAMPLE, dir, { recursive: true });
  mkdirSync(join(dir, '.ssh'));
  writeFileSync(
    join(dir, '.ssh', 'id_rsa'),
    '-----BEGIN OPENSSH PRIVATE KEY-----\nPLANTED-SSH-KEY\n-----END OPENSSH PRIVATE KEY-----\n',
  );
  writeFileSync(
    join(dir, 'config', 'store.pem'),
    '-----BEGIN CERTIFICATE-----\nPLANTED-PEM\n-----END CERTIFICATE-----\n',
  );
  writeFileSync(
    join(dir, 'config', 'analytics-config.yaml'),
    'apiToken: "Zq8vR2xLm4Tn7Wp3Ys6Kd9Fh1Jb5Gc0"\n',
  );
  return dir;
}

describe('Swarm Rescue extraction from recorded answers', () => {
  const provider = RecordedProvider.fromDirectory(RECORDINGS);
  let candidate: ReturnType<typeof assembleCandidate>;
  const sampleEnv = readFileSync(join(SAMPLE, '.env'), 'utf8');

  beforeAll(async () => {
    const chunks = await readChunks(discoverInputs(plantedRepo()));
    const run = await runExtraction(chunks, provider);
    candidate = assembleCandidate(run.outputs, chunks);
  });

  it('never puts a planted secret into any request', () => {
    expect(provider.requests.map((r) => r.id)).toEqual([
      'inventory#1',
      'flow#1',
      'monetization#1',
      'gaps#1',
    ]);
    const sent = provider.requests
      .map((r) => `${r.system}\n${r.documents}\n${r.instructions}`)
      .join('\n');
    for (const canary of [...CANARIES, sampleEnv.trim()]) expect(sent).not.toContain(canary);
    expect(sent).not.toMatch(/BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)/);
    expect(provider.requests[0]?.documents).toMatch(/<chunk id="docs\/GDD\.md#L129-172"/);
  });

  it('produces a valid candidate with every quote verified', () => {
    const result = validateGameModel(candidate.model);
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(candidate.report.unverified).toEqual([]);
    expect(candidate.report.valueMismatches).toEqual([]);
    expect(candidate.report.dropped).toEqual([]);
    expect(candidate.report.conflicts).toEqual([]);
  });

  it('recovers every placement with provenance on the right GDD lines', () => {
    const placements = candidate.model.monetization.placements;
    const byFormat = (f: string) => placements.filter((p) => p.format === f).map((p) => p.id);
    expect(byFormat('rewarded')).toHaveLength(5);
    expect(byFormat('interstitial')).toEqual(['interstitial-after-victory']);
    expect(byFormat('banner')).toEqual([
      'banner-home',
      'banner-campaign-map',
      'banner-armory',
      'banner-settings',
      'billboard-in-world',
    ]);
    expect(byFormat('mrec')).toEqual(['mrec-pause', 'mrec-victory', 'mrec-defeat']);
    expect(byFormat('iap')).toEqual(['iap-remove-ads']);
    for (const p of placements) {
      const expected = handModel.monetization.placements.find((h) => h.id === p.id)?.provenance;
      expect(p.provenance, p.id).toMatchObject({
        source: 'docs/GDD.md',
        location: expected?.location,
        confidence: 'high',
      });
    }
    expect(placements.find((p) => p.id === 'rewarded-revive')?.provenance.location).toBe(
      '§7.1 / line 136',
    );
  });

  it('recovers the interstitial and revive rules', () => {
    const interstitial = candidate.model.monetization.placements.find(
      (p) => p.id === 'interstitial-after-victory',
    );
    expect(interstitial).toMatchObject({
      eligibility: ['lastMissionResult == "victory"', 'missionLevel >= interstitialMinLevel'],
      caps: [{ max: 'interstitialMaxPerMission', per: 'mission' }],
      cooldownSeconds: 'interstitialMinGapSeconds',
    });
    expect(
      candidate.model.rules.find((r) => r.id === 'no-interstitial-after-defeat')?.provenance
        .location,
    ).toBe('§7.2 / line 151');
    const revive = candidate.model.actions.find((a) => a.id === 'revive');
    expect(revive?.limits).toEqual([
      { max: 'maxRevivesPerMission', per: 'mission', errorCode: 'REVIVE_LIMIT_REACHED' },
    ]);
    const invariants = candidate.model.invariants.map((i) => i.id);
    expect(invariants).toEqual(
      expect.arrayContaining([
        'interstitial-min-gap',
        'interstitial-never-after-defeat',
        'revive-max-once-per-mission',
      ]),
    );
  });

  it('prefers config and code values, keeping the design document as provenance of the rest', () => {
    const c = (id: string) => candidate.model.constants.find((x) => x.id === id)?.provenance;
    expect(c('interstitial-min-gap-seconds')).toMatchObject({
      source: 'config/economy.json',
      location: 'line 16',
      excerpt: '"minGapSeconds": 180',
    });
    expect(c('max-revives-per-mission')).toMatchObject({
      source: 'config/economy.json',
      status: 'detected',
    });
    expect(c('laser-damage')).toMatchObject({ source: 'src/Tuning.cs', status: 'assumed' });
    expect(c('reroll-discount')).toMatchObject({ source: 'gamex:assumed' });
  });

  it('reports the expected gaps', () => {
    const gaps = candidate.model.gaps.map((g) => g.id);
    expect(gaps).toEqual(
      expect.arrayContaining([
        'gap-web-build',
        'gap-age-rating-coppa',
        'gap-mediation-stack',
        'gap-iap-beyond-remove-ads',
        'gap-currency-and-upgrade-costs',
        'gap-personas',
        'gap-ad-revenue-assumptions',
      ]),
    );
    expect(candidate.model.gaps.find((g) => g.id === 'gap-age-rating-coppa')).toMatchObject({
      blocking: true,
      provenance: { location: '§9 / line 194' },
    });
  });

  it('promotes to a valid model with accept-all decisions', () => {
    const { model, summary, issues } = promote(candidate.model, {
      version: 1,
      default: 'approve',
      decisions: [],
    });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(summary).toMatchObject({ rejected: 0, pending: [], cascaded: [] });
    expect(model.monetization.placements.every((p) => p.provenance.status !== 'detected')).toBe(
      true,
    );
  });

  it('rejecting a placement removes what depends on it', () => {
    const { model, summary } = promote(candidate.model, {
      version: 1,
      default: 'approve',
      decisions: [{ ref: 'placement:interstitial-after-victory', decision: 'reject' }],
    });
    expect(model.monetization.placements.map((p) => p.id)).not.toContain(
      'interstitial-after-victory',
    );
    expect(summary.cascaded.map((d) => d.ref)).toEqual(
      expect.arrayContaining(['inv:interstitial-min-gap']),
    );
    expect(validateGameModel(model).ok).toBe(true);
  });
});

describe('Swarm Rescue extraction after a studio upload (gamex/sources/GDD.md)', () => {
  it('replays the upload recordings and cites the uploaded file', async () => {
    const { uploadScenarioRepo } = await import('../../scripts/scenarios.ts');
    const repo = uploadScenarioRepo();
    const chunks = await readChunks(discoverInputs(repo));
    expect(chunks.map((c) => c.path)).toContain('gamex/sources/GDD.md');
    const run = await runExtraction(
      chunks,
      RecordedProvider.fromDirectory(join(here, 'recordings-upload')),
    );
    const { model, report } = assembleCandidate(run.outputs, chunks);
    expect(report.unverified).toEqual([]);
    expect(
      model.monetization.placements.find((p) => p.id === 'rewarded-revive')?.provenance,
    ).toMatchObject({
      source: 'gamex/sources/GDD.md',
      location: '§7.1 / line 136',
    });
  });
});
