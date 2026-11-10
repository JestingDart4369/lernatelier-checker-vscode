// Lernatelier Checker — VS Code integration.
// Reads only the open document and the lernperiode.json next to it. No network access.
import * as vscode from 'vscode';
import {
  CONFIG_FILE, check, counts, dayBlock, dayLabel, insertLineForDay, isoToGerman, newPeriodText,
  nextDayToPlan, parseConfig, parseDayList, report, summary, todayIso,
  type CheckOutcome, type ConfigResult, type Finding, type LearningPeriodConfig,
} from './core';
import { openCalendar } from './calendarPanel';
import { nameEdit, quickFixes, type TextEdit } from './fixes';
import { inlineHints, progress } from './progress';
import { SidebarProvider, emptyState, type SidebarState } from './sidebar';
import template from '../vendor/lernatelier-checker-js/templates/Lernperiode-NR.md';

const SOURCE = 'Lernatelier';
let diagnostics: vscode.DiagnosticCollection;
let configDiagnostics: vscode.DiagnosticCollection;
let statusItem: vscode.StatusBarItem;
let calendarItem: vscode.StatusBarItem;
let output: vscode.OutputChannel;
let sidebar: SidebarProvider;
/** The Lernperiode the status bar and sidebar show: the last active one that is still open. */
let currentDoc: vscode.TextDocument | undefined;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

interface CalendarInfo {
  found: boolean;
  days: number;
  next: string | null;
  problems: string[];
}
const lastOutcome = new Map<string, { outcome: CheckOutcome; notes: string[]; calendar: CalendarInfo; config: LearningPeriodConfig }>();
let hintTypes: Record<'ok' | 'warn' | 'info', vscode.TextEditorDecorationType>;
/** Lernperiode files found in the workspace (uri strings), also those that are not open. */
const workspaceFiles = new Map<string, vscode.Uri>();
let fileWatcher: vscode.FileSystemWatcher | undefined;
/** Ignored Lernperioden (uri strings), kept in this workspace's local storage, not in the files. */
let ignored = new Set<string>();
let extensionContext: vscode.ExtensionContext;
const IGNORE_KEY = 'lernatelier.ignored';
let watcherPattern = '';

function settings() {
  return vscode.workspace.getConfiguration('lernatelier');
}

function isLernperiode(doc: vscode.TextDocument): boolean {
  if (doc.languageId !== 'markdown' || doc.uri.scheme === 'output') return false;
  const pattern = settings().get<string>('filePattern', '**/Lernperiode-*.md');
  return vscode.languages.match({ language: 'markdown', pattern }, doc) > 0;
}

function folderOf(uri: vscode.Uri): string {
  return vscode.Uri.joinPath(uri, '..').toString();
}

async function readConfig(doc: vscode.TextDocument | vscode.Uri): Promise<{ result: ConfigResult; uri: vscode.Uri; found: boolean }> {
  const file = 'uri' in doc ? doc.uri : doc;
  const uri = vscode.Uri.joinPath(file, '..', CONFIG_FILE);
  // Prefer an open, unsaved editor of lernperiode.json over the file on disk.
  const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  try {
    const text = open ? open.getText() : new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    return { result: parseConfig(text), uri, found: true };
  } catch {
    return { result: { config: {}, errors: [] }, uri, found: false };
  }
}

function toDiagnostic(f: Finding): vscode.Diagnostic {
  const range = new vscode.Range(f.range.startLine, f.range.startCharacter, f.range.endLine, f.range.endCharacter);
  const d = new vscode.Diagnostic(range, f.message,
    f.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
  d.source = SOURCE;
  d.code = f.code;
  return d;
}

async function checkDocument(doc: vscode.TextDocument): Promise<void> {
  if (!settings().get<boolean>('enable', true) || !isLernperiode(doc)) return;
  await runCheck(doc.uri, doc.getText());
}

/** Checks one Lernperiode, given its current text, and stores the result for status bar and sidebar. */
async function runCheck(uri: vscode.Uri, text: string): Promise<void> {
  if (ignored.has(uri.toString())) {
    diagnostics.delete(uri);
    lastOutcome.delete(uri.toString());
    updateStatus();
    return;
  }
  const cfg = await readConfig(uri);
  const notes = [...cfg.result.errors];
  if (!cfg.found) notes.push(`${CONFIG_FILE} nicht gefunden – Tagesplanungen und Fristen werden ohne Kalender geprüft.`);

  let outcome: CheckOutcome;
  try {
    outcome = check(text, cfg.result.config, todayIso());
  } catch (e) {
    // Invalid configuration values make the library throw: check again without the calendar.
    notes.push(`Kalender nicht verwendet: ${(e as Error).message}`);
    outcome = check(text, {}, todayIso());
  }
  diagnostics.set(uri, outcome.findings.map(toDiagnostic));
  configDiagnostics.set(cfg.uri, cfg.result.errors.map(message => {
    const d = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), message, vscode.DiagnosticSeverity.Error);
    d.source = SOURCE;
    return d;
  }));
  const days = cfg.result.config.periodDays ?? [];
  const today = todayIso();
  const next = days.find(d => d > today) ?? null;
  lastOutcome.set(uri.toString(), {
    outcome, notes, config: cfg.result.config,
    calendar: { found: cfg.found, days: days.length, next: next ? dayLabel(next) : null, problems: cfg.result.errors },
  });
  updateStatus();
  updateHints();
}

// ---- inline hints (word counts, work packages) ------------------------------------------

function updateHints(): void {
  const show = settings().get<boolean>('inlineHints', true) && settings().get<boolean>('enable', true);
  for (const editor of vscode.window.visibleTextEditors) {
    const entry = lastOutcome.get(editor.document.uri.toString());
    const byLevel: Record<'ok' | 'warn' | 'info', vscode.DecorationOptions[]> = { ok: [], warn: [], info: [] };
    if (show && entry && !ignored.has(editor.document.uri.toString()) && isLernperiode(editor.document)) {
      for (const hint of inlineHints(entry.outcome.result.document, entry.config, todayIso())) {
        if (hint.line >= editor.document.lineCount) continue;
        const end = editor.document.lineAt(hint.line).range.end;
        byLevel[hint.level].push({ range: new vscode.Range(end, end), renderOptions: { after: { contentText: `  ${hint.text}` } } });
      }
    }
    for (const level of ['ok', 'warn', 'info'] as const) editor.setDecorations(hintTypes[level], byLevel[level]);
  }
}

// ---- quick fixes ------------------------------------------------------------------------

function toRange(r: TextEdit['range']): vscode.Range {
  return new vscode.Range(r.startLine, r.startCharacter, r.endLine, r.endCharacter);
}

class FixProvider implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    if (!isLernperiode(doc)) return [];
    const entry = lastOutcome.get(doc.uri.toString());
    const text = doc.getText();
    const actions: vscode.CodeAction[] = [];
    for (const d of context.diagnostics) {
      if (d.source !== SOURCE || typeof d.code !== 'string') continue;
      const finding = {
        code: d.code, message: d.message,
        range: { startLine: d.range.start.line, startCharacter: d.range.start.character, endLine: d.range.end.line, endCharacter: d.range.end.character },
      };
      const fileName = doc.uri.path.split('/').pop() ?? '';
      for (const fix of quickFixes(text, finding, { fileName, config: entry?.config ?? {}, today: todayIso() })) {
        const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
        action.diagnostics = [d];
        action.isPreferred = fix.preferred;
        if (fix.edits.length) {
          const edit = new vscode.WorkspaceEdit();
          for (const e of fix.edits) edit.replace(doc.uri, toRange(e.range), e.newText);
          action.edit = edit;
        }
        if (fix.command) action.command = { command: fix.command.id, title: fix.command.title, arguments: [doc.uri, ...fix.command.args] };
        actions.push(action);
      }
    }
    return actions;
  }
}

async function fixName(uri?: vscode.Uri, line?: number): Promise<void> {
  const doc = uri ? await vscode.workspace.openTextDocument(uri) : currentDoc;
  if (!doc) return;
  const nameLine = typeof line === 'number' ? line : doc.getText().split(/\r?\n/).findIndex(l => /^\s*(?:[-*]\s+)?Name:/.test(l));
  if (nameLine < 0) return;
  const name = await vscode.window.showInputBox({
    prompt: 'Dein Name für diese Lernperiode',
    placeHolder: 'Vorname Nachname',
    validateInput: v => (v.trim() && v.trim() !== 'Exemplibus Exemplio' ? undefined : 'Bitte deinen Namen eingeben.'),
  });
  if (name === undefined) return;
  const e = nameEdit(doc.getText(), nameLine, name);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, toRange(e.range), e.newText);
  await vscode.workspace.applyEdit(edit);
}

function openDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString() && !d.isClosed);
}

/** Checks a Lernperiode file: the open editor's text if it is open, else the file on disk. */
async function checkFile(uri: vscode.Uri): Promise<void> {
  if (!settings().get<boolean>('enable', true)) return;
  const open = openDocument(uri);
  if (open) return checkDocument(open);
  let text: string;
  try {
    text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    forget(uri);
    return;
  }
  await runCheck(uri, text);
}

function forget(uri: vscode.Uri): void {
  workspaceFiles.delete(uri.toString());
  diagnostics.delete(uri);
  lastOutcome.delete(uri.toString());
  updateStatus();
}

function scheduleFile(uri: vscode.Uri, delay = 300): void {
  const key = `file:${uri.toString()}`;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    void checkFile(uri);
  }, delay));
}

function workspaceEnabled(): boolean {
  return settings().get<boolean>('enable', true) && settings().get<boolean>('checkWorkspace', true);
}

// ---- ignoring finished Lernperioden ------------------------------------------------------

async function setIgnored(uris: vscode.Uri[], ignore: boolean): Promise<void> {
  for (const uri of uris) {
    if (ignore) ignored.add(uri.toString());
    else ignored.delete(uri.toString());
  }
  await extensionContext.workspaceState.update(IGNORE_KEY, [...ignored]);
  for (const uri of uris) {
    if (ignore) {
      diagnostics.delete(uri);
      lastOutcome.delete(uri.toString());
    } else {
      await checkFile(uri);
    }
  }
  updateStatus();
}

/** The uri a command is about: given by the sidebar, else the current Lernperiode. */
function targetUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) return arg;
  if (typeof arg === 'string') return vscode.Uri.parse(arg);
  trackActiveEditor();
  return currentDoc?.uri;
}

async function ignoreFile(arg?: unknown): Promise<void> {
  const uri = targetUri(arg);
  if (uri) await setIgnored([uri], true);
}

async function unignoreFile(arg?: unknown): Promise<void> {
  const uri = targetUri(arg);
  if (uri) await setIgnored([uri], false);
}

/** Number in "Lernperiode-N.md", or -1. */
function periodNumber(uri: vscode.Uri): number {
  const m = /Lernperiode-(\d+)[^/]*\.md$/i.exec(uri.path);
  return m ? Number(m[1]) : -1;
}

/** Ignores every Lernperiode except the newest (highest number) in each folder. */
async function ignoreOlder(): Promise<void> {
  const byFolder = new Map<string, vscode.Uri[]>();
  for (const uri of workspaceFiles.values()) {
    const list = byFolder.get(folderOf(uri)) ?? [];
    list.push(uri);
    byFolder.set(folderOf(uri), list);
  }
  const older: vscode.Uri[] = [];
  for (const list of byFolder.values()) {
    const newest = Math.max(...list.map(periodNumber));
    older.push(...list.filter(u => periodNumber(u) < newest));
  }
  if (!older.length) {
    void vscode.window.showInformationMessage('Es gibt keine älteren Lernperioden zum Ignorieren.');
    return;
  }
  await setIgnored(older, true);
  void vscode.window.showInformationMessage(
    `${older.length} ältere ${older.length === 1 ? 'Lernperiode wird' : 'Lernperioden werden'} ignoriert. In der Seitenleiste kannst du sie wieder prüfen lassen.`);
}

/** Finds and checks every Lernperiode file in the open folders. */
async function scanWorkspace(): Promise<void> {
  if (!workspaceEnabled()) {
    for (const [key, uri] of workspaceFiles) if (!openDocument(uri)) forget(uri); else workspaceFiles.delete(key);
    return;
  }
  const pattern = settings().get<string>('filePattern', '**/Lernperiode-*.md');
  const found = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 1000);
  const keep = new Set(found.map(u => u.toString()));
  for (const [key, uri] of [...workspaceFiles]) if (!keep.has(key) && !openDocument(uri)) forget(uri);
  for (const uri of found) workspaceFiles.set(uri.toString(), uri);
  for (const uri of found) await checkFile(uri);
}

/** Watches Lernperiode files on disk, so changes outside the editor (git pull, other apps) are checked too. */
function watchFiles(context: vscode.ExtensionContext): void {
  const pattern = settings().get<string>('filePattern', '**/Lernperiode-*.md');
  if (fileWatcher && watcherPattern === pattern) return;
  fileWatcher?.dispose();
  watcherPattern = pattern;
  fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
  const onChange = (uri: vscode.Uri) => {
    if (!workspaceEnabled() || openDocument(uri)) return; // open files are checked from the editor
    workspaceFiles.set(uri.toString(), uri);
    scheduleFile(uri);
  };
  context.subscriptions.push(
    fileWatcher,
    fileWatcher.onDidCreate(onChange),
    fileWatcher.onDidChange(onChange),
    fileWatcher.onDidDelete(uri => forget(uri)),
  );
}

function schedule(doc: vscode.TextDocument, delay = 400): void {
  const key = doc.uri.toString();
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    void checkDocument(doc);
  }, delay));
}

function trackActiveEditor(): void {
  const doc = vscode.window.activeTextEditor?.document;
  if (doc && isLernperiode(doc)) currentDoc = doc;
  // Another text file in front: nothing to show. No text editor (sidebar, calendar tab): keep the last one.
  else if (doc && doc.uri.scheme !== 'output') currentDoc = undefined;
  if (currentDoc?.isClosed) currentDoc = undefined;
}

/** All known Lernperioden for the sidebar list, sorted by folder and number. */
function filesState(active: vscode.TextDocument | undefined): SidebarState['files'] {
  const uris = new Map(workspaceFiles);
  for (const d of vscode.workspace.textDocuments) if (!d.isClosed && isLernperiode(d)) uris.set(d.uri.toString(), d.uri);
  return [...uris.values()]
    .map(uri => {
      const key = uri.toString();
      const entry = lastOutcome.get(key);
      const c = entry ? counts(entry.outcome.findings) : { errors: 0, warnings: 0 };
      return {
        name: vscode.workspace.asRelativePath(uri), uri: key,
        status: entry ? entry.outcome.result.status : null,
        errors: c.errors, warnings: c.warnings,
        ignored: ignored.has(key), active: active?.uri.toString() === key,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
}

function updateStatus(): void {
  trackActiveEditor();
  const doc = currentDoc;
  const enabled = settings().get<boolean>('enable', true);
  const entry = doc && enabled ? lastOutcome.get(doc.uri.toString()) : undefined;
  if (!doc || !enabled) {
    statusItem.hide();
    calendarItem.hide();
    sidebar.update({ ...emptyState(), files: enabled ? filesState(undefined) : [] });
    return;
  }
  const state: SidebarState = {
    ...emptyState(),
    file: { name: vscode.workspace.asRelativePath(doc.uri), uri: doc.uri.toString() },
    ignored: ignored.has(doc.uri.toString()),
    files: filesState(doc),
  };
  if (state.ignored) {
    statusItem.text = '$(eye-closed) Lernatelier: ignoriert';
    statusItem.tooltip = 'Diese Lernperiode wird nicht geprüft. Klicken, um sie wieder zu prüfen.';
    statusItem.command = 'lernatelier.unignoreFile';
    statusItem.backgroundColor = undefined;
    statusItem.show();
    calendarItem.hide();
    sidebar.update(state);
    return;
  }
  statusItem.command = 'lernatelier.showReport';
  if (!entry) {
    sidebar.update(state);
    return;
  }
  const { result, findings } = entry.outcome;
  const { errors, warnings } = counts(findings);

  const icon = { red: '$(error)', yellow: '$(warning)', green: '$(pass)' }[result.status];
  statusItem.text = `${icon} Lernatelier${errors + warnings ? ` ${errors + warnings}` : ''}`;
  statusItem.backgroundColor = result.status === 'red'
    ? new vscode.ThemeColor('statusBarItem.errorBackground')
    : result.status === 'yellow' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  const tip = new vscode.MarkdownString();
  tip.appendMarkdown(`**Lernatelier Checker**\n\n${summary(result.status, findings)}`);
  if (warnings || errors) tip.appendMarkdown(`\n\n${errors} Fehler · ${warnings} ${warnings === 1 ? 'Warnung' : 'Warnungen'}`);
  for (const note of entry.notes) tip.appendMarkdown(`\n\n_${note}_`);
  tip.appendMarkdown('\n\nKlicken für den Bericht');
  statusItem.tooltip = tip;
  statusItem.show();

  const cal = entry.calendar;
  if (!cal.found) {
    calendarItem.text = '$(calendar) Kalender erstellen';
    calendarItem.tooltip = 'Noch keine lernperiode.json: Unterrichtstage festlegen, damit nach Kalender geprüft wird.';
    calendarItem.backgroundColor = undefined;
  } else if (cal.problems.length) {
    calendarItem.text = '$(calendar) Kalender fehlerhaft';
    calendarItem.tooltip = `lernperiode.json: ${cal.problems.join(' ')}`;
    calendarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    calendarItem.text = `$(calendar) ${cal.days} ${cal.days === 1 ? 'Tag' : 'Tage'}`;
    calendarItem.tooltip = `Lernperiode-Kalender: ${cal.days} Unterrichtstage${cal.next ? `, nächster: ${cal.next}` : ''}. Klicken zum Bearbeiten.`;
    calendarItem.backgroundColor = undefined;
  }
  calendarItem.show();

  sidebar.update({
    ...state,
    progress: progress(result.document, entry.config, todayIso()),
    status: result.status,
    summary: summary(result.status, findings),
    errors, warnings,
    findings: [...findings]
      .sort((x, y) => (x.severity === y.severity ? x.range.startLine - y.range.startLine : x.severity === 'error' ? -1 : 1))
      .map(f => ({ severity: f.severity, message: f.message, range: f.range })),
    calendar: cal,
    notes: entry.notes.filter(n => !n.startsWith(CONFIG_FILE)),
  });
}

async function showReport(): Promise<void> {
  trackActiveEditor();
  const doc = vscode.window.activeTextEditor?.document ?? currentDoc;
  if (!doc || doc.languageId !== 'markdown') {
    void vscode.window.showInformationMessage('Öffnen Sie zuerst eine Lernperiode-Datei (Lernperiode-N.md).');
    return;
  }
  if (!isLernperiode(doc)) {
    void vscode.window.showInformationMessage(`Diese Datei passt nicht zum Muster „${settings().get('filePattern')}“. Der Bericht wird trotzdem erstellt.`);
  }
  const cfg = await readConfig(doc);
  const notes = [...cfg.result.errors];
  if (!cfg.found) notes.push(`${CONFIG_FILE} nicht gefunden.`);
  let outcome: CheckOutcome;
  try {
    outcome = check(doc.getText(), cfg.result.config, todayIso());
  } catch (e) {
    notes.push(`Kalender nicht verwendet: ${(e as Error).message}`);
    outcome = check(doc.getText(), {}, todayIso());
  }
  output.clear();
  output.appendLine(report(vscode.workspace.asRelativePath(doc.uri), outcome, notes));
  output.show(true);
}

async function targetFolder(): Promise<vscode.Uri | undefined> {
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active?.scheme === 'file') return vscode.Uri.joinPath(active, '..');
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length === 1) return folders[0]!.uri;
  if (folders && folders.length > 1) {
    const pick = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Ordner für die neue Datei' });
    return pick?.uri;
  }
  const chosen = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Ordner wählen' });
  return chosen?.[0];
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function askNumber(prompt: string): Promise<number | undefined> {
  const value = await vscode.window.showInputBox({
    prompt,
    placeHolder: 'z. B. 5',
    validateInput: v => (/^\d+$/.test(v.trim()) && Number(v) >= 1 ? undefined : 'Bitte eine ganze Zahl ab 1 eingeben.'),
  });
  return value === undefined ? undefined : Number(value.trim());
}

async function newPeriod(): Promise<void> {
  const folder = await targetFolder();
  if (!folder) return;
  const number = await askNumber('Nummer der neuen Lernperiode');
  if (number === undefined) return;
  const uri = vscode.Uri.joinPath(folder, `Lernperiode-${number}.md`);
  if (await exists(uri)) {
    void vscode.window.showWarningMessage(`Lernperiode-${number}.md gibt es in diesem Ordner schon. Es wurde nichts überschrieben.`);
    await vscode.window.showTextDocument(uri);
    return;
  }
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(newPeriodText(template, number)));
  await vscode.window.showTextDocument(uri);
}

/** Opens the calendar editor for the current Lernperiode (or a chosen folder). */
async function createConfig(): Promise<void> {
  trackActiveEditor();
  const active = vscode.window.activeTextEditor?.document;
  const source = active && active.languageId === 'markdown' ? active : currentDoc;
  const folder = source?.uri.scheme === 'file' ? vscode.Uri.joinPath(source.uri, '..') : await targetFolder();
  if (!folder) return;
  const uri = vscode.Uri.joinPath(folder, CONFIG_FILE);
  let config;
  let existing = false;
  try {
    config = parseConfig(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))).config;
    existing = true;
  } catch {
    config = undefined;
  }
  openCalendar({
    folder,
    text: source?.getText() ?? '',
    docName: source ? vscode.workspace.asRelativePath(source.uri) : undefined,
    config,
    existing,
    onSaved: () => {
      if (source && !source.isClosed) void checkDocument(source);
    },
  });
}

/** Quick pick of all Lernperiode files in the workspace. */
async function openPeriod(): Promise<void> {
  const pattern = settings().get<string>('filePattern', '**/Lernperiode-*.md');
  const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 200);
  if (!files.length) {
    const create = 'Neue Lernperiode erstellen';
    const answer = await vscode.window.showInformationMessage('Im geöffneten Ordner gibt es keine Lernperiode-Datei.', create);
    if (answer === create) await newPeriod();
    return;
  }
  const pick = await vscode.window.showQuickPick(
    files.sort((a, b) => b.path.localeCompare(a.path, 'de', { numeric: true }))
      .map(uri => ({ label: vscode.workspace.asRelativePath(uri), uri })),
    { placeHolder: 'Lernperiode öffnen' });
  if (pick) await vscode.window.showTextDocument(pick.uri);
}

async function addDay(): Promise<void> {
  trackActiveEditor();
  let editor = vscode.window.activeTextEditor;
  if ((!editor || editor.document.languageId !== 'markdown') && currentDoc) {
    editor = await vscode.window.showTextDocument(currentDoc);
  }
  if (!editor || editor.document.languageId !== 'markdown') {
    void vscode.window.showInformationMessage('Öffnen Sie zuerst eine Lernperiode-Datei.');
    return;
  }
  const doc = editor.document;
  const { result } = await readConfig(doc);
  let iso = nextDayToPlan(doc.getText(), result.config, todayIso());
  if (!iso) {
    const input = await vscode.window.showInputBox({
      prompt: 'Datum der neuen Tagesplanung (TT.MM.JJJJ)',
      value: isoToGerman(todayIso()),
      validateInput: v => (parseDayList(v).days.length === 1 && !parseDayList(v).invalid.length ? undefined : 'Bitte ein Datum im Format TT.MM.JJJJ eingeben.'),
    });
    if (input === undefined) return;
    iso = parseDayList(input).days[0]!;
  }
  const line = insertLineForDay(doc.getText());
  const atEnd = line >= doc.lineCount;
  const position = atEnd ? doc.lineAt(doc.lineCount - 1).range.end : new vscode.Position(line, 0);
  const block = (atEnd ? '\n\n' : '') + dayBlock(iso);
  await editor.edit(edit => edit.insert(position, block));
  const taskLine = position.line + (atEnd ? 2 : 0) + 2;
  editor.selection = new vscode.Selection(taskLine, 6, taskLine, 6 + '...Ihr Text...'.length);
  editor.revealRange(new vscode.Range(taskLine, 0, taskLine, 0), vscode.TextEditorRevealType.InCenter);
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  ignored = new Set(context.workspaceState.get<string[]>(IGNORE_KEY, []));
  diagnostics = vscode.languages.createDiagnosticCollection('lernatelier');
  configDiagnostics = vscode.languages.createDiagnosticCollection('lernatelier-config');
  output = vscode.window.createOutputChannel('Lernatelier Checker');
  statusItem = vscode.window.createStatusBarItem('lernatelier.status', vscode.StatusBarAlignment.Left, 50);
  statusItem.name = 'Lernatelier Checker';
  statusItem.command = 'lernatelier.showReport';
  calendarItem = vscode.window.createStatusBarItem('lernatelier.calendar', vscode.StatusBarAlignment.Left, 49);
  calendarItem.name = 'Lernatelier Kalender';
  calendarItem.command = 'lernatelier.createConfig';
  sidebar = new SidebarProvider();
  const hint = (color: string) => vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor(color), fontStyle: 'italic', margin: '0 0 0 1em' },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  hintTypes = { ok: hint('editorCodeLens.foreground'), info: hint('editorCodeLens.foreground'), warn: hint('editorWarning.foreground') };

  const recheckFolder = (uri: vscode.Uri) => {
    const folder = folderOf(uri);
    for (const doc of vscode.workspace.textDocuments) {
      if (folderOf(doc.uri) === folder) schedule(doc, 100);
    }
    for (const file of workspaceFiles.values()) {
      if (folderOf(file) === folder && !openDocument(file)) scheduleFile(file, 100);
    }
  };
  const watcher = vscode.workspace.createFileSystemWatcher(`**/${CONFIG_FILE}`);

  context.subscriptions.push(
    diagnostics, configDiagnostics, output, statusItem, calendarItem, watcher,
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
    hintTypes.ok, hintTypes.info, hintTypes.warn,
    vscode.languages.registerCodeActionsProvider({ language: 'markdown' }, new FixProvider(), { providedCodeActionKinds: FixProvider.kinds }),
    vscode.commands.registerCommand('lernatelier.fixName', fixName),
    vscode.window.onDidChangeVisibleTextEditors(() => updateHints()),
    vscode.commands.registerCommand('lernatelier.openPeriod', openPeriod),
    vscode.commands.registerCommand('lernatelier.ignoreFile', ignoreFile),
    vscode.commands.registerCommand('lernatelier.unignoreFile', unignoreFile),
    vscode.commands.registerCommand('lernatelier.ignoreOlder', ignoreOlder),
    vscode.commands.registerCommand('lernatelier.checkWorkspace', async () => {
      await scanWorkspace();
      const n = workspaceFiles.size;
      void vscode.window.showInformationMessage(`${n} ${n === 1 ? 'Lernperiode' : 'Lernperioden'} im Ordner geprüft.`);
    }),
    vscode.commands.registerCommand('lernatelier.check', async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (doc) await checkDocument(doc);
      await showReport();
    }),
    vscode.commands.registerCommand('lernatelier.showReport', showReport),
    vscode.commands.registerCommand('lernatelier.newPeriod', newPeriod),
    vscode.commands.registerCommand('lernatelier.createConfig', createConfig),
    vscode.commands.registerCommand('lernatelier.addDay', addDay),
    vscode.workspace.onDidOpenTextDocument(doc => schedule(doc, 0)),
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (doc.fileName.endsWith(CONFIG_FILE)) recheckFolder(doc.uri);
      else schedule(doc, 0);
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.fileName.endsWith(CONFIG_FILE)) recheckFolder(e.document.uri);
      else if (settings().get<boolean>('checkWhileTyping', true)) schedule(e.document);
    }),
    vscode.workspace.onDidCloseTextDocument(doc => {
      if (currentDoc === doc) currentDoc = undefined;
      if (workspaceEnabled() && workspaceFiles.has(doc.uri.toString())) {
        // Still part of the folder: show the saved version again (unsaved changes are gone).
        scheduleFile(doc.uri, 0);
      } else {
        diagnostics.delete(doc.uri);
        lastOutcome.delete(doc.uri.toString());
      }
      updateStatus();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void scanWorkspace()),
    vscode.window.onDidChangeActiveTextEditor(() => updateStatus()),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('lernatelier')) return;
      diagnostics.clear();
      lastOutcome.clear();
      workspaceFiles.clear();
      watchFiles(context);
      vscode.workspace.textDocuments.forEach(doc => schedule(doc, 0));
      void scanWorkspace();
      updateStatus();
    }),
    watcher.onDidChange(recheckFolder),
    watcher.onDidCreate(recheckFolder),
    watcher.onDidDelete(uri => {
      configDiagnostics.delete(uri);
      recheckFolder(uri);
    }),
    { dispose: () => timers.forEach(t => clearTimeout(t)) },
  );

  watchFiles(context);
  vscode.workspace.textDocuments.forEach(doc => schedule(doc, 0));
  void scanWorkspace();
  updateStatus();
}

export function deactivate(): void {}
