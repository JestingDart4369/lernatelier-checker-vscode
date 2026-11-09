// Build script.
//   node scripts/build.mjs          -> dist/extension.js (single bundle) + THIRD-PARTY-NOTICES.md
//   node scripts/build.mjs --test   -> additionally out/core.mjs and out/upstream/*.js for the tests
import { build } from 'esbuild';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const withTests = process.argv.includes('--test');

await rm(join(root, 'dist'), { recursive: true, force: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  loader: { '.md': 'text' },
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});

// ---- licence notices for every npm package that ends up in the bundle ----------------------
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (m) packages.set(m[1], join(root, 'node_modules', m[1]));
}
const licenceFile = async dir => {
  const names = (await readdir(dir)).filter(n => /^(licen[cs]e|copying)(\..*)?$/i.test(n));
  return names.length ? (await readFile(join(dir, names[0]), 'utf8')).trim() : null;
};
const sections = [];
const vendorLicence = (await readFile(join(root, 'vendor/lernatelier-checker-js/LICENSE'), 'utf8')).trim();
sections.push(`## lernatelier-checker-js\n\nSource: https://github.com/djlauk/lernatelier-checker-js (vendored in \`vendor/lernatelier-checker-js\`)\nLicence: MIT\n\n\`\`\`\n${vendorLicence}\n\`\`\``);
for (const [name, dir] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const text = await licenceFile(dir);
  if (!text) throw new Error(`No licence file found for bundled package ${name}`);
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? '';
  sections.push(`## ${name} ${pkg.version}\n\n${repo ? `Source: ${repo}\n` : ''}Licence: ${pkg.license}\n\n\`\`\`\n${text}\n\`\`\``);
}
await writeFile(join(root, 'THIRD-PARTY-NOTICES.md'),
  `# Third-party notices\n\nLernatelier Checker includes the following software. Each is used under the licence shown.\n\n${sections.join('\n\n')}\n`);
console.log(`dist/extension.js built, ${packages.size + 1} third-party components listed in THIRD-PARTY-NOTICES.md`);

if (withTests) {
  await rm(join(root, 'out'), { recursive: true, force: true });
  await build({
    absWorkingDir: root,
    entryPoints: ['src/core.ts'],
    outfile: 'out/core.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'warning',
  });
  // The library as separate ES modules (imports kept), for its own upstream tests.
  const vendorSrc = join(root, 'vendor/lernatelier-checker-js/src');
  const files = (await readdir(vendorSrc)).filter(f => f.endsWith('.ts')).map(f => join(vendorSrc, f));
  await build({ entryPoints: files, outdir: join(root, 'out/upstream'), format: 'esm', platform: 'neutral', logLevel: 'warning' });
  await mkdir(join(root, 'out'), { recursive: true });
  await writeFile(join(root, 'out/package.json'), '{ "type": "module" }\n');
  if (!existsSync(join(root, 'out/core.mjs'))) throw new Error('test build failed');
  console.log('out/ built for tests');
}
