import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    // All files share one emulator and clearData() wipes it, so run files one at a time.
    fileParallelism: false,
    include: ['tests/rules/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    watch: false,
    passWithNoTests: true,
    globals: true,
  },
})
