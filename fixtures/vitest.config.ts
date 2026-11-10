import { mergeConfig } from 'vitest/config';
import { sharedConfig } from '../tooling/vitest.shared.ts';

export default mergeConfig(sharedConfig(), { test: { include: ['*/test/**/*.test.ts'] } });
