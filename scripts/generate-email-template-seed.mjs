#!/usr/bin/env node
/**
 * Regenerates backend/src/database/seeds/email-templates.generated.json from the
 * email-design project's template registry (../email-design/src/emails/templates/registry.ts,
 * a sibling of this repo).
 *
 * Run this manually whenever a template's design changes in email-design/src/emails/templates/
 * — the backend does NOT read that project's source at runtime (it can't; it's not part of the
 * Docker build), so this generated JSON is the only thing that ships to production. Forgetting
 * to regenerate it after editing a template there means the change is invisible in prod even
 * though it looks correct locally.
 *
 * Usage (from backend/) — must run under tsx, not plain node: the registry's .ts files
 * use TypeScript-only constructs (type-only interface imports without `import type`) that
 * only tsx's esbuild-based loader strips correctly; plain Node's built-in TS support does not.
 *   npx tsx scripts/generate-email-template-seed.mjs
 */
import { pathToFileURL } from 'url';
import { writeFileSync } from 'fs';
import path from 'path';

const registryPath = path.resolve(import.meta.dirname, '..', '..', 'email-design', 'src', 'emails', 'templates', 'registry.ts');
const outPath = path.resolve(import.meta.dirname, '..', 'src', 'database', 'seeds', 'email-templates.generated.json');

const registry = await import(pathToFileURL(registryPath).href);
const templates = registry.ALL_TEMPLATES;

if (!Array.isArray(templates) || templates.length === 0) {
  console.error('No templates found in registry at', registryPath);
  process.exit(1);
}

const out = templates.map((t) => ({
  id: t.id,
  name: t.name,
  category: t.category,
  description: t.description,
  tags: t.tags || [],
  defaultSubject: t.defaultSubject,
  defaultPreheader: t.defaultPreheader,
  variables: t.variables || [],
  defaultData: t.defaultData || {},
  samplePresets: t.samplePresets || undefined,
  bodyTemplate: typeof t.renderBody === 'function' ? t.renderBody(t.defaultData || {}) : '',
  securityNotice: t.securityNotice,
}));

writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${out.length} templates to ${outPath}`);
