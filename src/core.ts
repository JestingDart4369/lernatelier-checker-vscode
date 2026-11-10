// Logic without VS Code dependencies, so it can be unit-tested with plain Node.
import { analyse } from '../vendor/lernatelier-checker-js/src/index.js';
import type { CheckOptions, CheckResult, Diagnostic, Status } from '../vendor/lernatelier-checker-js/src/index.js';

export type { CheckResult, Diagnostic, Status };

/** Zero-based range, as VS Code uses it. */
export interface Range {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export interface Finding {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  range: Range;
  /** true when the library gave no position and the range was derived from the text */
  located: boolean;
}

export interface LearningPeriodConfig {
  learningPeriod?: number;
  periodDays?: string[];
}

export interface ConfigResult {
  config: LearningPeriodConfig;
  /** problems with lernperiode.json, in German, for the user */
  errors: string[];
}

export const CONFIG_FILE = 'lernperiode.json';

// ---- which calendar belongs to which Lernperiode ------------------------------------------
// One folder can hold several Lernperioden. lernperiode.json (the Python tool's format) applies to
// the Lernperiode whose number matches its "learningperiod" (or to all, if it has none).
// lernperiode-N.json applies only to Lernperiode N and takes precedence.

/** lernperiode.json or lernperiode-N.json */
export function isConfigFile(name: string): boolean {
  return /^lernperiode(?:-\d+)?\.json$/i.test(name);
}

export function periodConfigFile(number: number): string {
  return `lernperiode-${number}.json`;
}

/** Number of a Lernperiode: from "Lernperiode-N.md", else from the heading "# Lern-Periode N". */
export function periodNumberOf(fileName: string, text: string): number | null {
  const m = /Lernperiode-(\d+)/i.exec(fileName);
  return m ? Number(m[1]) : numberFromText(text);
}

export interface ConfigFileInfo {
  name: string;
  config: LearningPeriodConfig;
  errors: string[];
}

export interface ConfigChoice {
  /** the file that applies, or null */
  file: ConfigFileInfo | null;
  /** why no calendar applies (in German), or null */
  reason: string | null;
}

export function chooseConfig(number: number | null, files: readonly ConfigFileInfo[]): ConfigChoice {
  if (number !== null) {
    const own = files.find(f => f.name.toLowerCase() === periodConfigFile(number));
    if (own) return { file: own, reason: null };
  }
  const shared = files.find(f => f.name.toLowerCase() === CONFIG_FILE);
  if (!shared) return { file: null, reason: `Kein Kalender (${CONFIG_FILE}) – Tagesplanungen und Fristen werden ohne Kalender geprüft.` };
  const belongsTo = shared.config.learningPeriod;
  if (belongsTo === undefined || number === null || belongsTo === number) return { file: shared, reason: null };
  return {
    file: null,
    reason: `${CONFIG_FILE} gehört zu Lernperiode ${belongsTo}. Diese Lernperiode wird ohne Kalender geprüft; ein eigener Kalender wäre ${periodConfigFile(number)}.`,
  };
}

/** File the calendar editor writes for Lernperiode `number`, given the calendar files in the folder. */
export function saveTarget(number: number | null, files: readonly ConfigFileInfo[]): string {
  if (number === null) return CONFIG_FILE;
  if (files.some(f => f.name.toLowerCase() === periodConfigFile(number))) return periodConfigFile(number);
  const shared = files.find(f => f.name.toLowerCase() === CONFIG_FILE);
  if (!shared) return CONFIG_FILE;
  const belongsTo = shared.config.learningPeriod;
  return belongsTo === undefined || belongsTo === number ? CONFIG_FILE : periodConfigFile(number);
}
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function validIso(value: string): boolean {
  if (!ISO.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Local calendar date as YYYY-MM-DD (not UTC, so the date matches the student's day). */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** TT.MM.JJJJ -> YYYY-MM-DD, or null. */
export function germanToIso(value: string): string | null {
  const m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/.exec(value);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return validIso(iso) ? iso : null;
}

/** YYYY-MM-DD -> TT.MM.JJJJ */
export function isoToGerman(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * Reads lernperiode.json. Same format as the Python lernatelier-checker:
 *   { "learningperiod": 5, "days": ["2026-09-18", "2026-09-25"] }
 * Invalid parts are reported and left out, so the document is still checked.
 */
export function parseConfig(text: string, fileName: string = CONFIG_FILE): ConfigResult {
  const errors: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { config: {}, errors: [`${fileName} ist kein gültiges JSON: ${(e as Error).message}`] };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { config: {}, errors: [`${fileName} muss ein Objekt mit "learningperiod" und "days" sein.`] };
  }
  const obj = data as Record<string, unknown>;
  const config: LearningPeriodConfig = {};

  if (obj.learningperiod !== undefined) {
    if (Number.isSafeInteger(obj.learningperiod) && (obj.learningperiod as number) >= 1) {
      config.learningPeriod = obj.learningperiod as number;
    } else {
      errors.push('"learningperiod" muss eine ganze Zahl ab 1 sein.');
    }
  }

  if (obj.days !== undefined) {
    if (!Array.isArray(obj.days)) {
      errors.push('"days" muss eine Liste von Daten im Format JJJJ-MM-TT sein.');
    } else {
      const bad = obj.days.filter(d => typeof d !== 'string' || !validIso(d));
      const good = obj.days.filter((d): d is string => typeof d === 'string' && validIso(d));
      if (bad.length) errors.push(`Ungültige Daten in "days" (erwartet JJJJ-MM-TT): ${bad.map(String).join(', ')}`);
      const unique = [...new Set(good)].sort();
      if (unique.length !== good.length) errors.push('"days" enthält doppelte Daten.');
      if (unique.length) config.periodDays = unique;
    }
  }
  return { config, errors };
}

/** Builds the options for the library. Calendar checks need both days and today. */
export function checkOptions(config: LearningPeriodConfig, today: string): CheckOptions {
  const options: CheckOptions = {};
  if (config.learningPeriod !== undefined) options.learningPeriod = config.learningPeriod;
  if (config.periodDays?.length) {
    options.periodDays = config.periodDays;
    options.today = today;
  }
  return options;
}

const lineRange = (line: number, text: string): Range => ({
  startLine: line,
  startCharacter: 0,
  endLine: line,
  endCharacter: Math.max(text.length, 1),
});

function findLine(lines: string[], pattern: RegExp): number {
  return lines.findIndex(l => pattern.test(l));
}

/** Where to show findings that the library reports without a position. */
function fallbackLine(code: string, lines: string[]): number {
  const title = findLine(lines, /^#\s+Lern[\s-]*Periode\b/i);
  const pick = (...candidates: number[]) => candidates.find(n => n >= 0) ?? 0;
  if (code === 'name.missing') return pick(findLine(lines, /^\s*(?:[-*]\s+)?Name:/), title);
  if (code === 'period.range' || code === 'period.calendar-range') return pick(findLine(lines, /^\s*(?:[-*]\s+)?Zeitraum:/), title);
  if (code.startsWith('period.')) return pick(title);
  if (code.startsWith('overview.')) return pick(findLine(lines, /^#+\s+Grob[\s-]*Planung\s*$/i), title);
  if (code === 'days.missing' || code === 'day.missing') return pick(findLine(lines, /^#+\s+Tagesplanungen\s*$/i), title);
  if (code.startsWith('reflection.period')) return pick(findLine(lines, /^#+\s+Lernperiode\s+Reflexion\s*$/i), title);
  return pick(title);
}

/** Converts library diagnostics (one-based, optional position) to zero-based ranges in the document. */
export function toFindings(diagnostics: Diagnostic[], text: string): Finding[] {
  const lines = text.split(/\r?\n/);
  return diagnostics.map(d => {
    const p = d.position;
    if (p?.start && p.end) {
      const startLine = Math.max(0, p.start.line - 1);
      const startCharacter = Math.max(0, (p.start.column ?? 1) - 1);
      let endLine = Math.max(startLine, p.end.line - 1);
      let endCharacter = Math.max(0, (p.end.column ?? 1) - 1);
      // Headings and list items end at the start of the next line: keep the mark on one line.
      if (endLine > startLine) {
        endLine = startLine;
        endCharacter = Math.max(lines[startLine]?.length ?? 1, startCharacter + 1);
      }
      if (endLine === startLine && endCharacter <= startCharacter) endCharacter = startCharacter + 1;
      return { code: d.code, severity: d.severity, message: d.message, located: false,
        range: { startLine, startCharacter, endLine, endCharacter } };
    }
    const line = fallbackLine(d.code, lines);
    return { code: d.code, severity: d.severity, message: d.message, located: true, range: lineRange(line, lines[line] ?? '') };
  });
}

export interface CheckOutcome {
  result: CheckResult;
  findings: Finding[];
}

export function check(text: string, config: LearningPeriodConfig = {}, today: string = todayIso()): CheckOutcome {
  const result = analyse(text, checkOptions(config, today));
  return { result, findings: toFindings(result.diagnostics, text) };
}

export function counts(findings: Finding[]): { errors: number; warnings: number } {
  return {
    errors: findings.filter(f => f.severity === 'error').length,
    warnings: findings.filter(f => f.severity === 'warning').length,
  };
}

export const STATUS_LABEL: Record<Status, string> = {
  red: 'Handlungsbedarf',
  yellow: 'Verbesserungsbedarf',
  green: 'Alles in Ordnung',
};

export function summary(status: Status, findings: Finding[]): string {
  const { errors, warnings } = counts(findings);
  const w = `${warnings} ${warnings === 1 ? 'Warnung' : 'Warnungen'}`;
  return `${errors} Fehler, ${w} → ${STATUS_LABEL[status]}`;
}

/** Plain-text report, in the style of the command-line checker. */
export function report(fileName: string, outcome: CheckOutcome, configNote: string[]): string {
  const { result, findings } = outcome;
  const out = [fileName, ''];
  for (const note of configNote) out.push(`  HINWEIS  ${note}`);
  if (configNote.length) out.push('');
  const sorted = [...findings].sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) || a.range.startLine - b.range.startLine);
  for (const f of sorted) {
    const label = f.severity === 'error' ? 'FEHLER ' : 'WARNUNG';
    out.push(`  ${label}  Zeile ${f.range.startLine + 1}: ${f.message}`);
  }
  if (findings.length) out.push('');
  out.push(result.calendarChecksApplied
    ? '  Kalender aus lernperiode.json: Tagesplanungen und Fristen geprüft.'
    : '  Ohne lernperiode.json: alle Tage und beide Reflexionen werden als fertig geprüft.');
  out.push('');
  out.push(summary(result.status, findings));
  return out.join('\n');
}

// ---- helpers for the commands --------------------------------------------------------

/** New document from the template, with the learning period number filled in. */
export function newPeriodText(template: string, number: number): string {
  return template.replace(/^# Lern-Periode NR\s*$/m, `# Lern-Periode ${number}`);
}

export function configText(number: number, days: string[]): string {
  return JSON.stringify({ learningperiod: number, days }, null, 2) + '\n';
}

/** Parses "18.09.2026, 25.09.2026" (also ISO, spaces or semicolons). Returns days and invalid parts. */
export function parseDayList(input: string): { days: string[]; invalid: string[] } {
  const parts = input.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  const days: string[] = [];
  const invalid: string[] = [];
  for (const part of parts) {
    const iso = validIso(part) ? part : germanToIso(part);
    if (iso) days.push(iso);
    else invalid.push(part);
  }
  return { days: [...new Set(days)].sort(), invalid };
}

export function dayBlock(iso: string, tasks: string[] = []): string {
  return [
    `### Planung ${isoToGerman(iso)}`,
    '',
    ...tasks,
    ...Array(Math.max(0, 3 - tasks.length)).fill('- [ ] ...Ihr Text...'),
    '',
    '#### Tagesreflexion',
    '',
    '...Ihr Text...',
    '',
    '',
  ].join('\n');
}

/** Dates already planned in the document (ISO). */
export function plannedDays(text: string): Set<string> {
  const set = new Set<string>();
  for (const m of text.matchAll(/^#+\s+(?:Planung\s+)?(\d{1,2}\.\d{1,2}\.\d{4})\s*$/gim)) {
    const iso = germanToIso(m[1]!);
    if (iso) set.add(iso);
  }
  return set;
}

/** The next day to plan: first configured day (from today on) without a section; null if none. */
export function nextDayToPlan(text: string, config: LearningPeriodConfig, today: string): string | null {
  const planned = plannedDays(text);
  return config.periodDays?.find(d => d >= today && !planned.has(d))
    ?? config.periodDays?.find(d => !planned.has(d))
    ?? null;
}

/**
 * Zero-based line where a new day section goes: before "## Lernperiode Reflexion",
 * else at the end of the document.
 */
export function insertLineForDay(text: string): number {
  const lines = text.split(/\r?\n/);
  const reflection = lines.findIndex(l => /^##\s+Lernperiode\s+Reflexion\s*$/i.test(l));
  if (reflection < 0) return lines.length;
  // also skip a closing comment block directly before the heading ("Fügen Sie hier … ein")
  let line = reflection;
  while (line > 0 && lines[line - 1]!.trim() === '') line--;
  if (line > 0 && lines[line - 1]!.trim() === '-->') {
    let start = line - 1;
    while (start > 0 && !lines[start]!.includes('<!--')) start--;
    if (lines[start]!.includes('<!--')) line = start;
  }
  return line;
}

// ---- lernperiode.json generator ---------------------------------------------------------

export const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'] as const;
const WEEKDAY_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;

/** 0 = Sunday … 6 = Saturday, computed in UTC so it does not depend on the time zone. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** "Fr 13.11.2026" */
export function dayLabel(iso: string): string {
  return `${WEEKDAY_SHORT[weekdayOf(iso)]} ${isoToGerman(iso)}`;
}

/** Learning period number from "# Lern-Periode N", or null. */
export function numberFromText(text: string): number | null {
  const m = /^#\s+Lern[\s-]*Periode\s+(\d+)\s*$/im.exec(text);
  return m ? Number(m[1]) : null;
}

/** Zeitraum from "- Zeitraum: TT.MM.JJJJ bis TT.MM.JJJJ" (also "-" or "–"), or null if missing or invalid. */
export function periodFromText(text: string): { start: string; end: string } | null {
  const m = /^\s*(?:[-*]\s+)?Zeitraum:\s*(\S+)\s+(?:bis|[-–])\s+(\S+)\s*$/im.exec(text);
  if (!m) return null;
  const start = germanToIso(m[1]!);
  const end = germanToIso(m[2]!);
  return start && end && start <= end ? { start, end } : null;
}

/** All dates from start to end (inclusive) that fall on one of the weekdays. */
export function generateDays(start: string, end: string, weekdays: readonly number[]): string[] {
  const wanted = new Set(weekdays);
  const days: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  for (let guard = 0; d <= last && guard < 800; guard++) {
    if (wanted.has(d.getUTCDay())) days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

/** Weekdays used by the days already planned in the document, most frequent first. */
export function plannedWeekdays(text: string): number[] {
  const count = new Map<number, number>();
  for (const iso of plannedDays(text)) count.set(weekdayOf(iso), (count.get(weekdayOf(iso)) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([day]) => day);
}

export interface DayChoice {
  iso: string;
  label: string;
  /** shown next to the date */
  note: string;
  picked: boolean;
}

/**
 * Dates to offer in the checklist: every generated weekday in the period, plus days already planned
 * in the document on other dates. All are ticked; the student unticks holidays.
 */
export function dayChoices(text: string, start: string, end: string, weekdays: readonly number[]): DayChoice[] {
  const planned = plannedDays(text);
  const all = new Set([...generateDays(start, end, weekdays), ...[...planned].filter(d => d >= start && d <= end)]);
  return [...all].sort().map(iso => ({
    iso,
    label: dayLabel(iso),
    note: planned.has(iso) ? 'im Dokument geplant' : weekdays.includes(weekdayOf(iso)) ? '' : 'nur im Dokument',
    picked: true,
  }));
}

// ---- calendar editor (webview) ----------------------------------------------------------

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export interface CalendarInit {
  number: number | null;
  start: string | null;
  end: string | null;
  /** where start/end came from */
  periodSource: 'document' | 'config' | 'none';
  weekdays: number[];
  /** dates added by hand or from an existing lernperiode.json that are not on a chosen weekday */
  extra: string[];
  /** generated dates the student has unticked (holidays) */
  unchecked: string[];
  existing: boolean;
}

export interface CalendarRow {
  iso: string;
  label: string;
  month: string;
  checked: boolean;
  note: string;
}

/** Start state of the calendar editor: from an existing lernperiode.json if there is one, else from the document. */
export function calendarInit(text: string, config: LearningPeriodConfig | undefined, existing: boolean): CalendarInit {
  const days = config?.periodDays ?? [];
  const docPeriod = periodFromText(text);
  let start: string | null = docPeriod?.start ?? null;
  let end: string | null = docPeriod?.end ?? null;
  let periodSource: CalendarInit['periodSource'] = docPeriod ? 'document' : 'none';
  if (!docPeriod && days.length) {
    start = days[0]!;
    end = days[days.length - 1]!;
    periodSource = 'config';
  }
  let weekdays: number[];
  if (days.length) {
    weekdays = [...new Set(days.map(weekdayOf))].sort((a, b) => a - b);
  } else {
    weekdays = plannedWeekdays(text);
  }
  const generated = start && end ? generateDays(start, end, weekdays) : [];
  const chosen = new Set(days);
  return {
    number: config?.learningPeriod ?? numberFromText(text),
    start, end, periodSource, weekdays,
    extra: days.filter(d => !weekdays.includes(weekdayOf(d))),
    unchecked: existing && days.length ? generated.filter(d => !chosen.has(d)) : [],
    existing,
  };
}

/** Rows of the date list: every chosen weekday in the period, plus planned and extra days. */
export function calendarRows(
  text: string, start: string | null, end: string | null, weekdays: readonly number[],
  extra: readonly string[], unchecked: readonly string[],
): CalendarRow[] {
  const planned = plannedDays(text);
  const generated = start && end && start <= end ? generateDays(start, end, weekdays) : [];
  const inRange = (d: string) => !start || !end || (d >= start && d <= end);
  const all = new Set([...generated, ...extra, ...[...planned].filter(d => start && end && inRange(d))]);
  const off = new Set(unchecked);
  return [...all].sort().map(iso => {
    const notes: string[] = [];
    if (planned.has(iso)) notes.push('im Dokument geplant');
    if (!weekdays.includes(weekdayOf(iso))) notes.push('zusätzlicher Tag');
    if (!inRange(iso)) notes.push('ausserhalb des Zeitraums');
    const [y, m] = iso.split('-');
    return { iso, label: dayLabel(iso), month: `${MONTHS[Number(m) - 1]} ${y}`, checked: !off.has(iso), note: notes.join(' · ') };
  });
}

/** Problems that block saving, in German. Empty when the calendar can be saved. */
export function calendarProblems(number: number | null, start: string | null, end: string | null, days: readonly string[]): string[] {
  const problems: string[] = [];
  if (!number || !Number.isSafeInteger(number) || number < 1) problems.push('Nummer der Lernperiode fehlt.');
  if (start && end && start > end) problems.push('Der erste Tag liegt nach dem letzten.');
  if (!days.length) problems.push('Mindestens einen Unterrichtstag wählen.');
  return problems;
}
