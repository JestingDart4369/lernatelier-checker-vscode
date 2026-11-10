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
  assert.match(status.tooltip.value, /Kein Kalender \(lernperiode\.json\)/);
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
  assert.deepEqual(env.executed.filter(c => c !== 'setContext'), ['lernatelier.showReport']);
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

// ---- quick fixes, inline hints, progress (0.3.0) ----

test('lightbulb: quick fixes for the findings under the cursor, applying one fixes the file', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  await writeFile(join(dir, 'Lernperiode-5.md'), (await readFile(join(dir, 'Lernperiode-5.md'), 'utf8')).replace('# Lern-Periode 5', '# Lern-Periode NR'));
  const env = await activate();
  const editor = await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await wait();
  const diags = env.collections.lernatelier.get(editor.document.uri);
  const numberDiag = diags.find(d => d.code === 'period.number');
  const [provider] = env.codeActionProviders;
  const actions = provider.provideCodeActions(editor.document, numberDiag.range, { diagnostics: [numberDiag] });
  assert.equal(actions[0].title, 'Nummer 5 aus dem Dateinamen übernehmen');
  assert.equal(actions[0].isPreferred, true);
  assert.equal(actions[0].kind, 'quickfix');
  await env.vscode.workspace.applyEdit(actions[0].edit);
  await wait(600);
  assert.match(editor.document.getText(), /^# Lern-Periode 5$/m);
  assert.ok(!env.collections.lernatelier.get(editor.document.uri).some(d => d.code === 'period.number'));
});

test('lightbulb: "Namen eintragen" asks for the name and writes it', async () => {
  const dir = await workdir({ 'Lernperiode-1.md': 'Lernperiode-template.md' });
  const env = await activate();
  const editor = await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-1.md')));
  await wait();
  const nameDiag = env.collections.lernatelier.get(editor.document.uri).find(d => d.code === 'name.missing');
  const [action] = env.codeActionProviders[0].provideCodeActions(editor.document, nameDiag.range, { diagnostics: [nameDiag] });
  assert.equal(action.command.command, 'lernatelier.fixName');
  env.inputs.push('Max Beispiel');
  await env.commands[action.command.command](...action.command.arguments);
  assert.match(editor.document.getText(), /^- Name: Max Beispiel$/m);
});

test('inline hints are drawn at the end of the heading lines and follow the setting', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  const env = await activate();
  const editor = await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await wait();
  const all = [...editor.decorations.values()].flat();
  const lines = editor.document.getText().split('\n');
  const texts = all.map(d => [lines[d.range.start.line], d.renderOptions.after.contentText.trim()]);
  assert.ok(texts.some(([l, t]) => l === '### Planung 18.09.2026' && t === '3 Arbeitspakete (3–5), 2 erledigt'));
  assert.ok(texts.some(([l, t]) => l === '#### Tagesreflexion' && t === 'Reflexion 60/50–100 Wörter'));
  assert.ok(all.every(d => d.range.start.character === lines[d.range.start.line].length), 'at the end of the line');
});

test('sidebar shows progress with a clickable list of days', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  await writeFile(join(dir, 'lernperiode.json'), JSON.stringify({ learningperiod: 5, days: ['2026-09-18', '2026-09-25'] }));
  const env = await activate();
  const view = env.makeWebview();
  Object.assign(view, { visible: true, onDidChangeVisibility: () => ({ dispose() {} }) });
  env.views['lernatelier.panel'].resolveWebviewView(view);
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await wait();
  const p = view.last('state').state.progress;
  assert.equal(p.calendar, true);
  assert.deepEqual([p.required, p.complete, p.tasksDone, p.tasksFilled, p.overviewDone], [2, 2, 2, 6, 4]);
  assert.deepEqual(p.days.map(d => [d.label, d.state]), [['Fr 18.09.2026', 'complete'], ['Fr 25.09.2026', 'complete']]);
  assert.doesNotMatch(view.webview.html, /style="/, 'no inline styles (blocked by the CSP)');
});

test('lernperiode.json for Lernperiode 5 does not turn Lernperiode 4 red; lernperiode-4.json applies to 4', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md', 'lernperiode.json': 'lernperiode.json' });
  const four = (await readFile(join(dir, 'Lernperiode-5.md'), 'utf8'))
    .replace('# Lern-Periode 5', '# Lern-Periode 4')
    .replace('Zeitraum: 18.09.2026 bis 25.09.2026', 'Zeitraum: 21.08.2026 bis 28.08.2026')
    .replaceAll('18.09.2026', '21.08.2026').replaceAll('25.09.2026', '28.08.2026');
  await writeFile(join(dir, 'Lernperiode-4.md'), four);
  const env = await activate();
  const uri4 = env.vscode.Uri.file(join(dir, 'Lernperiode-4.md'));
  await env.vscode.window.showTextDocument(uri4);
  await wait();
  const codes = env.collections.lernatelier.get(uri4).map(d => d.code);
  assert.ok(!codes.some(c => /period\.number|calendar|day\./.test(String(c))), `no calendar findings, got ${codes}`);
  assert.match(statusOf(env).tooltip.value, /gehört zu Lernperiode 5/);
  // the calendar editor for 4 writes its own file and leaves lernperiode.json alone
  await env.commands['lernatelier.createConfig']();
  const panel = env.panels.at(-1);
  await panel.send({ type: 'ready' });
  assert.equal(panel.last('init').init.existing, false);
  await panel.send({ type: 'save', number: 4, start: '2026-08-21', end: '2026-08-28', days: ['2026-08-21', '2026-08-28'] });
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'lernperiode-4.json'), 'utf8')).days, ['2026-08-21', '2026-08-28']);
  assert.equal(JSON.parse(await readFile(join(dir, 'lernperiode.json'), 'utf8')).learningperiod, 5);
  await wait(80);
  assert.deepEqual(env.collections.lernatelier.get(uri4), [], 'Lernperiode 4 is green with its own calendar');
});

// ---- 0.4.0: carry over, explorer badges, reminder, walkthrough ------------------------------

const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const german = iso => iso.split('-').reverse().join('.');

test('carry over command: without a next day it asks for the date and inserts a new day', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  const env = await activate();
  const editor = await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await wait();
  env.inputs.push('02.10.2026');
  await env.commands['lernatelier.carryOver']();
  const text = editor.document.getText();
  assert.match(text, /### Planung 02\.10\.2026\n\n- \[ \] Statusleiste mit Ampel einbauen\n/);
  assert.ok(env.messages.some(m => /3 offene Arbeitspakete vom 25\.09\.2026 in die neue Tagesplanung 02\.10\.2026/.test(m)));
  // with a calendar the next school day is taken without asking
  await writeFile(join(dir, 'lernperiode.json'), JSON.stringify({ learningperiod: 5, days: ['2026-09-18', '2026-09-25', '2026-10-02', '2026-10-09'] }));
  await env.commands['lernatelier.carryOver']();
  assert.equal(env.inputs.length, 0);
  assert.match(editor.document.getText(), /### Planung 09\.10\.2026\n\n- \[ \] Statusleiste/);
});

test('lightbulb on a day heading: take over the open packages of the day before', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  const env = await activate();
  const editor = await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await wait();
  const doc = editor.document;
  const line = doc.getText().split('\n').indexOf('### Planung 25.09.2026');
  const actions = env.codeActionProviders[0].provideCodeActions(doc, new env.vscode.Range(line, 0, line, 0), { diagnostics: [] });
  const carry = actions.find(a => /übernehmen/.test(a.title));
  assert.equal(carry.title, '1 offenes Arbeitspaket vom 18.09.2026 übernehmen');
  await env.vscode.commands.executeCommand(carry.command.command, ...carry.command.arguments);
  assert.match(doc.getText(), /- \[ \] Tests mit Fixtures ergänzen\n- \[ \] Erste Diagnosen im Problems-Panel anzeigen\n/);
  const again = env.codeActionProviders[0].provideCodeActions(doc, new env.vscode.Range(line, 0, line, 0), { diagnostics: [] });
  assert.ok(!again.some(a => /übernehmen/.test(a.title)), 'nothing left to take over');
  const other = env.codeActionProviders[0].provideCodeActions(doc, new env.vscode.Range(line + 2, 0, line + 2, 0), { diagnostics: [] });
  assert.ok(!other.some(a => /übernehmen/.test(a.title)), 'only on the heading');
});

test('explorer badges: ✓ for green, – for ignored, nothing for red (VS Code colours those)', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md', 'lernperiode.json': 'lernperiode.json', 'Lernperiode-1.md': 'Lernperiode-template.md' });
  const env = await activate({ workspaceDir: dir });
  await wait(100);
  const badges = env.decorationProviders[0];
  const five = env.vscode.Uri.file(join(dir, 'Lernperiode-5.md'));
  const one = env.vscode.Uri.file(join(dir, 'Lernperiode-1.md'));
  assert.equal(badges.provideFileDecoration(five).badge, '✓');
  assert.equal(badges.provideFileDecoration(five).color.id, 'testing.iconPassed');
  assert.equal(badges.provideFileDecoration(one), undefined);
  await env.commands['lernatelier.ignoreFile'](one);
  assert.equal(badges.provideFileDecoration(one).badge, '–');
  env.config.explorerBadges = false;
  assert.equal(badges.provideFileDecoration(five), undefined);
});

test('reminder: once a day when the plan for the next school day is missing; "Jetzt einfügen" inserts it', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  const today = isoOf(new Date());
  const later = isoOf(new Date(Date.now() + 7 * 864e5));
  await writeFile(join(dir, 'lernperiode.json'), JSON.stringify({ learningperiod: 5, days: ['2026-09-18', '2026-09-25', today, later] }));
  const state = {};
  const env = await activate({ workspaceDir: dir, workspaceState: state });
  env.infoAnswers.push('Jetzt einfügen');
  await wait(150);
  assert.ok(env.messages.some(m => m.startsWith('Heute ist Lernatelier: Die Tagesplanung für ')), env.messages.join('\n'));
  assert.ok(env.vscode.window.activeTextEditor.document.getText().includes(`### Planung ${german(today)}`));
  assert.equal(env.context.workspaceState.get('lernatelier.remindedOn'), today);
  // same day, new window: no second reminder
  const again = await activate({ workspaceDir: dir, workspaceState: { 'lernatelier.remindedOn': today } });
  await wait(150);
  assert.ok(!again.messages.some(m => /Tagesplanung für/.test(m)));
  // "Nicht mehr erinnern" switches the setting off
  const third = await activate({ workspaceDir: dir });
  third.infoAnswers.push('Nicht mehr erinnern');
  await wait(150);
  assert.equal(third.config.reminder, false);
});

test('walkthrough: steps have their pages, buttons run real commands, "Erste Schritte" opens it', async () => {
  const pkg = JSON.parse(await readFile(join(here, '../package.json'), 'utf8'));
  const [walk] = pkg.contributes.walkthroughs;
  const commands = new Set(pkg.contributes.commands.map(c => c.command));
  for (const step of walk.steps) {
    await readFile(join(here, '..', step.media.markdown));
    for (const [, cmd] of step.description.matchAll(/\(command:([\w.]+)\)/g)) {
      assert.ok(commands.has(cmd) || cmd.startsWith('workbench.'), cmd);
    }
  }
  const env = await activate();
  await env.commands['lernatelier.welcome']();
  assert.ok(env.executed.includes('workbench.action.openWalkthrough'));
  assert.equal(`${pkg.publisher}.${pkg.name}#${walk.id}`, 'JestingDart4369.lernatelier-checker#start');
  assert.match(await readFile(join(here, '../.vscodeignore'), 'utf8'), /!media\/walkthrough\/\*\.md/);
});

test('Woche planen inserts all missing school days of the coming week', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  const now = new Date();
  const plus = n => isoOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  await writeFile(join(dir, 'lernperiode.json'), JSON.stringify({ learningperiod: 5, days: ['2026-09-18', '2026-09-25', plus(1), plus(3), plus(10)] }));
  const env = await activate();
  const editor = await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await env.commands['lernatelier.planWeek']();
  const text = editor.document.getText();
  assert.ok(text.includes(`### Planung ${german(plus(1))}`) && text.includes(`### Planung ${german(plus(3))}`));
  assert.ok(!text.includes(`### Planung ${german(plus(10))}`), 'only the coming 7 days');
  assert.ok(text.indexOf(german(plus(1))) < text.indexOf(german(plus(3))) && text.indexOf(german(plus(3))) < text.indexOf('## Lernperiode Reflexion'));
  assert.ok(env.messages.some(m => /^2 Tagesplanungen eingefügt/.test(m)));
  await env.commands['lernatelier.planWeek']();
  assert.ok(env.messages.some(m => /schon alle geplant/.test(m)));
});

// ---- everyday writing: tick, jump, counter, absent, today, review, take over -----------------

async function openComplete(extra = {}) {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md', ...extra });
  const env = await activate();
  const editor = await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await wait();
  const lineOf = s => editor.document.getText().split('\n').indexOf(s);
  return { dir, env, editor, doc: editor.document, lineOf };
}

test('Alt+X ticks the work package under the cursor and unticks it again', async () => {
  const { env, doc, lineOf } = await openComplete();
  const line = lineOf('- [ ] Erste Diagnosen im Problems-Panel anzeigen');
  env.cursor(line);
  await env.commands['lernatelier.toggleTask']();
  assert.equal(doc.getText().split('\n')[line], '- [x] Erste Diagnosen im Problems-Panel anzeigen');
  await env.commands['lernatelier.toggleTask']();
  assert.equal(doc.getText().split('\n')[line], '- [ ] Erste Diagnosen im Problems-Panel anzeigen');
  env.cursor(0);
  const before = doc.getText();
  await env.commands['lernatelier.toggleTask']();
  assert.equal(doc.getText(), before);
  assert.ok(env.messages.some(m => /kein Arbeitspaket/.test(m)));
  const pkg = JSON.parse(await readFile(join(here, '../package.json'), 'utf8'));
  assert.ok(pkg.contributes.keybindings.every(k => k.when.includes('lernatelier.active')), 'shortcuts only inside a Lernperiode');
  assert.ok(env.executed.includes('setContext'));
});

test('jump to today, next and previous day', async () => {
  const { env, editor, lineOf } = await openComplete();
  const first = lineOf('### Planung 18.09.2026');
  const second = lineOf('### Planung 25.09.2026');
  await env.commands['lernatelier.goToday']();
  assert.equal(editor.selection.active.line, second, 'period is over: last day');
  await env.commands['lernatelier.previousDay']();
  assert.equal(editor.selection.active.line, first);
  await env.commands['lernatelier.previousDay']();
  assert.equal(editor.selection.active.line, first);
  assert.ok(env.messages.some(m => /erste Tag/.test(m)));
  await env.commands['lernatelier.nextDay']();
  assert.equal(editor.selection.active.line, second);
});

test('status bar counter shows the words of the reflection under the cursor', async () => {
  const { env, lineOf } = await openComplete();
  const counter = env.statusItems.find(i => i.id === 'lernatelier.counter');
  env.cursor(lineOf('#### Tagesreflexion') + 2);
  await wait(200);
  assert.ok(counter.visible);
  assert.match(counter.text, /^\$\(pencil\) \d+\/50–100 Wörter$/);
  assert.match(counter.tooltip, /^Tagesreflexion Fr 18\.09\.2026: \d+ Wörter, verlangt 50 bis 100\.$/);
  assert.equal(counter.backgroundColor, undefined);
  env.cursor(0);
  await wait(200);
  assert.equal(counter.visible, false);
  env.config.wordCounter = false;
  env.cursor(lineOf('#### Tagesreflexion') + 2);
  await wait(200);
  assert.equal(counter.visible, false);
});

test('mark absent: the day under the cursor, and a new day for today without a plan', async () => {
  const { env, editor, doc, lineOf } = await openComplete();
  env.cursor(lineOf('### Planung 25.09.2026') + 3);
  await env.commands['lernatelier.markAbsent']();
  assert.match(doc.getText(), /### Planung 25\.09\.2026\n\nabwesend\n/);
  await env.commands['lernatelier.markAbsent']();
  assert.ok(env.messages.some(m => /schon als abwesend/.test(m)));
  env.cursor(0);
  await env.commands['lernatelier.markAbsent']();
  const today = german(isoOf(new Date()));
  assert.ok(doc.getText().includes(`### Planung ${today}\n\nabwesend\n\n## Lernperiode Reflexion`) || doc.getText().includes(`### Planung ${today}\n\nabwesend\n\n\n## Lernperiode Reflexion`));
  assert.equal(editor.document, doc);
});

test('sidebar shows today with checkboxes; ticking one changes the file', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  const today = german(isoOf(new Date()));
  const file = join(dir, 'Lernperiode-5.md');
  await writeFile(file, (await readFile(file, 'utf8')).replace('### Planung 25.09.2026', `### Planung ${today}`));
  const env = await activate();
  const view = env.makeWebview();
  Object.assign(view, { visible: true, onDidChangeVisibility: () => ({ dispose() {} }) });
  env.views['lernatelier.panel'].resolveWebviewView(view);
  const editor = await env.vscode.window.showTextDocument(env.vscode.Uri.file(file));
  await wait();
  const state = view.last('state').state ?? view.last('state');
  const t = state.today;
  assert.deepEqual(t.tasks.map(x => [x.text, x.checked]), [
    ['Statusleiste mit Ampel einbauen', false], ['Befehle für neue Dateien schreiben', false], ['Tests mit Fixtures ergänzen', false]]);
  await view.send({ type: 'toggle', uri: editor.document.uri.toString(), line: t.tasks[1].line });
  assert.match(editor.document.getText(), /- \[x\] Befehle für neue Dateien schreiben/);
  await view.send({ type: 'toggle', uri: editor.document.uri.toString(), line: -5 });
  await view.send({ type: 'toggle', uri: editor.document.uri.toString(), line: 0 });
  assert.match(editor.document.getText(), /^# Lern-Periode 5/, 'other lines are never changed');
});

test('Rückblick opens a read-only page with days, reflections and open work packages', async () => {
  const { env, doc } = await openComplete();
  await env.commands['lernatelier.review']();
  const panel = env.panels.at(-1);
  assert.equal(panel.viewType, 'lernatelier.review');
  assert.equal(panel.title, 'Rückblick LP 5');
  const html = panel.webview.html;
  assert.match(html, /<h1>Rückblick Lernperiode 5<\/h1>/);
  assert.match(html, /Fr 18\.09\.2026/);
  assert.match(html, /<strong>2<\/strong><span>Arbeitspakete erledigt/);
  assert.match(html, /Nie abgehakt/);
  assert.match(html, /default-src 'none'/);
  // refreshes when the document changes
  const edit = new env.vscode.WorkspaceEdit();
  const line = doc.getText().split('\n').indexOf('- [ ] Tests mit Fixtures ergänzen');
  edit.replace(doc.uri, new env.vscode.Range(line, 0, line, 5), '- [x]');
  await env.vscode.workspace.applyEdit(edit);
  await wait(600);
  assert.match(env.panels.at(-1).webview.html, /<strong>3<\/strong><span>Arbeitspakete erledigt/);
  assert.equal(env.panels.filter(p => p.viewType === 'lernatelier.review').length, 1);
});

test('review page escapes what the student wrote', async () => {
  const { review, parseDocument } = await import('../out/core.mjs');
  const text = (await readFile(join(here, 'fixtures/Lernperiode-5.md'), 'utf8')).replace('Tests mit Fixtures ergänzen', 'Tests \\<b\\> & "x" ergänzen');
  const dir = await workdir({});
  await writeFile(join(dir, 'Lernperiode-5.md'), text);
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  await env.commands['lernatelier.review']();
  const html = env.panels.at(-1).webview.html;
  assert.ok(!html.includes('<b>'), 'no raw HTML from the document');
  assert.ok(html.includes('Tests &lt;b&gt; &amp; &quot;x&quot; ergänzen'));
  assert.ok(review(parseDocument(text)).open.length >= 1);
});

test('new Lernperiode offers to take over name, projects and open work packages from the last one', async () => {
  const dir = await workdir({ 'Lernperiode-5.md': 'Lernperiode-5.md' });
  const env = await activate();
  await env.vscode.window.showTextDocument(env.vscode.Uri.file(join(dir, 'Lernperiode-5.md')));
  env.inputs.push('6');
  let offered;
  env.quickPicks.push((items, opts) => {
    offered = { items, opts };
    return items.filter(i => i.picked);
  });
  await env.commands['lernatelier.newPeriod']();
  assert.deepEqual(offered.items.map(i => [i.key, i.picked]), [['name', true], ['projects', true], ['goals', false], ['tasks', true]]);
  assert.equal(offered.opts.canPickMany, true);
  assert.match(offered.opts.title, /Lernperiode-5\.md/);
  const text = await readFile(join(dir, 'Lernperiode-6.md'), 'utf8');
  assert.match(text, /^# Lern-Periode 6/);
  assert.ok(!text.includes('Exemplibus Exemplio'));
  assert.match(text, /- \[ \] Erste Diagnosen im Problems-Panel anzeigen\n- \[ \] Statusleiste mit Ampel einbauen/);
  assert.match(text, /### Generelle Ziele\n<!--[\s\S]*?-->\n\n\.\.\.Ihr Text\.\.\./, 'goals were not picked');
  // Esc in the list: plain template
  env.inputs.push('7');
  env.quickPicks.push(() => undefined);
  await env.commands['lernatelier.newPeriod']();
  assert.ok((await readFile(join(dir, 'Lernperiode-7.md'), 'utf8')).includes('Exemplibus Exemplio'));
});

test('snippet with guiding questions: the comment does not count as reflection text', async () => {
  const snippets = JSON.parse(await readFile(join(here, '../dist/snippets.json'), 'utf8'));
  const body = snippets['Tagesreflexion mit Leitfragen'].body.join('\n').replace('${1:...Ihr Text...}', '...Ihr Text...').replace('$0', '');
  const { parseDocument } = await import('../out/core.mjs');
  const text = (await readFile(join(here, 'fixtures/Lernperiode-template.md'), 'utf8')).replace(/#### Tagesreflexion[\s\S]*?\.\.\.Ihr Text\.\.\.\n/, body + '\n');
  assert.equal(parseDocument(text).days[0].reflection.wordCount, 0);
});
