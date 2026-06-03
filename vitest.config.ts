import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/', 'tests/manual/'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'src/types/',
        'src/main.ts',
        'src/modals/',
        'src/views/',
        'scripts/',
        'docs/',
        '.obsidian/',
        '.bmad/'
      ]
    },
    setupFiles: [],
    testTimeout: 10000
  },
  resolve: {
    alias: {
      'obsidian': path.resolve(__dirname, './tests/mocks/obsidianStub.ts')
    }
  }
});