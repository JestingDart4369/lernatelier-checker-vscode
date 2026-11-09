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

// ---- Markdown snippets, generated from the official template so they never drift ----------
const escape = s => s.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/}/g, '\\}');
const today = '${CURRENT_DATE}.${CURRENT_MONTH}.${CURRENT_YEAR}';
const templateText = await readFile(join(root, 'vendor/lernatelier-checker-js/templates/Lernperiode-NR.md'), 'utf8');
const templateLines = templateText.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
const replaced = {
  '# Lern-Periode NR': '# Lern-Periode ${1:NR}',
  '- Name: Exemplibus Exemplio': '- Name: ${2:Exemplibus Exemplio}',
  '- Zeitraum: tt.mm.jjjj bis tt.mm.jjjj': '- Zeitraum: ${3:tt.mm.jjjj} bis ${4:tt.mm.jjjj}',
  '### Planung tt.mm.jjjj': '### Planung ${5:tt.mm.jjjj}',
};
const seen = new Set();
const lernperiodeBody = templateLines.map(line => {
  if (line in replaced && !seen.has(line)) {
    seen.add(line);
    return replaced[line];
  }
  return escape(line);
});
for (const line of Object.keys(replaced)) {
  if (!seen.has(line)) throw new Error(`Template line not found for snippet: ${line}`);
}
const snippets = {
  'Lernperiode (Vorlage)': {
    prefix: ['lernperiode', 'lern-periode'],
    description: 'Neue Lernperiode aus der offiziellen Vorlage (Nummer, Name, Zeitraum mit Tab anspringen)',
    body: [...lernperiodeBody, '$0'],
  },
  'Tagesplanung': {
    prefix: ['planung', 'tagesplanung', 'tag'],
    description: 'Neue Tagesplanung mit heutigem Datum, drei Arbeitspaketen und Tagesreflexion',
    body: [
      `### Planung \${1:${today}}`,
      '',
      '- [ ] ${2:...Ihr Text...}',
      '- [ ] ${3:...Ihr Text...}',
      '- [ ] ${4:...Ihr Text...}',
      '',
      '#### Tagesreflexion',
      '',
      '${5:...Ihr Text...}',
      '$0',
    ],
  },
  'Tagesreflexion': {
    prefix: ['tagesreflexion', 'reflexion'],
    description: 'Tagesreflexion (50–100 Wörter)',
    body: ['#### Tagesreflexion', '', '${1:...Ihr Text...}', '$0'],
  },
  'Arbeitspaket': {
    prefix: ['arbeitspaket', 'ap'],
    description: 'Ein Arbeitspaket (Checkbox)',
    body: ['- [ ] ${1:...Ihr Text...}$0'],
  },
};
await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist/snippets.json'), JSON.stringify(snippets, null, 2) + '\n');

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
