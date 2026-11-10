// Progress of a Lernperiode and the inline hints in the editor. No VS Code dependencies.
import { defaultRules } from '../vendor/lernatelier-checker-js/src/index.js';
import type { Documentation, Rules, TextContent } from '../vendor/lernatelier-checker-js/src/index.js';

/** Calendar of the learning period, as read from lernperiode.json. */
interface Calendar {
  periodDays?: string[];
}

export type DayState =
  /** required and complete (enough work packages, reflection if due) */
  | 'complete'
  /** required, but work packages or a due reflection are missing */
  | 'incomplete'
  /** marked absent: nothing required */
  | 'absent'
  /** the next school day: must be planned already, reflection not yet due */
  | 'next'
  /** later school day: nothing required yet */
  | 'later'
  /** required by the calendar, but there is no section for it */
  | 'missing';

export interface DayProgress {
  date: string | null;
  /** "Fr 13.11.2026" or the heading as written */
  label: string;
  /** zero-based line of the day heading, -1 if missing */
  line: number;
  state: DayState;
  tasksFilled: number;
  tasksDone: number;
  reflectionWords: number;
  /** null when the reflection is not due yet */
  reflectionOk: boolean | null;
}

export interface Progress {
  calendar: boolean;
  days: DayProgress[];
  /** days that are required now (planned until today plus the next school day) */
  required: number;
  /** required days that are complete or absent */
  complete: number;
  tasksFilled: number;
  tasksDone: number;
  reflectionsDue: number;
  reflectionsOk: number;
  overviewDone: number;
  periodReflection: { words: number; min: number; max: number; due: boolean; ok: boolean };
}

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const label = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${WD[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${d}.${m}.${y}`;
};
const lineOf = (p?: TextContent['position'] | { start: { line: number } }) => (p?.start ? p.start.line - 1 : -1);
const within = (n: number, [min, max]: readonly [number, number]) => n >= min && n <= max;

/**
 * Same rules as the library's checkDocument: without a calendar every day is required and every
 * reflection is due; with a calendar, days up to today and the next school day are required.
 */
export function progress(doc: Documentation, calendar: Calendar, today: string, rules: Rules = defaultRules): Progress {
  const periodDays = [...(calendar.periodDays ?? [])].sort();
  const withCalendar = periodDays.length > 0;
  const nextDay = periodDays.find(d => d > today);
  const docDays = new Map(doc.days.filter(d => d.date).map(d => [d.date!, d]));
  const dates = [...new Set([...periodDays, ...docDays.keys()])].sort();

  const days: DayProgress[] = dates.map(date => {
    const day = docDays.get(date);
    const required = !withCalendar || (periodDays.includes(date) && (date <= today || date === nextDay));
    const reflectionDue = !withCalendar || date <= today;
    if (!day) {
      return { date, label: label(date), line: -1, state: required ? 'missing' : 'later',
        tasksFilled: 0, tasksDone: 0, reflectionWords: 0, reflectionOk: null };
    }
    const filled = day.tasks.filter(t => t.filled);
    const tasksOk = within(filled.length, [rules.minTasks, rules.maxTasks]);
    const reflectionOk = reflectionDue ? within(day.reflection.wordCount, rules.dailyReflectionWords) : null;
    let state: DayState;
    if (day.absent) state = 'absent';
    else if (!required) state = 'later';
    else if (!tasksOk || reflectionOk === false) state = 'incomplete';
    else state = date === nextDay && date > today ? 'next' : 'complete';
    return {
      date, label: label(date), line: lineOf(day.position), state,
      tasksFilled: filled.length, tasksDone: filled.filter(t => t.checked).length,
      reflectionWords: day.reflection.wordCount, reflectionOk: day.absent ? null : reflectionOk,
    };
  });
  // Days whose heading has no valid date still appear, so the student sees them.
  for (const day of doc.days.filter(d => !d.date)) {
    days.push({ date: null, label: day.heading, line: lineOf(day.position), state: 'incomplete',
      tasksFilled: day.tasks.filter(t => t.filled).length, tasksDone: day.tasks.filter(t => t.filled && t.checked).length,
      reflectionWords: day.reflection.wordCount, reflectionOk: null });
  }

  const required = days.filter(d => d.state !== 'later');
  const periodDue = !withCalendar || today >= periodDays[periodDays.length - 1]!;
  const [pMin, pMax] = rules.periodReflectionWords;
  return {
    calendar: withCalendar,
    days,
    required: required.length,
    complete: required.filter(d => d.state === 'complete' || d.state === 'absent' || d.state === 'next').length,
    tasksFilled: days.reduce((n, d) => n + d.tasksFilled, 0),
    tasksDone: days.reduce((n, d) => n + d.tasksDone, 0),
    reflectionsDue: days.filter(d => d.reflectionOk !== null).length,
    reflectionsOk: days.filter(d => d.reflectionOk === true).length,
    overviewDone: (['grades', 'changes', 'projects', 'goals'] as const)
      .filter(k => (doc.overview[k]?.text.length ?? 0) >= rules.minOverviewCharacters).length,
    periodReflection: {
      words: doc.reflection.wordCount, min: pMin, max: pMax, due: periodDue,
      ok: within(doc.reflection.wordCount, rules.periodReflectionWords),
    },
  };
}

// ---- inline hints ----------------------------------------------------------------------

export interface InlineHint {
  /** zero-based line */
  line: number;
  text: string;
  level: 'ok' | 'warn' | 'info';
}

/**
 * Short hints at the end of heading lines: work packages per day, reflection word counts,
 * characters in the overview sections and the period reflection.
 */
export function inlineHints(doc: Documentation, calendar: Calendar, today: string, rules: Rules = defaultRules): InlineHint[] {
  const hints: InlineHint[] = [];
  const p = progress(doc, calendar, today, rules);
  const byLine = new Map(p.days.filter(d => d.line >= 0).map(d => [d.line, d]));
  for (const day of doc.days) {
    const line = lineOf(day.position);
    const info = byLine.get(line);
    if (line < 0 || !info) continue;
    if (day.absent) {
      hints.push({ line, text: 'abwesend', level: 'ok' });
      continue;
    }
    const tasks = `${info.tasksFilled} ${info.tasksFilled === 1 ? 'Arbeitspaket' : 'Arbeitspakete'} (${rules.minTasks}–${rules.maxTasks}), ${info.tasksDone} erledigt`;
    const tasksOk = within(info.tasksFilled, [rules.minTasks, rules.maxTasks]);
    const reflectionLine = lineOf(day.reflection.position);
    const words = `Reflexion ${day.reflection.wordCount}/${rules.dailyReflectionWords[0]}–${rules.dailyReflectionWords[1]} Wörter`;
    const reflectionLevel = info.reflectionOk === null ? 'info' : info.reflectionOk ? 'ok' : 'warn';
    const later = info.state === 'later';
    if (reflectionLine >= 0 && reflectionLine !== line) {
      hints.push({ line, text: tasks, level: later ? 'info' : tasksOk ? 'ok' : 'warn' });
      hints.push({ line: reflectionLine, text: info.reflectionOk === null ? `${words} (noch nicht fällig)` : words, level: later ? 'info' : reflectionLevel });
    } else {
      // reflection written directly under the day heading
      hints.push({ line, text: `${tasks} · ${words}`, level: later ? 'info' : tasksOk && reflectionLevel !== 'warn' ? 'ok' : 'warn' });
    }
  }
  for (const key of ['grades', 'changes', 'projects', 'goals'] as const) {
    const section = doc.overview[key];
    if (!section?.position) continue;
    const n = section.text.length;
    hints.push({ line: lineOf(section.position),
      text: n >= rules.minOverviewCharacters ? `${n} Zeichen` : `${n}/${rules.minOverviewCharacters} Zeichen`,
      level: n >= rules.minOverviewCharacters ? 'ok' : 'warn' });
  }
  const pr = p.periodReflection;
  const prLine = lineOf(doc.reflection.position);
  if (prLine >= 0) {
    hints.push({ line: prLine, text: `${pr.words}/${pr.min}–${pr.max} Wörter${pr.due ? '' : ' (fällig am letzten Unterrichtstag)'}`,
      level: pr.ok ? 'ok' : pr.due ? 'warn' : 'info' });
  }
  return hints.sort((a, b) => a.line - b.line);
}
