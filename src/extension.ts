// Lernatelier Checker — VS Code integration.
// Reads only the open document and the lernperiode.json next to it. No network access.
import * as vscode from 'vscode';
import {
  CONFIG_FILE, check, counts, dayBlock, dayLabel, insertLineForDay, isoToGerman, newPeriodText,
  nextDayToPlan, parseConfig, parseDayList, report, summary, todayIso,
  type CheckOutcome, type ConfigResult, type Finding,
} from './core';
import { openCalendar } from './calendarPanel';
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
const lastOutcome = new Map<string, { outcome: CheckOutcome; notes: string[]; calendar: CalendarInfo }>();

function settings() {
  return vscode.workspace.getConfiguration('lernatelier');
}

function isLernperiode(doc: vscode.TextDocument): boolean {
  if (doc.languageId !== 'markdown' || doc.uri.scheme === 'output') return false;
  const pattern = settings().get<string>('filePattern', '**/Lernperiode-*.md');
  return vscode.languages.match({ language: 'markdown', pattern }, doc) > 0;
}

function configUri(doc: vscode.TextDocument): vscode.Uri {
  return vscode.Uri.joinPath(doc.uri, '..', CONFIG_FILE);
}

async function readConfig(doc: vscode.TextDocument): Promise<{ result: ConfigResult; uri: vscode.Uri; found: boolean }> {
  const uri = configUri(doc);
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
  const cfg = await readConfig(doc);
  const notes = [...cfg.result.errors];
  if (!cfg.found) notes.push(`${CONFIG_FILE} nicht gefunden – Tagesplanungen und Fristen werden ohne Kalender geprüft.`);

  let outcome: CheckOutcome;
  try {
    outcome = check(doc.getText(), cfg.result.config, todayIso());
  } catch (e) {
    // Invalid configuration values make the library throw: check again without the calendar.
    notes.push(`Kalender nicht verwendet: ${(e as Error).message}`);
    outcome = check(doc.getText(), {}, todayIso());
  }
  diagnostics.set(doc.uri, outcome.findings.map(toDiagnostic));
  configDiagnostics.set(cfg.uri, cfg.result.errors.map(message => {
    const d = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), message, vscode.DiagnosticSeverity.Error);
    d.source = SOURCE;
    return d;
  }));
  const days = cfg.result.config.periodDays ?? [];
  const today = todayIso();
  const next = days.find(d => d > today) ?? null;
  lastOutcome.set(doc.uri.toString(), {
    outcome, notes,
    calendar: { found: cfg.found, days: days.length, next: next ? dayLabel(next) : null, problems: cfg.result.errors },
  });
  updateStatus();
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

function updateStatus(): void {
  trackActiveEditor();
  const doc = currentDoc;
  const enabled = settings().get<boolean>('enable', true);
  const entry = doc && enabled ? lastOutcome.get(doc.uri.toString()) : undefined;
  if (!doc || !enabled) {
    statusItem.hide();
    calendarItem.hide();
    sidebar.update(emptyState());
    return;
  }
  const state: SidebarState = {
    ...emptyState(),
    file: { name: vscode.workspace.asRelativePath(doc.uri), uri: doc.uri.toString() },
  };
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

  const recheckFolder = (uri: vscode.Uri) => {
    for (const doc of vscode.workspace.textDocuments) {
      if (vscode.Uri.joinPath(doc.uri, '..').toString() === vscode.Uri.joinPath(uri, '..').toString()) schedule(doc, 100);
    }
  };
  const watcher = vscode.workspace.createFileSystemWatcher(`**/${CONFIG_FILE}`);

  context.subscriptions.push(
    diagnostics, configDiagnostics, output, statusItem, calendarItem, watcher,
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
    vscode.commands.registerCommand('lernatelier.openPeriod', openPeriod),
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
      diagnostics.delete(doc.uri);
      lastOutcome.delete(doc.uri.toString());
      if (currentDoc === doc) {
        currentDoc = undefined;
        updateStatus();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => updateStatus()),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('lernatelier')) return;
      diagnostics.clear();
      lastOutcome.clear();
      vscode.workspace.textDocuments.forEach(doc => schedule(doc, 0));
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

  vscode.workspace.textDocuments.forEach(doc => schedule(doc, 0));
  updateStatus();
}

export function deactivate(): void {}
