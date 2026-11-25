/**
 * Content scan for secrets in files that passed the name-based deny-list. A file that matches is excluded
 * entirely: it is never chunked and never sent to any LLM.
 */
export interface SecretMatch {
  readonly kind: string;
  readonly line: number;
}

const PATTERNS: readonly { kind: string; re: RegExp }[] = [
  { kind: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: 'openai-style-key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { kind: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { kind: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { kind: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'stripe-key', re: /\b(?:sk|rk)_live_[0-9a-zA-Z]{24,}\b/ },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
];

/** Shannon entropy in bits per character. */
export function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** `password = "…"`, `apiKey: '…'`, `TOKEN=…` with a long, random-looking value. */
const ASSIGNMENT =
  /\b([A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|api[_-]?key|private[_-]?key|access[_-]?key|credential|auth)[A-Za-z0-9_.-]*)\b["']?\s*[:=]\s*["']?([A-Za-z0-9+/=_\-.]{20,})/i;

export function scanForSecrets(text: string): SecretMatch | undefined {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const p of PATTERNS) if (p.re.test(line)) return { kind: p.kind, line: i + 1 };
    const m = ASSIGNMENT.exec(line);
    if (m !== null && entropy(m[2] ?? '') >= 3.5)
      return { kind: `high-entropy value for "${m[1] ?? ''}"`, line: i + 1 };
  }
  return undefined;
}
