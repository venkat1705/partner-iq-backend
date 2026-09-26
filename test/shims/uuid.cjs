// Jest-only shim for the `uuid` package: it ships ESM-only (no CJS build) in
// the installed major version, and while plain Node 22.12+/24+ can
// transparently require() an ESM module, Jest's own module loader doesn't
// support that yet. Production code is unaffected — this is wired in via
// jest.config.mjs's moduleNameMapper only, so the real `uuid` package is
// still what ships and runs outside of tests.
const { randomUUID } = require('crypto');

module.exports = {
  v4: randomUUID,
};
