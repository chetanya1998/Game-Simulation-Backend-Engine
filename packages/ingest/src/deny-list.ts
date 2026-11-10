/**
 * Hard deny-list for files in a target repo (master prompt §3.8, ARCHITECTURE §5.1).
 *
 * These files are never read, chunked, or sent to any LLM, regardless of user configuration.
 * Matching is case-insensitive and applies to every path segment, so `config/.env.local`,
 * `Secrets/release.KEYSTORE`, and `.ssh/known_hosts` are all denied.
 */

export interface DenyRule {
  readonly id: string;
  readonly reason: string;
  /** Matches a single file name (the last path segment). */
  readonly file?: RegExp;
  /** Matches any directory segment. */
  readonly dir?: RegExp;
}

export const DENY_RULES: readonly DenyRule[] = [
  { id: 'dotenv', reason: 'environment file (may hold secrets)', file: /^\.env(\..*)?$/i },
  {
    id: 'private-key',
    reason: 'private key or key store',
    file: /\.(pem|key|p8|p12|pfx|keystore|jks|ppk|asc|gpg)$/i,
  },
  {
    id: 'certificate',
    reason: 'certificate',
    file: /\.(crt|cer|der|csr|mobileprovision|provisionprofile)$/i,
  },
  { id: 'ssh-key', reason: 'SSH key', file: /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i },
  {
    id: 'cloud-credentials',
    reason: 'cloud/service credentials file',
    file: /^(google-services\.json|googleservice-info\.plist|credentials.*\.json|service-account.*\.json|.*-sa-key\.json)$/i,
  },
  { id: 'secrets-file', reason: 'secrets file', file: /^secrets?(\..*)?$/i },
  {
    id: 'auth-config',
    reason: 'package-manager or network auth config',
    file: /^(\.npmrc|\.yarnrc\.yml|\.netrc|\.pypirc|\.git-credentials)$/i,
  },
  {
    id: 'secret-dir',
    reason: 'directory that holds credentials or VCS internals',
    dir: /^(\.git|\.ssh|\.aws|\.gnupg|\.azure|\.gcloud|\.docker)$/i,
  },
];

export interface DenyMatch {
  readonly rule: string;
  readonly reason: string;
}

/**
 * Returns the matching deny rule for a repo-relative path, or `undefined` if the path is allowed
 * by the deny-list (it may still be excluded later by `.gitignore`, the allowlist, or size caps).
 * Accepts `/` or `\` separators.
 */
export function matchDenyList(relativePath: string): DenyMatch | undefined {
  const segments = relativePath.split(/[\\/]+/).filter((s) => s.length > 0 && s !== '.');
  const fileName = segments.at(-1);
  if (fileName === undefined) return undefined;
  const dirs = segments.slice(0, -1);
  for (const rule of DENY_RULES) {
    if (
      rule.file?.test(fileName) === true ||
      (rule.dir !== undefined && dirs.some((d) => rule.dir?.test(d)))
    ) {
      return { rule: rule.id, reason: rule.reason };
    }
  }
  return undefined;
}
