// Carrying open work packages over to the next day. No VS Code dependencies.
import type { DayEntry, Documentation, Task } from '../vendor/lernatelier-checker-js/src/index.js';
import { dayBlock, insertLineForDay, isoToGerman } from './core';
import type { TextEdit } from './fixes';

/** Filled work packages that are not ticked yet. */
export const openTasks = (day: DayEntry): Task[] => day.tasks.filter(t => t.filled && !t.checked);

const norm = (s: string) => s.toLocaleLowerCase('de').replace(/\s+/g, ' ').trim();
const first = (t: { position?: { start: { line: number } } }) => (t.position ? t.position.start.line - 1 : -1);
const last = (t: { position?: { end: { line: number } } }) => (t.position ? t.position.end.line - 1 : -1);

/** Index of the day to carry from: the latest dated day up to today with open work packages, else -1. */
export function carrySource(doc: Documentation, today: string): number {
  let best = -1;
  doc.days.forEach((d, i) => {
    if (!d.date || d.date > today || d.absent || !openTasks(d).length) return;
    if (best < 0 || d.date >= doc.days[best]!.date!) best = i;
  });
  return best;
}

/** Index of the day after the source (the earliest later date), else -1. */
export function carryTarget(doc: Documentation, source: number): number {
  const from = doc.days[source]?.date;
  if (!from) return -1;
  let best = -1;
  doc.days.forEach((d, i) => {
    if (d.date && d.date > from && (best < 0 || d.date < doc.days[best]!.date!)) best = i;
  });
  return best;
}

/** For a day heading: the latest earlier day with open work packages, else -1. */
export function carrySourceFor(doc: Documentation, target: number): number {
  const to = doc.days[target]?.date;
  if (!to) return -1;
  let best = -1;
  doc.days.forEach((d, i) => {
    if (!d.date || d.date >= to || d.absent || !openTasks(d).length) return;
    if (best < 0 || d.date > doc.days[best]!.date!) best = i;
  });
  return best;
}

export interface CarryPlan {
  from: string;
  /** date of the day the work packages go to */
  to: string;
  /** true if a new day section is inserted */
  created: boolean;
  /** work packages carried over (their text) */
  tasks: string[];
  edits: TextEdit[];
  /** zero-based line to reveal afterwards */
  line: number;
}

/** Markdown of a task list item, dedented, without its nested lists' indentation lost. */
function source(lines: string[], task: Task): string {
  const block = lines.slice(first(task), last(task) + 1);
  const indent = /^\s*/.exec(block[0] ?? '')![0].length;
  return block.map(l => l.slice(Math.min(indent, /^\s*/.exec(l)![0].length))).join('\n');
}

/**
 * Edits that copy the open work packages of day `from` into day `to` (or, with to = -1, into a new
 * day section dated `newDay`). Placeholders are replaced first; packages already there are skipped.
 * Returns null when nothing would change.
 */
export function planCarry(text: string, doc: Documentation, from: number, to: number, newDay?: string): CarryPlan | null {
  const sourceDay = doc.days[from];
  if (!sourceDay?.date) return null;
  const lines = text.split(/\r?\n/);
  const target = to >= 0 ? doc.days[to] : undefined;
  const present = new Set((target?.tasks ?? []).filter(t => t.filled).map(t => norm(t.text)));
  const carry = openTasks(sourceDay).filter(t => !present.has(norm(t.text)));
  if (!carry.length) return null;
  const blocks = carry.map(t => source(lines, t));
  const texts = carry.map(t => t.text);

  if (!target) {
    if (!newDay) return null;
    const at = insertLineForDay(text);
    const atEnd = at >= lines.length;
    const end = lines.length - 1;
    const edit: TextEdit = atEnd
      ? { range: { startLine: end, startCharacter: lines[end]!.length, endLine: end, endCharacter: lines[end]!.length }, newText: '\n\n' + dayBlock(newDay, blocks) }
      : { range: { startLine: at, startCharacter: 0, endLine: at, endCharacter: 0 }, newText: dayBlock(newDay, blocks) };
    return { from: sourceDay.date, to: newDay, created: true, tasks: texts, edits: [edit], line: atEnd ? end + 2 : at };
  }

  const edits: TextEdit[] = [];
  const placeholders = target.tasks.filter(t => !t.filled);
  const rest = [...blocks];
  for (const p of placeholders) {
    if (!rest.length) break;
    const s = first(p), e = last(p);
    const indent = /^\s*/.exec(lines[s]!)![0];
    edits.push({
      range: { startLine: s, startCharacter: 0, endLine: e, endCharacter: lines[e]!.length },
      newText: rest.shift()!.split('\n').map(l => indent + l).join('\n'),
    });
  }
  if (rest.length) {
    const lastTask = target.tasks.at(-1);
    const line = lastTask ? last(lastTask) : first(target);
    edits.push({
      range: { startLine: line, startCharacter: lines[line]!.length, endLine: line, endCharacter: lines[line]!.length },
      newText: (lastTask ? '\n' : '\n\n') + rest.join('\n'),
    });
  }
  return { from: sourceDay.date, to: target.date ?? '', created: false, tasks: texts, edits, line: first(target) };
}

/** "3 offene Arbeitspakete vom 18.09.2026 übernommen" */
export function carryMessage(plan: CarryPlan): string {
  const n = plan.tasks.length;
  return `${n} ${n === 1 ? 'offenes Arbeitspaket' : 'offene Arbeitspakete'} vom ${isoToGerman(plan.from)} in ${plan.created ? 'die neue ' : 'die '}Tagesplanung ${isoToGerman(plan.to)} übernommen.`;
}
