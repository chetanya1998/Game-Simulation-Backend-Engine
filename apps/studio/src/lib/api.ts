/** Talks to the local `gamex studio` server. Without a token the studio runs in static (offline) mode. */
const TOKEN_KEY = 'gamex-studio-token';

export type Mode = 'server' | 'static';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Takes the token from `#token=…` (never sent to the server in the URL), keeps it for this tab. */
export function readToken(): string | undefined {
  const match = /(?:^#|&)token=([0-9a-f]+)/.exec(window.location.hash);
  if (match?.[1] !== undefined) {
    try {
      sessionStorage.setItem(TOKEN_KEY, match[1]);
    } catch {
      // storage unavailable: keep the token in the URL
      return match[1];
    }
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return match[1];
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

let token: string | undefined;

export function setToken(value: string | undefined): void {
  token = value;
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  if (token === undefined)
    throw new ApiError('STATIC_MODE', 'This needs the local `gamex studio` server.');
  const res = await fetch(path, {
    method,
    headers: {
      'x-gamex-token': token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let json: { ok: boolean; data?: T; error?: { code: string; message: string; hint?: string } };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new ApiError(
      'BAD_RESPONSE',
      `The studio server answered ${String(res.status)} without JSON.`,
    );
  }
  if (!json.ok || json.data === undefined) {
    throw new ApiError(
      json.error?.code ?? 'ERROR',
      json.error?.message ?? `Request failed (${String(res.status)}).`,
      json.error?.hint,
    );
  }
  return json.data;
}
