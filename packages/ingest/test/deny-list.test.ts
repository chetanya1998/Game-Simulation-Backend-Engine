import { describe, expect, it } from 'vitest';
import { matchDenyList } from '@gamex/ingest';

describe('matchDenyList', () => {
  it.each([
    ['.env', 'dotenv'],
    ['config/.env.local', 'dotenv'],
    ['.ENV.production', 'dotenv'],
    ['certs/server.pem', 'private-key'],
    ['Secrets/release.KEYSTORE', 'private-key'],
    ['android/app/upload.jks', 'private-key'],
    ['ios/dist.p12', 'private-key'],
    ['ios/app.mobileprovision', 'certificate'],
    ['tls/site.crt', 'certificate'],
    ['id_rsa', 'ssh-key'],
    ['keys/id_ed25519.pub', 'ssh-key'],
    ['android/app/google-services.json', 'cloud-credentials'],
    ['ios/GoogleService-Info.plist', 'cloud-credentials'],
    ['credentials-prod.json', 'cloud-credentials'],
    ['secrets.yaml', 'secrets-file'],
    ['.npmrc', 'auth-config'],
    ['.git/config', 'secret-dir'],
    ['home\\.ssh\\known_hosts', 'secret-dir'],
    ['deploy/.aws/config', 'secret-dir'],
  ])('denies %s (%s)', (path, rule) => {
    expect(matchDenyList(path)?.rule).toBe(rule);
  });

  it.each([
    'README.md',
    'docs/GDD.md',
    'config/economy.json',
    'Assets/Tuning/Economy.asset',
    'src/Tuning.cs',
    'environment.md',
    'keyboard-layout.json',
    'monkey.ts',
    'docs/secret-level-design.md',
  ])('allows %s', (path) => {
    expect(matchDenyList(path)).toBeUndefined();
  });

  it('returns undefined for an empty path', () => {
    expect(matchDenyList('')).toBeUndefined();
    expect(matchDenyList('./')).toBeUndefined();
  });

  it('includes a human-readable reason', () => {
    expect(matchDenyList('.env')?.reason).toMatch(/environment file/);
  });
});
