import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts'
    ],
    exclude: [
      'node_modules',
      'dist',
      '*.config.ts',
      'index.html'
    ],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['html', 'lcov', 'text'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      },
      exclude: [
        'node_modules/**',
        'dist/**',
        '*.config.ts',
        '*.config.js',
        'index.html',
        'tests/**',
        'sw.js',
        'manifest.json',
        'supabase/**',
        '*.js',
        '*.mjs',
        '*.cjs',
        'python/**',
        'gas_*.js',
        'src/api/**',
        'src/components/app/**',
        'src/components/mbe/**',
        'src/components/sleep/**',
        'src/config/**',
        'src/types/**',
        'src/constants/**',
        'src/utils/**'
      ]
    },
    clearMocks: true,
    restoreMocks: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})