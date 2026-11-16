import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    include: ['tests/rules/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    watch: false,
    passWithNoTests: true,
    globals: true,
  },
})
