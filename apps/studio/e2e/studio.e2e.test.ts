import { execFileSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FIXTURES,
  OUTPUT,
  STUDIO_DIST,
  contrast,
  ensureBuilt,
  gameRepo,
  gamex,
  offline,
  serveStatic,
  startStudio,
  watchErrors,
} from './helpers.ts';

let browser: Browser;
beforeAll(async () => {
  ensureBuilt();
  browser = await chromium.launch();
});
afterAll(() => browser.close());

const view = (page: Page, name: string) => page.click(`nav >> text=${name}`);

describe('gamex studio (local server)', () => {
  let proc: ChildProcess | undefined;
  afterAll(() => {
    proc?.kill();
  });

  it('goes from upload to a written Spec Pack without the CLI, offline, with results equal to the CLI', async () => {
    const repo = gameRepo();
    const studio = await startStudio(repo, ['--recordings', join(FIXTURES, 'recordings-upload')]);
    proc = studio.proc;
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      acceptDownloads: true,
    });
    const blocked = await offline(context, studio.origin);
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(studio.url);
    await page.getByText('local server').waitFor();
    expect(page.url()).not.toContain('token='); // the token leaves the address bar

    // 1. Upload & sources
    await page.setInputFiles(
      'input[aria-label="Upload design documents"]',
      join(FIXTURES, 'GDD.md'),
    );
    await page.getByText('Uploaded GDD.md').waitFor();
    expect(readFileSync(join(repo, 'gamex/sources/GDD.md'), 'utf8')).toBe(
      readFileSync(join(FIXTURES, 'GDD.md'), 'utf8'),
    );
    await page.getByRole('button', { name: 'Scan repository' }).click();
    const table = page.getByRole('table', { name: 'Files to send' });
    await table.waitFor();
    expect(await table.locator('tbody tr td:first-child').allTextContents()).toEqual([
      'README.md',
      'gamex/sources/GDD.md',
      'config/economy.json',
      'src/Tuning.cs',
    ]);
    await page.getByText('Excluded (').click();
    await page.getByText('denied: environment file').waitFor();
    await page.getByRole('button', { name: /Confirm these 4 files/ }).click();
    await page.getByText('Confirmed 4 files.').waitFor();
    await page.selectOption('select[aria-label="Extraction provider"]', 'recorded');
    await page.getByRole('button', { name: 'Extract candidate model' }).click();

    // 2. Review: approve all
    await page.getByText('208 items').waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Approve all undecided' }).click();
    await page.getByText('208 approved').waitFor();
    await page.getByRole('button', { name: 'Save review' }).click();
    await page.getByText(/Saved: 208 approved/).waitFor({ timeout: 60_000 });
    expect(
      (
        JSON.parse(readFileSync(join(repo, 'gamex/review.json'), 'utf8')) as {
          decisions: unknown[];
        }
      ).decisions,
    ).toHaveLength(208);

    // 3–5. Graph views render
    await view(page, 'Entity map');
    await page.locator('.react-flow__node').first().waitFor();
    await view(page, 'Economy');
    await page.locator('.react-flow__node').first().waitFor();
    await view(page, 'State machine');
    await page.getByText('every screen reachable').waitFor({ timeout: 30_000 });
    await page.locator('.react-flow__node').nth(21).waitFor();
    expect(await page.locator('.react-flow__node').count()).toBe(22);

    // 6. Parameters: change a constant on variant B with its slider
    await view(page, 'Parameters');
    await page.getByRole('radio', { name: /Variant B/ }).click();
    const slider = page.locator('input[aria-label="interstitialMinGapSeconds slider"]');
    await slider.focus();
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
    const gap = Number(
      await page.locator('input[aria-label="interstitialMinGapSeconds value"]').inputValue(),
    );
    expect(gap).toBe(240);
    await page.getByRole('radio', { name: 'Variant B (1 changed)' }).waitFor();

    // 7. Scenario: run A and B in the worker pool
    await view(page, 'Scenario');
    await page.fill('input[aria-label="Players per persona"]', '24');
    await page.fill('input[aria-label="Days"]', '3');
    await page.getByRole('button', { name: 'Run A and B' }).click();
    await page.locator('[data-testid=hash-B]').waitFor({ timeout: 120_000 });
    const hashA = await page.locator('[data-testid=hash-A]').textContent();
    const hashB = await page.locator('[data-testid=hash-B]').textContent();
    const cli = (extra: string[]) =>
      (
        JSON.parse(
          gamex([
            'sim',
            '--cwd',
            repo,
            '--seed',
            '1',
            '--days',
            '3',
            '--players',
            '24',
            '--json',
            ...extra,
          ]),
        ) as { data: { record: { outputHash: string } } }
      ).data.record.outputHash;
    expect(hashA).toBe(cli([]));
    expect(hashB).toBe(cli(['--param', 'interstitialMinGapSeconds=240']));
    expect(hashA).not.toBe(hashB);

    // 8. Outcomes
    await view(page, 'Outcomes');
    await page.locator('[data-invariant="interstitial-min-gap"]').getByText('pass').waitFor();
    expect(await page.locator('.chart svg').count()).toBeGreaterThan(0);

    // 9. Compare
    await view(page, 'Compare A/B');
    const kpis = page.getByRole('table', { name: 'KPI comparison' });
    await kpis.waitFor();
    await page
      .getByRole('table', { name: 'Parameter differences' })
      .getByText('interstitialMinGapSeconds')
      .waitFor();
    expect(await kpis.locator('tbody tr').count()).toBeGreaterThan(5);
    await page.screenshot({ path: join(OUTPUT, 'compare-light.png'), fullPage: true });

    // Save variant B into the model, then 10. Spec Pack preview & write
    await view(page, 'Parameters');
    await page.getByRole('radio', { name: /Variant B/ }).click();
    await page.getByRole('button', { name: 'Save B to game-model.json' }).click();
    await page.getByText(/Saved variant B to gamex\/game-model.json \(version 2\)/).waitFor();
    await view(page, 'Spec Pack');
    await page.getByRole('button', { name: 'Preview' }).click();
    await page.getByText(/new, \d+ changed/).waitFor({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Write Spec Pack to repo' }).click();
    await page
      .getByText(/Spec Pack written: \d+ files changed, \d+ golden cases/)
      .waitFor({ timeout: 120_000 });
    expect(readFileSync(join(repo, 'gamex/balance/ads.json'), 'utf8')).toMatch(
      /"interstitialMinGapSeconds":\s*\{?[^}]*240/s,
    );
    expect(existsSync(join(repo, 'AGENTS.md'))).toBe(true);
    const golden = execFileSync(process.execPath, ['gamex/tests/runner/run-golden.ts'], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(golden).toMatch(/# \d+ passed, 0 failed/);

    expect(blocked).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  }, 300_000);
});

const VIEWS = [
  'Sources',
  'Entity map',
  'Economy',
  'State machine',
  'Parameters',
  'Scenario',
  'Outcomes',
  'Compare A/B',
  'Spec Pack',
];

describe('themes', () => {
  let proc: ChildProcess | undefined;
  afterAll(() => {
    proc?.kill();
  });

  it('renders every view in light and dark with readable contrast', async () => {
    const repo = gameRepo();
    mkdirSync(join(repo, 'gamex'));
    copyFileSync(
      join(FIXTURES, 'swarm-rescue.game-model.json'),
      join(repo, 'gamex/game-model.json'),
    );
    const studio = await startStudio(repo);
    proc = studio.proc;
    for (const scheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 860 },
        colorScheme: scheme,
      });
      const blocked = await offline(context, studio.origin);
      const page = await context.newPage();
      const errors = watchErrors(page);
      await page.goto(studio.url);
      await page.getByText('Swarm Rescue').first().waitFor();
      expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(scheme);
      for (const name of VIEWS) {
        await view(page, name);
        await page.waitForTimeout(
          name.includes('map') || name === 'Economy' || name === 'State machine' ? 1200 : 150,
        );
        const colors = await page.evaluate(() => {
          const panel = document.querySelector('.section') ?? document.body;
          const muted = document.querySelector('.muted') ?? document.body;
          return {
            bg: getComputedStyle(document.body).backgroundColor,
            fg: getComputedStyle(document.body).color,
            panel: getComputedStyle(panel).backgroundColor,
            muted: getComputedStyle(muted).color,
          };
        });
        expect(contrast(colors.fg, colors.bg), `${scheme} ${name} text`).toBeGreaterThanOrEqual(7);
        expect(
          contrast(colors.fg, colors.panel),
          `${scheme} ${name} panel text`,
        ).toBeGreaterThanOrEqual(7);
        expect(
          contrast(colors.muted, colors.panel),
          `${scheme} ${name} muted text`,
        ).toBeGreaterThanOrEqual(4.5);
        await page.screenshot({
          path: join(OUTPUT, `${scheme}-${name.replace(/[^a-z]+/gi, '-').toLowerCase()}.png`),
        });
      }
      // The manual toggle overrides the system setting: system → light → dark.
      await page.getByRole('button', { name: /^Theme:/ }).click();
      expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('light');
      await page.getByRole('button', { name: /^Theme:/ }).click();
      expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('dark');
      expect(blocked).toEqual([]);
      expect(errors).toEqual([]);
      await context.close();
    }
  }, 180_000);
});

describe('static offline build', () => {
  it('imports a model, simulates in workers and downloads the Spec Pack as a zip, with no server and no network', async () => {
    const { origin, server } = await serveStatic(STUDIO_DIST);
    try {
      const context = await browser.newContext({ acceptDownloads: true });
      const blocked = await offline(context, origin);
      const page = await context.newPage();
      const errors = watchErrors(page);
      await page.goto(`${origin}/`);
      await page.getByText('static · offline').waitFor();
      expect(await page.getByRole('button', { name: 'Review' }).isDisabled()).toBe(true);
      await page.setInputFiles(
        'input[aria-label="Import Game Model"]',
        join(FIXTURES, 'swarm-rescue.game-model.json'),
      );
      await page.getByText('Loaded Swarm Rescue (22 screens).').waitFor();

      await view(page, 'Scenario');
      await page.fill('input[aria-label="Players per persona"]', '10');
      await page.fill('input[aria-label="Days"]', '2');
      await page.getByRole('button', { name: 'Run A', exact: true }).click();
      await page.locator('[data-testid=hash-A]').waitFor({ timeout: 120_000 });
      const cli = JSON.parse(
        gamex([
          'sim',
          '--model',
          join(FIXTURES, 'swarm-rescue.game-model.json'),
          '--seed',
          '1',
          '--days',
          '2',
          '--players',
          '10',
          '--json',
        ]),
      ) as { data: { record: { outputHash: string } } };
      expect(await page.locator('[data-testid=hash-A]').textContent()).toBe(
        cli.data.record.outputHash,
      );

      await view(page, 'Spec Pack');
      await page.getByRole('button', { name: 'Preview' }).click();
      await page.getByText(/\d+ files, \d+ golden cases/).waitFor({ timeout: 120_000 });
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download as zip' }).click(),
      ]);
      expect(download.suggestedFilename()).toBe('swarm-rescue-spec-pack.zip');
      const files = unzipSync(new Uint8Array(readFileSync(await download.path())));
      expect(Object.keys(files)).toEqual(
        expect.arrayContaining([
          'AGENTS.md',
          'gamex/README.md',
          'gamex/game-model.json',
          'gamex/tests/runner/run-golden.ts',
        ]),
      );
      expect(strFromU8(files['AGENTS.md'] ?? new Uint8Array())).toContain('GAMEX:BEGIN');

      expect(blocked).toEqual([]);
      expect(errors).toEqual([]);
      await context.close();
    } finally {
      server.close();
    }
  }, 180_000);
});
