export default {
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
      transform: {
        '^.+\\.tsx?$': [
          'ts-jest',
          {
            tsconfig: '<rootDir>/tsconfig.backend.json',
          },
        ],
      },
      // uuid ships ESM-only; see test/shims/uuid.cjs for why this is needed
      // only under Jest, not in the real app.
      moduleNameMapper: {
        '^uuid$': '<rootDir>/test/shims/uuid.cjs',
      },
      setupFiles: ['<rootDir>/test/setup-env-unit.ts'],
      setupFilesAfterEnv: ['<rootDir>/test/setup-unit.ts'],
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.int.spec.ts'],
      transform: {
        '^.+\\.tsx?$': [
          'ts-jest',
          {
            tsconfig: '<rootDir>/tsconfig.backend.json',
          },
        ],
      },
      moduleNameMapper: {
        '^uuid$': '<rootDir>/test/shims/uuid.cjs',
      },
      globalSetup: '<rootDir>/test/global-setup.ts',
      globalTeardown: '<rootDir>/test/global-teardown.ts',
      setupFiles: ['<rootDir>/test/setup-env-integration.ts'],
      setupFilesAfterEnv: ['<rootDir>/test/setup-integration.ts'],
    },
  ],
  maxWorkers: 1,
};
