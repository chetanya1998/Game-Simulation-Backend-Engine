import react from '@vitejs/plugin-react';
import { mergeConfig } from 'vitest/config';
import { sharedConfig } from '../../tooling/vitest.shared.ts';

export default mergeConfig(sharedConfig(), { plugins: [react()] });
