// Loads the real bundle dist/extension.js against a small stand-in for the VS Code API and
// checks what a student sees: Problems entries, status bar, report and the three commands.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { activate } from './helpers/vscode-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));

const statusOf = env => env.context.subscriptions.find(s => 'hide' in s && 'show' in s && !('appendLine' in s));

async function workdir(files) {
  const dir = await mkdtemp(join(tmpdir(), 'lernatelier-'));
  for (const [name, source] of Object.entries(files)) await copyFile(join(here, 'fixtures', source), join(dir, name));
  return dir;
}

test('a complete document with lernperiode.json shows no problems and a green status', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md', 'lernperiode.json': 'lernperiode.json' });
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await wait();
  assert.deepEqual(env.collections.lernatelier.get(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md'))), []);
  const status = statusOf(env);
  assert.equal(status.visible, true);
  assert.match(status.text, /^\$\(pass\) Lernatelier$/);
  assert.equal(status.backgroundColor, undefined);
});

test('the template shows errors in the Problems panel and a red status', async () => {
  const dir = await workdir({ 'Lernperiode-1.md': 'Lernperiode-template.md' });
  const env = await activate();
  const uri = env.vscode.Uri.file(join(dir, 'Lernperiode-1.md'));
  await env.vscode.window.showTextDocument(uri);
  await wait();
  const diags = env.collections.lernatelier.get(uri);
  assert.ok(diags.length >= 5);
  assert.ok(diags.every(d => d.source === 'Lernatelier' && d.code));
  const name = diags.find(d => d.code === 'name.missing');
  assert.equal(name.severity, 0);
  assert.equal(name.range.start.line, 17); // "- Name: Exemplibus Exemplio"
  const status = statusOf(env);
  assert.match(status.text, /^\$\(error\) Lernatelier \d+$/);
  assert.equal(status.backgroundColor.id, 'statusBarItem.errorBackground');
  assert.match(status.tooltip.value, /Handlungsbedarf/);
  assert.match(status.tooltip.value, /lernperiode\.json nicht gefunden/);
});

test('other Markdown files are not checked', async () => {
  const dir = await workdir({ 'README.md': 'Lernperiode-template.md' });
  const env = await activate();
  const uri = env.vscode.Uri.file(join(dir, 'README.md'));
  await env.vscode.window.showTextDocument(uri);
  await wait();
  assert.equal(env.collections.lernatelier.get(uri), undefined);
  const status = statusOf(env);
  assert.equal(status.visible, false);
});

test('an invalid lernperiode.json is reported on the config file and checks still run', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  await writeFile(join(dir, 'lernperiode.json'), '{ "learningperiod": "fünf", "days": ["18.09.2026"] }');
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await wait();
  const cfgDiags = env.collections['lernatelier-config'].get(env.vscode.Uri.file(join(dir, 'lernperiode.json')));
  assert.equal(cfgDiags.length, 2);
  assert.deepEqual(env.collections.lernatelier.get(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md'))), []);
});

test('typing re-checks the document', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  const env = await activate();
  const editor = await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await wait();
  editor.document._text = editor.document._text.replace('Name: Max Beispiel', 'Name: Exemplibus Exemplio');
  env.fire('change', { document: editor.document });
  await wait(600);
  const diags = env.collections.lernatelier.get(editor.document.uri);
  assert.ok(diags.some(d => d.code === 'name.missing'));
});

test('report command writes the full report', async () => {
  const dir = await workdir({ 'Lernperiode-1.md': 'Lernperiode-template.md' });
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-1.md')));
  await env.commands['lernatelier.check']();
  const channel = env.context.subscriptions.find(s => 'appendLine' in s);
  assert.match(channel.text, /^Lernperiode-1\.md/);
  assert.match(channel.text, /FEHLER   Zeile 18: Name fehlt/);
  assert.match(channel.text, /→ Handlungsbedarf/);
});

test('new period command creates Lernperiode-N.md from the template and never overwrites', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  env.inputs.push('6');
  await env.commands['lernatelier.newPeriod']();
  const created = await readFile(join(dir, 'Lernperiode-6.md'), 'utf8');
  assert.match(created, /^# Lern-Periode 6$/m);
  assert.match(created, /Exemplibus Exemplio/);
  env.inputs.push('5');
  const before = await readFile(join(dir, 'Lernperiode-5.md'), 'utf8');
  await env.commands['lernatelier.newPeriod']();
  assert.equal(await readFile(join(dir, 'Lernperiode-5.md'), 'utf8'), before);
  assert.ok(env.messages.some(m => /gibt es in diesem Ordner schon/.test(m)));
});

test('calendar editor: opens prefilled from the document and saves the ticked days', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  await writeFile(join(dir, 'Lernperiode-5.md'), (await readFile(join(dir, 'Lernperiode-5.md'), 'utf8'))
    .replace('Zeitraum: 18.09.2026 bis 25.09.2026', 'Zeitraum: 18.09.2026 bis 16.10.2026'));
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await env.commands['lernatelier.createConfig']();
  const panel = env.panels.at(-1);
  assert.equal(panel.viewType, 'lernatelier.calendar');
  assert.match(panel.webview.html, /Content-Security-Policy/);
  assert.match(panel.webview.html, /script-src 'nonce-[A-Za-z0-9]{32}'/);
  assert.doesNotMatch(panel.webview.html, /https?:\/\//, 'no external resources');
  await panel.send({ type: 'ready' });
  const init = panel.last('init');
  assert.equal(init.init.number, 5);
  assert.equal(init.init.start, '2026-09-18');
  assert.equal(init.init.end, '2026-10-16');
  assert.deepEqual(init.init.weekdays, [5]);
  assert.equal(init.init.existing, false);
  assert.deepEqual(init.rows.map(r => r.label), ['Fr 18.09.2026', 'Fr 25.09.2026', 'Fr 02.10.2026', 'Fr 09.10.2026', 'Fr 16.10.2026']);
  assert.ok(init.rows.every(r => r.checked));
  // student adds Wednesday and unticks a holiday
  await panel.send({ type: 'compute', start: '2026-09-18', end: '2026-10-16', weekdays: [3, 5], extra: [], unchecked: ['2026-10-09'] });
  const rows = panel.last('rows').rows;
  assert.equal(rows.length, 9);
  assert.equal(rows.find(r => r.iso === '2026-10-09').checked, false);
  await panel.send({ type: 'save', number: 5, start: '2026-09-18', end: '2026-10-16', days: rows.filter(r => r.checked).map(r => r.iso) });
  assert.equal(panel.last('saved').count, 8);
  const saved = JSON.parse(await readFile(join(dir, 'lernperiode.json'), 'utf8'));
  assert.equal(saved.learningperiod, 5);
  assert.equal(saved.days.length, 8);
  assert.ok(!saved.days.includes('2026-10-09'));
});

test('calendar editor: loads an existing lernperiode.json, keeps unticked days unticked', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  await writeFile(join(dir, 'lernperiode.json'), JSON.stringify({ learningperiod: 5, days: ['2026-09-18', '2026-09-23'] }));
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await env.commands['lernatelier.createConfig']();
  const panel = env.panels.at(-1);
  await panel.send({ type: 'ready' });
  const init = panel.last('init').init;
  assert.equal(init.existing, true);
  assert.deepEqual(init.weekdays, [3, 5]);
  assert.deepEqual(init.unchecked, ['2026-09-25'], 'Friday 25.09 is generated but not in the file');
  const rows = panel.last('init').rows;
  assert.deepEqual(rows.filter(r => r.checked).map(r => r.iso), ['2026-09-18', '2026-09-23']);
});

test('calendar editor: refuses to save without number or days, and reopening reuses the tab', async () => {
  const dir = await workdir({ 'Lernperiode-1.md': 'Lernperiode-template.md' });
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-1.md')));
  await env.commands['lernatelier.createConfig']();
  const panel = env.panels.at(-1);
  await panel.send({ type: 'ready' });
  assert.equal(panel.last('init').init.periodSource, 'none');
  await panel.send({ type: 'save', number: null, start: null, end: null, days: [] });
  assert.equal(panel.last('problems').problems.length, 2);
  await assert.rejects(readFile(join(dir, 'lernperiode.json')));
  await env.commands['lernatelier.createConfig']();
  assert.equal(env.panels.length, 1);
  assert.equal(panel.revealed, 1);
});

test('status bar shows a calendar button: "Kalender erstellen" or the number of days', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await wait();
  const calendar = env.context.subscriptions.filter(s => 'hide' in s && 'show' in s && !('appendLine' in s))[1];
  assert.equal(calendar.command, 'lernatelier.createConfig');
  assert.equal(calendar.visible, true);
  assert.equal(calendar.text, '$(calendar) Kalender erstellen');
  await writeFile(join(dir, 'lernperiode.json'), JSON.stringify({ learningperiod: 5, days: ['2026-09-18', '2026-09-25'] }));
  await env.commands['lernatelier.check']();
  assert.equal(calendar.text, '$(calendar) 2 Tage');
});

test('sidebar panel shows status, findings and runs only allowed commands', async () => {
  const dir = await workdir({ 'Lernperiode-1.md': 'Lernperiode-template.md' });
  const env = await activate();
  const provider = env.views['lernatelier.panel'];
  assert.ok(provider, 'sidebar provider registered');
  const view = env.makeWebview();
  Object.assign(view, { visible: true, onDidChangeVisibility: () => ({ dispose() {} }) });
  provider.resolveWebviewView(view);
  assert.match(view.webview.html, /Content-Security-Policy/);
  await view.send({ type: 'ready' });
  assert.equal(view.last('state').state.file, null, 'no Lernperiode open yet');
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-1.md')));
  await wait();
  const state = view.last('state').state;
  assert.equal(state.status, 'red');
  assert.equal(state.file.name, 'Lernperiode-1.md');
  assert.equal(state.findings[0].severity, 'error', 'errors first');
  assert.equal(state.findings.length, state.errors + state.warnings);
  assert.equal(state.calendar.found, false);
  await view.send({ type: 'command', command: 'lernatelier.showReport' });
  await view.send({ type: 'command', command: 'workbench.action.files.delete' });
  assert.deepEqual(env.executed, ['lernatelier.showReport']);
});

test('add-day command inserts the next configured day before the period reflection', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  await writeFile(join(dir, 'lernperiode.json'), JSON.stringify({ learningperiod: 5, days: ['2026-09-18', '2026-09-25', '2099-01-07'] }));
  const env = await activate();
  const editor = await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await env.commands['lernatelier.addDay']();
  const text = editor.document.getText();
  assert.match(text, /### Planung 07\.01\.2099\n\n- \[ \] \.\.\.Ihr Text\.\.\./);
  assert.ok(text.indexOf('### Planung 07.01.2099') < text.indexOf('## Lernperiode Reflexion'));
  assert.ok(text.indexOf('### Planung 25.09.2026') < text.indexOf('### Planung 07.01.2099'));
  assert.equal(editor.selection.start.line, text.split('\n').findIndex(l => l === '### Planung 07.01.2099') + 2);
});

// ---- whole folder and ignore ----

async function folder() {
  const dir = await workdir({ 'Lernperiode-4.md': 'Lernperiode-template.md', 'Lernperiode-5.md': 'Lernperiode-5.md', 'README.md': 'Lernperiode-template.md' });
  await writeFile(join(dir, 'Lernperiode-4.md'), (await readFile(join(dir, 'Lernperiode-4.md'), 'utf8')).replace('# Lern-Periode NR', '# Lern-Periode 4'));
  return dir;
}
const diagsOf = (env, dir, name) => env.collections.lernatelier.get(env.vscode.Uri.file(join(dir, name)));

test('folder: every Lernperiode is checked without opening it, other Markdown files are not', async () => {
  const dir = await folder();
  const env = await activate({ workspaceDir: dir });
  await wait(80);
  assert.ok(diagsOf(env, dir, 'Lernperiode-4.md').length > 0, 'unopened Lernperiode-4 has problems');
  assert.deepEqual(diagsOf(env, dir, 'Lernperiode-5.md'), []);
  assert.equal(diagsOf(env, dir, 'README.md'), undefined);
  assert.equal(statusOf(env).visible, false, 'no file open: no traffic light');
});

test('folder: the status bar shows the file you are in, the others stay in Problems', async () => {
  const dir = await folder();
  const env = await activate({ workspaceDir: dir });
  await wait(80);
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await wait();
  assert.match(statusOf(env).text, /^\$\(pass\)/);
  assert.ok(diagsOf(env, dir, 'Lernperiode-4.md').length > 0);
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-4.md')));
  await wait();
  assert.match(statusOf(env).text, /^\$\(error\)/);
});

test('folder: sidebar lists all Lernperioden with their status, sorted', async () => {
  const dir = await folder();
  const env = await activate({ workspaceDir: dir });
  const view = env.makeWebview();
  Object.assign(view, { visible: true, onDidChangeVisibility: () => ({ dispose() {} }) });
  env.views['lernatelier.panel'].resolveWebviewView(view);
  await wait(80);
  const files = view.last('state').state.files;
  assert.deepEqual(files.map(f => [f.name, f.status, f.ignored]), [['Lernperiode-4.md', 'red', false], ['Lernperiode-5.md', 'green', false]]);
  await view.send({ type: 'open', uri: files[1].uri });
  await wait();
  assert.equal(view.last('state').state.files[1].active, true);
});

test('folder: closing an edited file shows the saved version again', async () => {
  const dir = await folder();
  const env = await activate({ workspaceDir: dir });
  await wait(80);
  const editor = await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  editor.document._text = editor.document._text.replace('Name: Max Beispiel', 'Name: Exemplibus Exemplio');
  env.fire('change', { document: editor.document });
  await wait(600);
  assert.ok(diagsOf(env, dir, 'Lernperiode-5.md').some(d => d.code === 'name.missing'));
  env.close(editor.document);
  await wait(80);
  assert.deepEqual(diagsOf(env, dir, 'Lernperiode-5.md'), [], 'unsaved change is gone, file on disk is complete');
});

test('folder: changes and deletions on disk are picked up', async () => {
  const dir = await folder();
  const env = await activate({ workspaceDir: dir });
  await wait(80);
  // (an empty "Name:" is not detected by the library: it reads the next line as the name)
  await writeFile(join(dir, 'Lernperiode-5.md'), (await readFile(join(dir, 'Lernperiode-5.md'), 'utf8')).replace('Name: Max Beispiel', 'Name: Exemplibus Exemplio'));
  env.fileEvent('Change', join(dir, 'Lernperiode-5.md'));
  await wait(450);
  assert.ok(diagsOf(env, dir, 'Lernperiode-5.md').some(d => d.code === 'name.missing'));
  env.fileEvent('Delete', join(dir, 'Lernperiode-5.md'));
  assert.equal(diagsOf(env, dir, 'Lernperiode-5.md'), undefined);
});

test('ignore: a file leaves Problems, is remembered locally and can be checked again', async () => {
  const dir = await folder();
  const env = await activate({ workspaceDir: dir });
  await wait(80);
  const four = env.vscode.Uri.file(join(dir, 'Lernperiode-4.md'));
  await env.commands['lernatelier.ignoreFile'](four.toString());
  assert.equal(diagsOf(env, dir, 'Lernperiode-4.md'), undefined);
  assert.deepEqual(env.context.workspaceState.get('lernatelier.ignored'), [four.toString()]);
  // the open ignored file: status says so, click checks it again
  await env.vscode.window.showTextDocument(four);
  await wait();
  assert.equal(statusOf(env).text, '$(eye-closed) Lernatelier: ignoriert');
  assert.equal(statusOf(env).command, 'lernatelier.unignoreFile');
  await env.commands['lernatelier.unignoreFile']();
  await wait();
  assert.ok(diagsOf(env, dir, 'Lernperiode-4.md').length > 0);
  assert.match(statusOf(env).text, /^\$\(error\)/);
  assert.equal(statusOf(env).command, 'lernatelier.showReport');
});

test('ignore: "Ältere ignorieren" keeps only the newest Lernperiode, and the list survives a restart', async () => {
  const dir = await folder();
  const env = await activate({ workspaceDir: dir });
  await wait(80);
  await env.commands['lernatelier.ignoreOlder']();
  assert.equal(diagsOf(env, dir, 'Lernperiode-4.md'), undefined);
  assert.deepEqual(diagsOf(env, dir, 'Lernperiode-5.md'), []);
  assert.ok(env.messages.some(m => /1 ältere Lernperiode wird ignoriert/.test(m)));
  const saved = env.context.workspaceState.get('lernatelier.ignored');
  const again = await activate({ workspaceDir: dir, workspaceState: { 'lernatelier.ignored': saved } });
  await wait(80);
  assert.equal(diagsOf(again, dir, 'Lernperiode-4.md'), undefined, 'still ignored after restart');
});

test('ignore from the sidebar buttons', async () => {
  const dir = await folder();
  const env = await activate({ workspaceDir: dir });
  const view = env.makeWebview();
  Object.assign(view, { visible: true, onDidChangeVisibility: () => ({ dispose() {} }) });
  env.views['lernatelier.panel'].resolveWebviewView(view);
  await wait(80);
  const four = view.last('state').state.files[0];
  await view.send({ type: 'ignore', uri: four.uri, ignore: true });
  assert.equal(view.last('state').state.files[0].ignored, true);
  await view.send({ type: 'ignore', uri: four.uri, ignore: false });
  await wait();
  assert.equal(view.last('state').state.files[0].ignored, false);
  assert.equal(view.last('state').state.files[0].status, 'red');
});
