// Lernatelier Checker — VS Code integration.
// Reads only the open document and the lernperiode.json next to it. No network access.
import * as vscode from 'vscode';
import {
  CONFIG_FILE, check, chooseConfig, counts, isConfigFile, periodConfigFile, periodNumberOf, saveTarget, dayBlock, dayLabel, insertLineForDay, isoToGerman, newPeriodText,
  nextDayToPlan, parseConfig, parseDayList, plannedDays, plannedWeekdays, report, summary, todayIso, weekToPlan,
  type CheckOutcome, type ConfigFileInfo, type ConfigResult, type Finding, type LearningPeriodConfig,
} from './core';
import { openCalendar } from './calendarPanel';
import { carryMessage, carrySource, carrySourceFor, carryTarget, planCarry } from './carry';
import { parseDocument } from '../vendor/lernatelier-checker-js/src/index.js';
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
  /** name of the calendar file used (or that would be used) */
  file: string;
  /** why no calendar applies */
  reason: string | null;
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
const REMIND_KEY = 'lernatelier.remindedOn';
const WALKTHROUGH = 'JestingDart4369.lernatelier-checker#start';
let badges: BadgeProvider;
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

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  // Prefer an open (possibly unsaved) editor over the file on disk.
  const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString() && !d.isClosed);
  if (open) return open.getText();
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/** The calendar files in the folder of a Lernperiode: lernperiode-N.json and lernperiode.json. */
async function configFiles(file: vscode.Uri, number: number | null): Promise<ConfigFileInfo[]> {
  const names = [...(number !== null ? [periodConfigFile(number)] : []), CONFIG_FILE];
  const files: ConfigFileInfo[] = [];
  for (const name of names) {
    const text = await readText(vscode.Uri.joinPath(file, '..', name));
    if (text !== undefined) files.push({ name, ...parseConfig(text, name) });
  }
  return files;
}

interface ConfigRead {
  result: ConfigResult;
  /** the calendar file that applies (or lernperiode.json if none does) */
  uri: vscode.Uri;
  found: boolean;
  /** why no calendar applies, or null */
  reason: string | null;
}

/** Reads the calendar that belongs to this Lernperiode (see chooseConfig). */
async function readConfig(doc: vscode.TextDocument | vscode.Uri, text?: string): Promise<ConfigRead> {
  const file = 'uri' in doc ? doc.uri : doc;
  const body = text ?? ('uri' in doc ? doc.getText() : (await readText(file)) ?? '');
  const number = periodNumberOf(file.path.split('/').pop() ?? '', body);
  const choice = chooseConfig(number, await configFiles(file, number));
  if (!choice.file) {
    return { result: { config: {}, errors: [] }, uri: vscode.Uri.joinPath(file, '..', CONFIG_FILE), found: false, reason: choice.reason };
  }
  return {
    result: { config: choice.file.config, errors: choice.file.errors },
    uri: vscode.Uri.joinPath(file, '..', choice.file.name), found: true, reason: null,
  };
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
    badges.refresh(uri);
    updateStatus();
    return;
  }
  const cfg = await readConfig(uri, text);
  const notes = [...cfg.result.errors];
  if (cfg.reason) notes.push(cfg.reason);

  let outcome: CheckOutcome;
  try {
    outcome = check(text, cfg.result.config, todayIso());
  } catch (e) {
    // Invalid configuration values make the library throw: check again without the calendar.
    notes.push(`Kalender nicht verwendet: ${(e as Error).message}`);
    outcome = check(text, {}, todayIso());
  }
  diagnostics.set(uri, outcome.findings.map(toDiagnostic));
  // Only the calendar file that is actually used gets its problems shown.
  if (cfg.found) configDiagnostics.set(cfg.uri, cfg.result.errors.map(message => {
    const d = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), message, vscode.DiagnosticSeverity.Error);
    d.source = SOURCE;
    return d;
  }));
  const days = cfg.result.config.periodDays ?? [];
  const today = todayIso();
  const next = days.find(d => d > today) ?? null;
  lastOutcome.set(uri.toString(), {
    outcome, notes, config: cfg.result.config,
    calendar: { found: cfg.found, days: days.length, next: next ? dayLabel(next) : null, problems: cfg.result.errors, file: cfg.uri.path.split('/').pop() ?? CONFIG_FILE, reason: cfg.reason },
  });
  badges.refresh(uri);
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

// ---- explorer badges ----------------------------------------------------------------------

/**
 * A ✓ after finished Lernperioden and a – after ignored ones. Red and yellow come from VS Code's own
 * problem decorations (the diagnostics), so they are not repeated here.
 */
class BadgeProvider implements vscode.FileDecorationProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!settings().get<boolean>('enable', true) || !settings().get<boolean>('explorerBadges', true)) return undefined;
    const key = uri.toString();
    if (ignored.has(key)) return new vscode.FileDecoration('–', 'Lernatelier: ignoriert', new vscode.ThemeColor('disabledForeground'));
    if (lastOutcome.get(key)?.outcome.result.status === 'green') {
      return new vscode.FileDecoration('✓', 'Lernatelier: alles in Ordnung', new vscode.ThemeColor('testing.iconPassed'));
    }
    return undefined;
  }

  refresh(uris?: vscode.Uri | vscode.Uri[]): void {
    this.emitter.fire(uris);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

// ---- carrying open work packages over -------------------------------------------------------

/** The Lernperiode a command works on: the given uri, the active Lernperiode editor or the current one. */
async function targetDocument(arg: unknown): Promise<vscode.TextDocument | undefined> {
  if (arg instanceof vscode.Uri) return vscode.workspace.openTextDocument(arg);
  trackActiveEditor();
  const active = vscode.window.activeTextEditor?.document;
  return active && active.languageId === 'markdown' ? active : currentDoc;
}

/** Copies the not yet ticked work packages of a day into the next day (or a new day). */
async function carryOver(arg?: unknown, fromArg?: number, toArg?: number): Promise<void> {
  const doc = await targetDocument(arg);
  if (!doc) {
    void vscode.window.showInformationMessage('Öffnen Sie zuerst eine Lernperiode-Datei.');
    return;
  }
  const text = doc.getText();
  const today = todayIso();
  const parsed = parseDocument(text);
  const from = typeof fromArg === 'number' ? fromArg : carrySource(parsed, today);
  if (from < 0) {
    void vscode.window.showInformationMessage('Bis heute gibt es keine offenen Arbeitspakete (alle abgehakt oder noch Platzhalter).');
    return;
  }
  const fromDate = parsed.days[from]!.date!;
  const to = typeof toArg === 'number' ? toArg : carryTarget(parsed, from);
  let newDay: string | undefined;
  if (to < 0) {
    const { result } = await readConfig(doc);
    const planned = plannedDays(text);
    newDay = result.config.periodDays?.find(d => d > fromDate && !planned.has(d));
    if (!newDay) {
      const input = await vscode.window.showInputBox({
        prompt: `Datum der Tagesplanung, in die die offenen Arbeitspakete vom ${isoToGerman(fromDate)} kommen (TT.MM.JJJJ)`,
        value: today > fromDate ? isoToGerman(today) : '',
        validateInput: v => {
          const parsedInput = parseDayList(v);
          if (parsedInput.days.length !== 1 || parsedInput.invalid.length) return 'Bitte ein Datum im Format TT.MM.JJJJ eingeben.';
          return parsedInput.days[0]! > fromDate ? undefined : `Das Datum muss nach dem ${isoToGerman(fromDate)} liegen.`;
        },
      });
      if (input === undefined) return;
      newDay = parseDayList(input).days[0]!;
    }
  }
  const plan = planCarry(text, parsed, from, to, newDay);
  if (!plan) {
    void vscode.window.showInformationMessage('Die offenen Arbeitspakete stehen schon in der nächsten Tagesplanung.');
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  for (const e of plan.edits) edit.replace(doc.uri, toRange(e.range), e.newText);
  await vscode.workspace.applyEdit(edit);
  const editor = await vscode.window.showTextDocument(doc);
  const pos = new vscode.Position(plan.line, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  void vscode.window.showInformationMessage(carryMessage(plan));
}

// ---- daily reminder ---------------------------------------------------------------------------

/** Once a day: tells you when the plan for today or the next school day is still missing. */
async function remind(): Promise<void> {
  if (!settings().get<boolean>('enable', true) || !settings().get<boolean>('reminder', true)) return;
  const today = todayIso();
  if (extensionContext.workspaceState.get<string>(REMIND_KEY) === today) return;
  let due: { uri: vscode.Uri; day: string } | undefined;
  for (const [key, entry] of lastOutcome) {
    if (!entry.calendar.found || ignored.has(key)) continue;
    const day = entry.config.periodDays?.find(d => d >= today);
    if (!day || entry.outcome.result.document.days.some(d => d.date === day)) continue;
    const uri = workspaceFiles.get(key) ?? vscode.workspace.textDocuments.find(d => d.uri.toString() === key)?.uri;
    if (uri && (!due || day < due.day)) due = { uri, day };
  }
  if (!due) return;
  await extensionContext.workspaceState.update(REMIND_KEY, today);
  const name = vscode.workspace.asRelativePath(due.uri);
  const message = due.day === today
    ? `Heute ist Lernatelier: Die Tagesplanung für ${dayLabel(due.day)} fehlt noch in ${name}.`
    : `Die Tagesplanung für den nächsten Unterrichtstag (${dayLabel(due.day)}) fehlt noch in ${name}.`;
  const insert = 'Jetzt einfügen';
  const never = 'Nicht mehr erinnern';
  const answer = await vscode.window.showInformationMessage(message, insert, never);
  if (answer === insert) {
    await vscode.window.showTextDocument(due.uri);
    await addDay();
  } else if (answer === never) {
    await settings().update('reminder', false, vscode.ConfigurationTarget.Global);
  }
}

// ---- quick fixes ------------------------------------------------------------------------

function toRange(r: TextEdit['range']): vscode.Range {
  return new vscode.Range(r.startLine, r.startCharacter, r.endLine, r.endCharacter);
}

class FixProvider implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  /** On a day heading: take over the open work packages of the previous day. */
  private carryAction(doc: vscode.TextDocument, text: string, line: number): vscode.CodeAction | undefined {
    if (!/^#{1,6}\s+(?:Planung\s+)?\d{1,2}\.\d{1,2}\.\d{4}\s*$/i.test(text.split(/\r?\n/)[line] ?? '')) return undefined;
    const parsed = parseDocument(text);
    const to = parsed.days.findIndex(d => d.position?.start.line === line + 1);
    const from = to >= 0 ? carrySourceFor(parsed, to) : -1;
    const plan = from >= 0 ? planCarry(text, parsed, from, to) : null;
    if (!plan) return undefined;
    const n = plan.tasks.length;
    const action = new vscode.CodeAction(
      `${n} ${n === 1 ? 'offenes Arbeitspaket' : 'offene Arbeitspakete'} vom ${isoToGerman(plan.from)} übernehmen`, vscode.CodeActionKind.QuickFix);
    action.command = { command: 'lernatelier.carryOver', title: action.title, arguments: [doc.uri, from, to] };
    return action;
  }

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
    const carry = this.carryAction(doc, text, _range.start.line);
    if (carry) actions.push(carry);
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
  badges.refresh(uri);
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
  badges.refresh(uris);
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
    calendarItem.tooltip = `${cal.reason ?? 'Noch kein Kalender.'} Klicken, um den Kalender zu erstellen.`;
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
    notes: entry.notes.filter(n => n !== cal.reason),
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
  if (cfg.reason) notes.push(cfg.reason);
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
  const text = source?.getText() ?? '';
  const number = source ? periodNumberOf(source.uri.path.split('/').pop() ?? '', text) : null;
  const files = await configFiles(vscode.Uri.joinPath(folder, 'x.md'), number);
  // Write lernperiode.json if it is free or belongs to this Lernperiode, else lernperiode-N.json.
  const configName = saveTarget(number, files);
  const existingFile = files.find(f => f.name === configName);
  openCalendar({
    folder,
    configName,
    config: existingFile?.config,
    existing: !!existingFile,
    text,
    docName: source ? vscode.workspace.asRelativePath(source.uri) : undefined,
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

/** Inserts the plans for all school days of the coming week that are still missing. */
async function planWeek(): Promise<void> {
  trackActiveEditor();
  let editor = vscode.window.activeTextEditor;
  if ((!editor || editor.document.languageId !== 'markdown') && currentDoc) editor = await vscode.window.showTextDocument(currentDoc);
  if (!editor || editor.document.languageId !== 'markdown') {
    void vscode.window.showInformationMessage('Öffnen Sie zuerst eine Lernperiode-Datei.');
    return;
  }
  const doc = editor.document;
  const text = doc.getText();
  const { result, found } = await readConfig(doc);
  const days = weekToPlan(found ? result.config : {}, plannedDays(text), todayIso(), plannedWeekdays(text));
  if (!days.length) {
    if (found) {
      void vscode.window.showInformationMessage('Die nächsten Unterrichtstage sind schon alle geplant.');
    } else {
      const create = 'Kalender erstellen';
      const answer = await vscode.window.showInformationMessage(
        'Ohne Kalender und ohne bisherige Tagesplanungen weiss die Erweiterung nicht, an welchen Tagen Lernatelier ist.', create);
      if (answer === create) await createConfig();
    }
    return;
  }
  const line = insertLineForDay(text);
  const atEnd = line >= doc.lineCount;
  const position = atEnd ? doc.lineAt(doc.lineCount - 1).range.end : new vscode.Position(line, 0);
  await editor.edit(edit => edit.insert(position, (atEnd ? '\n\n' : '') + days.map(d => dayBlock(d)).join('')));
  const first = position.line + (atEnd ? 2 : 0);
  editor.selection = new vscode.Selection(first + 2, 6, first + 2, 6 + '...Ihr Text...'.length);
  editor.revealRange(new vscode.Range(first, 0, first, 0), vscode.TextEditorRevealType.InCenter);
  void vscode.window.showInformationMessage(
    `${days.length} ${days.length === 1 ? 'Tagesplanung' : 'Tagesplanungen'} eingefügt: ${days.map(dayLabel).join(', ')}.`);
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
  badges = new BadgeProvider();
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
  const watcher = vscode.workspace.createFileSystemWatcher('**/lernperiode*.json');

  context.subscriptions.push(
    diagnostics, configDiagnostics, output, statusItem, calendarItem, watcher,
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar),
    badges, vscode.window.registerFileDecorationProvider(badges),
    vscode.commands.registerCommand('lernatelier.carryOver', carryOver),
    vscode.commands.registerCommand('lernatelier.planWeek', planWeek),
    vscode.commands.registerCommand('lernatelier.welcome', () =>
      vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH, false)),
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
      if (isConfigFile(doc.uri.path.split('/').pop() ?? '')) recheckFolder(doc.uri);
      else schedule(doc, 0);
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (isConfigFile(e.document.uri.path.split('/').pop() ?? '')) recheckFolder(e.document.uri);
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
      badges.refresh();
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
  void scanWorkspace().then(remind);
  updateStatus();
}

export function deactivate(): void {}
