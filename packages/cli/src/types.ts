export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Envelope printed by every command with `--json` (ARCHITECTURE §8). */
export interface JsonResult<T> {
  ok: boolean;
  command: string;
  data: T;
  issues: { severity: 'error' | 'warning'; code: string; message: string; hint?: string }[];
}
