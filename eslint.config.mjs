// ESLint is used here to enforce architecture rules (type checking stays with `tsc --noEmit`).
//
// Storage rule: every file operation goes through src/common/storage (StorageService).
//  - @aws-sdk/* may be imported only inside src/common/storage/**.
//  - fs write/delete functions may not be used outside src/common/storage/** (uploaded files are never written to
//    local disk). The single exception is the development-only email provider, which writes rendered email HTML for
//    local inspection — not uploaded files.
import tseslint from 'typescript-eslint';

const FS_WRITE_FUNCTIONS = [
  'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream',
  'copyFile', 'copyFileSync', 'cp', 'cpSync', 'rename', 'renameSync',
  'unlink', 'unlinkSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'mkdir', 'mkdirSync', 'truncate', 'truncateSync',
];
const AWS_SDK_MESSAGE = 'Use StorageService from src/common/storage — the AWS SDK may only be imported inside the storage module.';
const FS_MESSAGE = 'Do not write files to local disk. Store files through StorageService (src/common/storage).';

const restrictedImports = {
  patterns: [{ group: ['@aws-sdk/*', '@smithy/*', 'aws-sdk', 'aws-sdk/*'], message: AWS_SDK_MESSAGE }],
  paths: ['fs', 'node:fs', 'fs/promises', 'node:fs/promises'].map((name) => ({ name, importNames: FS_WRITE_FUNCTIONS, message: FS_MESSAGE })),
};
const restrictedFsCalls = FS_WRITE_FUNCTIONS.flatMap((property) =>
  ['fs', 'fsp', 'promises'].map((object) => ({ object, property, message: FS_MESSAGE })),
);

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'e2e/**', 'e2e-assets/**', 'api/**', 'scratch/**'] },
  {
    files: ['src/**/*.ts', 'server.ts'],
    languageOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-restricted-imports': ['error', restrictedImports],
      'no-restricted-properties': ['error', ...restrictedFsCalls],
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.name='require'][arguments.0.value=/^(@aws-sdk|@smithy|aws-sdk)/]",
        message: AWS_SDK_MESSAGE,
      }],
    },
  },
  {
    files: ['src/common/storage/**/*.ts'],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-properties': 'off', 'no-restricted-syntax': 'off' },
  },
  {
    // development-only email provider: writes rendered email HTML for local inspection (not uploaded files)
    files: ['src/modules/email-design/providers/development-email.provider.ts'],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-properties': 'off' },
  },
);
