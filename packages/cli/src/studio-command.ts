import { resolve } from 'node:path';
import type { Command } from 'commander';
import { positive, rootOf } from './extraction.js';
import { defaultStaticDir, startStudioServer } from './studio-server.js';
import type { Io } from './types.js';

export function registerStudioCommand(program: Command, io: Io): void {
  program
    .command('studio')
    .description(
      'Open the studio for a game repo: a localhost-only server with a per-launch token.',
    )
    .option('--cwd <dir>', 'game repo root (default: current directory)')
    .option('--port <n>', 'port (default: any free port)')
    .option('--provider <name>', 'default extraction provider: anthropic, agent or recorded')
    .option('--recordings <dir>', 'recorded answers (enables the recorded provider)')
    .option('--model <name>', 'LLM model for extraction')
    .option('--static-dir <dir>', 'serve this studio build instead of the bundled one')
    .action(
      async (o: {
        cwd?: string;
        port?: string;
        provider?: string;
        recordings?: string;
        model?: string;
        staticDir?: string;
      }) => {
        const provider = o.provider ?? (o.recordings === undefined ? undefined : 'recorded');
        if (provider !== undefined && !['anthropic', 'agent', 'recorded'].includes(provider)) {
          io.stderr(`✖ --provider must be anthropic, agent or recorded, got "${provider}"\n`);
          process.exitCode = 2;
          return;
        }
        const studio = await startStudioServer({
          root: rootOf(o),
          staticDir: o.staticDir === undefined ? defaultStaticDir() : resolve(o.staticDir),
          ...(o.port === undefined ? {} : { port: positive('port', o.port) ?? 0 }),
          ...(provider === undefined
            ? {}
            : { provider: provider as 'anthropic' | 'agent' | 'recorded' }),
          ...(o.recordings === undefined ? {} : { recordings: resolve(o.recordings) }),
          ...(o.model === undefined ? {} : { model: o.model }),
          log: (line) => {
            io.stderr(`  ${line}\n`);
          },
        });
        io.stderr(
          `GameX Engine Studio for ${rootOf(o)}\n  Open: ${studio.url}\n  (localhost only; the token in the link is required. Ctrl+C to stop.)\n`,
        );
        await new Promise<void>((done) => {
          const stop = (): void => {
            void studio.close().then(done);
          };
          process.once('SIGINT', stop);
          process.once('SIGTERM', stop);
        });
      },
    );
}
