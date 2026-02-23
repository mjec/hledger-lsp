/** @type {import('ts-jest').JestConfigWithTsJest} */

// Base configuration shared by all timezone test runs
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

// Conformance tests run against the real hledger CLI — no timezone variation needed
const conformanceConfig = {
  ...baseConfig,
  displayName: 'conformance',
  testMatch: ['<rootDir>/tests/integration/hledger-conformance/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
};

// Run tests in multiple timezones to catch UTC/local time bugs
// This ensures date handling works correctly regardless of timezone
// NOTE: maxWorkers=1 forces sequential execution to avoid file conflicts between timezone projects
module.exports = {
  maxWorkers: 1,
  projects: [
    {
      ...baseConfig,
      displayName: 'UTC',
      testEnvironment: 'node',
      transform: {
        '^.+\\.ts$': ['ts-jest', {
          tsconfig: 'tsconfig.json',
        }],
      },
      setupFiles: ['<rootDir>/tests/setup-timezone-utc.js'],
      // Exclude conformance tests from timezone runs — they have their own project
      testPathIgnorePatterns: ['<rootDir>/tests/integration/hledger-conformance/'],
    },
    {
      ...baseConfig,
      displayName: 'America/New_York (UTC-5)',
      testEnvironment: 'node',
      transform: {
        '^.+\\.ts$': ['ts-jest', {
          tsconfig: 'tsconfig.json',
        }],
      },
      setupFiles: ['<rootDir>/tests/setup-timezone-us-east.js'],
      testPathIgnorePatterns: ['<rootDir>/tests/integration/hledger-conformance/'],
    },
    {
      ...baseConfig,
      displayName: 'Asia/Tokyo (UTC+9)',
      testEnvironment: 'node',
      transform: {
        '^.+\\.ts$': ['ts-jest', {
          tsconfig: 'tsconfig.json',
        }],
      },
      setupFiles: ['<rootDir>/tests/setup-timezone-asia.js'],
      testPathIgnorePatterns: ['<rootDir>/tests/integration/hledger-conformance/'],
    },
    conformanceConfig,
  ],
};
