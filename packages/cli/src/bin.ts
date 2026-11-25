import { createInterface, type Interface } from 'node:readline/promises';
import { CommanderError } from 'commander';
import { createProgram } from './program.js';

let rl: Interface | undefined;
const program = createProgram({
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  ...(process.stdin.isTTY
    ? {
        prompt: (question: string) => {
          rl ??= createInterface({ input: process.stdin, output: process.stderr });
          return rl.question(question);
        },
      }
    : {}),
});

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    // Help and --version exit with code 0; usage errors exit with 2 (ARCHITECTURE §8).
    process.exitCode = error.exitCode === 0 ? 0 : 2;
  } else {
    throw error;
  }
} finally {
  rl?.close();
}
