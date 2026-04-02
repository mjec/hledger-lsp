/** @type {import('ts-jest').JestConfigWithTsJest} */

const baseConfig = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
};

// Note: multi-timezone Jest projects were removed because process.env.TZ
// does not reliably affect Date local getters in Jest workers. Timezone-
// sensitive code should be tested via dependency injection (e.g. the `now`
// parameter on validateFutureDate) rather than relying on TZ env var.
module.exports = {
  projects: [
    {
      ...baseConfig,
      displayName: 'tests',
      transform: {
        '^.+\\.ts$': ['ts-jest', {
          tsconfig: 'tsconfig.json',
        }],
      },
      testPathIgnorePatterns: ['<rootDir>/tests/integration/hledger-conformance/'],
    },
    {
      ...baseConfig,
      displayName: 'conformance',
      testMatch: ['<rootDir>/tests/integration/hledger-conformance/**/*.test.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', {
          tsconfig: 'tsconfig.json',
        }],
      },
    },
  ],
};
