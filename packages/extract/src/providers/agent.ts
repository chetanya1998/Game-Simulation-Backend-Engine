import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  HandoffPending,
  LlmError,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from '../provider.js';

const README = `# GameX extraction requests

Each file in \`requests/\` is one extraction request. To answer it with your own agent session:

1. Read the request: \`system\` is the role, \`documents\` the source text, \`instructions\` the task.
2. Write the answer — JSON matching \`responseSchema\` — to \`responses/<id>.json\` (same file name).
3. Run the GameX command again (\`gamex extract --provider agent\`).

Answers are checked against the schema and their quotes against the documents; nothing is used
until it has been reviewed (\`gamex review\`). Delete a response to ask again.
`;

/**
 * "Bring your own agent": writes each request to gamex/.work/handoff/requests/<id>.json and reads the
 * answer from responses/<id>.json. A request whose answer is missing (or answers an older version of
 * the request) raises HandoffPending after the request file is written.
 */
export class AgentHandoffProvider implements LlmProvider {
  readonly name = 'agent';

  constructor(readonly directory: string) {}

  complete(request: LlmRequest, schema: z.ZodType): Promise<LlmResponse> {
    const name = `${request.id.replace('#', '-')}.json`;
    const requestPath = join(this.directory, 'requests', name);
    const responsePath = join(this.directory, 'responses', name);
    const previous = existsSync(requestPath) ? readHash(requestPath) : undefined;
    if (previous === request.hash && existsSync(responsePath) && request.attempt === 0) {
      return Promise.resolve({ text: readFileSync(responsePath, 'utf8'), model: 'agent' });
    }
    if (request.attempt > 0) {
      return Promise.reject(
        new LlmError(
          `The answer in ${responsePath} failed validation:\n${request.feedback?.errors ?? ''}\nFix it and run the command again.`,
          request.id,
        ),
      );
    }
    mkdirSync(join(this.directory, 'requests'), { recursive: true });
    mkdirSync(join(this.directory, 'responses'), { recursive: true });
    writeFileSync(join(this.directory, 'README.md'), README);
    const body = {
      id: request.id,
      requestHash: request.hash,
      answerAt: `responses/${name}`,
      system: request.system,
      instructions: request.instructions,
      responseSchema: z.toJSONSchema(schema),
      documents: request.documents,
    };
    writeFileSync(requestPath, `${JSON.stringify(body, null, 2)}\n`);
    return Promise.reject(new HandoffPending([request.id], this.directory));
  }
}

function readHash(path: string): string | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { requestHash?: unknown };
    return typeof value.requestHash === 'string' ? value.requestHash : undefined;
  } catch {
    return undefined;
  }
}
