// Helpers for everyday writing: ticking work packages, jumping between days, the live counter,
// the review of a Lernperiode and taking things over into a new one. No VS Code dependencies.
import { defaultRules } from '../vendor/lernatelier-checker-js/src/index.js';
import type { DayEntry, Documentation, Rules, Task, TextContent } from '../vendor/lernatelier-checker-js/src/index.js';
import { dayLabel } from './core';

const lineOf = (p?: { start: { line: number } }) => (p ? p.start.line - 1 : -1);
const endOf = (p?: { end: { line: number } }) => (p ? p.end.line - 1 : -1);
const HEADING = /^#{1,6}\s/;

// ---- ticking work packages -----------------------------------------------------------------

/** "- [ ] x" ↔ "- [x] x"; null if the line is not a work package. */
export function toggleTaskLine(line: string): string | null {
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/.exec(line);
  return m ? `${m[1]}${m[2] === ' ' ? 'x' : ' '}${m[3]}` : null;
}

// ---- jumping between days --------------------------------------------------------------------

/** Heading lines of all days, in document order. */
export function dayLines(doc: Documentation): number[] {
  return doc.days.map(d => lineOf(d.position)).filter(l => l >= 0).sort((a, b) => a - b);
}

/** Line of today's plan; else of the next planned day; else of the last day; -1 without days. */
export function todayLine(doc: Documentation, today: string): number {
  const dated = doc.days.filter(d => d.date && d.position).sort((a, b) => a.date!.localeCompare(b.date!));
  const day = dated.find(d => d.date === today) ?? dated.find(d => d.date! > today) ?? dated[dated.length - 1];
  return day ? lineOf(day.position) : (dayLines(doc)[0] ?? -1);
}

/**
 * Heading line of the next (dir 1) or previous (dir -1) day seen from `line`; -1 if there is none.
 * Inside a day, "previous" first goes to that day's own heading.
 */
export function neighbourDay(doc: Documentation, line: number, dir: 1 | -1): number {
  const lines = dayLines(doc);
  return (dir === 1 ? lines.find(l => l > line) : [...lines].reverse().find(l => l < line)) ?? -1;
}

/** The day whose section contains `line`, else undefined. */
export function dayAt(doc: Documentation, lines: readonly string[], line: number): DayEntry | undefined {
  let best: DayEntry | undefined;
  for (const d of doc.days) {
    const start = lineOf(d.position);
    if (start < 0 || start > line) continue;
    if (!best || start > lineOf(best.position)) best = d;
  }
  if (!best) return undefined;
  // the day ends at the next heading of the same or a higher level
  const start = lineOf(best.position);
  const level = /^#+/.exec(lines[start] ?? '')?.[0].length ?? 6;
  for (let i = start + 1; i <= line; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i] ?? '');
    if (m && m[1]!.length <= level) return undefined;
  }
  return best;
}

// ---- live counter ----------------------------------------------------------------------------

export interface Counter {
  label: string;
  value: number;
  min: number;
  /** null: no upper limit */
  max: number | null;
  unit: 'Wörter' | 'Zeichen';
  ok: boolean;
}

/** "62/50–100 Wörter" or "34/50 Zeichen" */
export function counterText(c: Counter): string {
  return `${c.value}/${c.min}${c.max === null ? '' : `–${c.max}`} ${c.unit}`;
}

/** Last line of the section that starts at heading line `start`: up to the next heading. */
function sectionEnd(lines: readonly string[], start: number): number {
  for (let i = start + 1; i < lines.length; i++) if (HEADING.test(lines[i]!)) return i - 1;
  return lines.length - 1;
}

/** What is counted at the cursor: a daily reflection, the period reflection or an overview section. */
export function counterAt(doc: Documentation, text: string, line: number, rules: Rules = defaultRules): Counter | null {
  const lines = text.split(/\r?\n/);
  const inside = (c?: TextContent) => {
    const start = lineOf(c?.position);
    return start >= 0 && line >= start && line <= sectionEnd(lines, start);
  };
  const words = (label: string, c: TextContent, [min, max]: readonly [number, number]): Counter =>
    ({ label, value: c.wordCount, min, max, unit: 'Wörter', ok: c.wordCount >= min && c.wordCount <= max });
  for (const day of doc.days) {
    if (day.absent) continue;
    const own = lineOf(day.reflection.position) !== lineOf(day.position);
    // a reflection written directly under the day heading counts for the whole day section
    if (own ? inside(day.reflection) : dayAt(doc, lines, line) === day) {
      if (!own && lines[line] !== undefined && toggleTaskLine(lines[line]!) !== null) return null;
      return words(`Tagesreflexion ${day.date ? dayLabel(day.date) : day.heading}`, day.reflection, rules.dailyReflectionWords);
    }
  }
  if (inside(doc.reflection)) return words('Lernperiodenreflexion', doc.reflection, rules.periodReflectionWords);
  const names = { grades: 'Noten', changes: 'Veränderungen', projects: 'Projekte', goals: 'Generelle Ziele' } as const;
  for (const key of ['grades', 'changes', 'projects', 'goals'] as const) {
    const c = doc.overview[key];
    if (c && inside(c)) {
      return { label: names[key], value: c.text.length, min: rules.minOverviewCharacters, max: null, unit: 'Zeichen', ok: c.text.length >= rules.minOverviewCharacters };
    }
  }
  return null;
}

// ---- today ------------------------------------------------------------------------------------

export interface TodayTask {
  text: string;
  checked: boolean;
  /** zero-based line of the work package */
  line: number;
}

export interface TodayView {
  label: string;
  line: number;
  absent: boolean;
  tasks: TodayTask[];
  reflectionWords: number;
  min: number;
  max: number;
}

/** Today's plan for the sidebar; null if there is no section for today. */
export function todayView(doc: Documentation, today: string, rules: Rules = defaultRules): TodayView | null {
  const day = doc.days.find(d => d.date === today);
  if (!day) return null;
  return {
    label: dayLabel(today), line: lineOf(day.position), absent: day.absent,
    tasks: day.tasks.filter(t => t.filled && t.position).map(t => ({ text: t.text, checked: t.checked, line: lineOf(t.position) })),
    reflectionWords: day.reflection.wordCount, min: rules.dailyReflectionWords[0], max: rules.dailyReflectionWords[1],
  };
}

// ---- review of the whole Lernperiode -----------------------------------------------------------

export interface ReviewDay {
  label: string;
  absent: boolean;
  tasks: { text: string; checked: boolean }[];
  reflection: string;
}

export interface Review {
  number: number | null;
  goals: string;
  projects: string;
  days: ReviewDay[];
  tasksDone: number;
  tasksOpen: number;
  absentDays: number;
  /** work packages that were never ticked, oldest first, without duplicates */
  open: string[];
  reflection: Counter;
}

/** Everything you want in view while writing the Lernperiodenreflexion. */
export function review(doc: Documentation, rules: Rules = defaultRules): Review {
  const days = [...doc.days].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  const filled = (d: DayEntry): Task[] => d.tasks.filter(t => t.filled);
  const done = new Set(days.flatMap(d => filled(d).filter(t => t.checked).map(t => t.text.toLocaleLowerCase('de'))));
  const open: string[] = [];
  for (const t of days.flatMap(d => filled(d).filter(t => !t.checked))) {
    // a package carried over and ticked later is not open any more
    if (!done.has(t.text.toLocaleLowerCase('de')) && !open.includes(t.text)) open.push(t.text);
  }
  const [min, max] = rules.periodReflectionWords;
  return {
    number: doc.number,
    goals: doc.overview.goals?.text ?? '',
    projects: doc.overview.projects?.text ?? '',
    days: days.map(d => ({
      label: d.date ? dayLabel(d.date) : d.heading, absent: d.absent,
      tasks: filled(d).map(t => ({ text: t.text, checked: t.checked })), reflection: d.reflection.text,
    })),
    tasksDone: days.reduce((n, d) => n + filled(d).filter(t => t.checked).length, 0),
    tasksOpen: open.length,
    absentDays: days.filter(d => d.absent).length,
    open,
    reflection: { label: 'Lernperiodenreflexion', value: doc.reflection.wordCount, min, max, unit: 'Wörter',
      ok: doc.reflection.wordCount >= min && doc.reflection.wordCount <= max },
  };
}

// ---- taking things over into a new Lernperiode ---------------------------------------------------

export interface TakeOver {
  name?: boolean;
  projects?: boolean;
  goals?: boolean;
  tasks?: boolean;
}

/** What the previous Lernperiode has to offer. */
export function takeOverChoices(prev: Documentation): Required<TakeOver> {
  return {
    name: !!prev.name,
    projects: !!prev.overview.projects?.text,
    goals: !!prev.overview.goals?.text,
    tasks: review(prev).open.length > 0,
  };
}

/** Markdown of a section body without HTML comments and surrounding blank lines. */
function sectionSource(lines: readonly string[], heading: number): string {
  const body = lines.slice(heading + 1, sectionEnd(lines, heading) + 1).join('\n');
  return body.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\n/, '').replace(/\s+$/, '');
}

/** Replaces the first "...Ihr Text..." paragraph below the heading matching `pattern`. */
function fillSection(lines: string[], pattern: RegExp, source: string): void {
  const heading = lines.findIndex(l => pattern.test(l));
  if (heading < 0 || !source) return;
  const end = sectionEnd(lines, heading);
  const at = lines.findIndex((l, i) => i > heading && i <= end && l.trim() === '...Ihr Text...');
  if (at >= 0) lines.splice(at, 1, ...source.split('\n'));
}

/**
 * Fills a new Lernperiode (made from the template) with parts of the previous one: the name, the
 * sections "Projekte" and "Generelle Ziele", and the work packages that were never ticked (as the
 * first day's plan). Noten and Veränderungen are left empty on purpose: they are about the new period.
 */
export function takeOver(fresh: string, prevText: string, prev: Documentation, what: TakeOver): string {
  const eol = fresh.includes('\r\n') ? '\r\n' : '\n';
  const lines = fresh.split(/\r?\n/);
  const prevLines = prevText.split(/\r?\n/);
  if (what.name && prev.name) {
    const at = lines.findIndex(l => /^\s*(?:[-*]\s+)?Name:/.test(l));
    if (at >= 0) lines[at] = lines[at]!.replace(/(Name:).*$/, `$1 ${prev.name}`);
  }
  if (what.projects && prev.overview.projects?.position) {
    fillSection(lines, /^#{2,6}\s+Projekte/i, sectionSource(prevLines, lineOf(prev.overview.projects.position)));
  }
  if (what.goals && prev.overview.goals?.position) {
    fillSection(lines, /^#{2,6}\s+Generelle Ziele/i, sectionSource(prevLines, lineOf(prev.overview.goals.position)));
  }
  if (what.tasks) {
    const open = new Set(review(prev).open);
    const blocks: string[] = [];
    for (const t of prev.days.flatMap(d => d.tasks)) {
      if (!t.filled || t.checked || !open.delete(t.text) || !t.position) continue;
      const block = prevLines.slice(lineOf(t.position), endOf(t.position) + 1);
      const indent = /^\s*/.exec(block[0] ?? '')![0].length;
      blocks.push(block.map(l => l.slice(Math.min(indent, /^\s*/.exec(l)![0].length))).join('\n'));
    }
    const heading = lines.findIndex(l => /^#{2,6}\s+(?:Planung\s+)?(?:tt\.mm\.jjjj|\d{1,2}\.\d{1,2}\.\d{4})\s*$/i.test(l));
    if (heading >= 0 && blocks.length) {
      const end = sectionEnd(lines, heading);
      const placeholders: number[] = [];
      for (let i = heading + 1; i <= end; i++) if (/^\s*[-*+]\s+\[ \]\s+\.\.\.Ihr Text\.\.\.\s*$/.test(lines[i]!)) placeholders.push(i);
      // replace from the bottom so earlier indexes stay valid; extra packages go after the last placeholder
      const extra = blocks.slice(placeholders.length);
      const last = placeholders[placeholders.length - 1];
      if (extra.length && last !== undefined) lines.splice(last + 1, 0, ...extra.flatMap(b => b.split('\n')));
      for (let i = Math.min(placeholders.length, blocks.length) - 1; i >= 0; i--) {
        lines.splice(placeholders[i]!, 1, ...blocks[i]!.split('\n'));
      }
    }
  }
  return lines.join(eol);
}
