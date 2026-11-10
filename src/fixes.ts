// Quick fixes for findings: concrete text edits, computed without VS Code.
import type { Finding, LearningPeriodConfig, Range } from './core';
import { dayBlock, insertLineForDay, isoToGerman, nextDayToPlan, plannedDays } from './core';

export interface TextEdit {
  range: Range;
  newText: string;
}

export interface Fix {
  title: string;
  edits: TextEdit[];
  preferred?: boolean;
  /** a command to run instead of (or after) the edits, e.g. to ask for the name */
  command?: { id: string; title: string; args: unknown[] };
}

export interface FixContext {
  /** file name, e.g. "Lernperiode-5.md" */
  fileName: string;
  config: LearningPeriodConfig;
  today: string;
}

const PLACEHOLDER_TASK = '- [ ] ...Ihr Text...';

const at = (line: number, character = 0): Range => ({ startLine: line, startCharacter: character, endLine: line, endCharacter: character });
const wholeLine = (lines: string[], line: number): Range => ({ startLine: line, startCharacter: 0, endLine: line, endCharacter: lines[line]?.length ?? 0 });
/** Range that removes a whole line including its line break. */
const deleteLine = (lines: string[], line: number): Range => (line + 1 < lines.length
  ? { startLine: line, startCharacter: 0, endLine: line + 1, endCharacter: 0 }
  : { startLine: Math.max(0, line - 1), startCharacter: lines[line - 1]?.length ?? 0, endLine: line, endCharacter: lines[line]?.length ?? 0 });

/** Index of the day heading at or above `line` ("### Planung TT.MM.JJJJ" or "### TT.MM.JJJJ"). */
function dayHeadingAbove(lines: string[], line: number): number {
  for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
    if (/^#{1,6}\s+(?:Planung\s+)?(\d{1,2}\.\d{1,2}\.\d{4}|tt\.mm\.jjjj)\s*$/i.test(lines[i]!)) return i;
  }
  return -1;
}

/** Last line that belongs to the day starting at `heading` (before the next heading of the same or higher level). */
function dayEnd(lines: string[], heading: number): number {
  const level = /^(#+)/.exec(lines[heading]!)![1]!.length;
  for (let i = heading + 1; i < lines.length; i++) {
    const m = /^(#+)\s/.exec(lines[i]!);
    if (m && m[1]!.length <= level) return i - 1;
  }
  return lines.length - 1;
}

/** Line after which a new work package goes: after the day's last task, else after the heading. */
function taskInsertLine(lines: string[], heading: number): number {
  const end = dayEnd(lines, heading);
  let last = -1;
  for (let i = heading + 1; i <= end; i++) {
    if (/^#{1,6}\s/.test(lines[i]!)) break; // stop at the Tagesreflexion sub-heading
    if (/^\s*[-*+]\s+\[[ xX]\]/.test(lines[i]!)) last = i;
  }
  return last >= 0 ? last : heading;
}

export function quickFixes(text: string, finding: Pick<Finding, 'code' | 'message' | 'range'>, ctx: FixContext): Fix[] {
  const lines = text.split(/\r?\n/);
  const line = finding.range.startLine;
  const fixes: Fix[] = [];

  switch (finding.code) {
    case 'name.missing': {
      const nameLine = lines.findIndex(l => /^\s*(?:[-*]\s+)?Name:/.test(l));
      if (nameLine >= 0) {
        fixes.push({ title: 'Namen eintragen …', edits: [], preferred: true,
          command: { id: 'lernatelier.fixName', title: 'Namen eintragen', args: [nameLine] } });
      }
      break;
    }

    case 'period.number':
    case 'period.number-mismatch': {
      const title = lines.findIndex(l => /^#\s+Lern[\s-]*Periode\b/i.test(l));
      if (title < 0) break;
      const fromFile = /Lernperiode-(\d+)/i.exec(ctx.fileName)?.[1];
      const fromConfig = ctx.config.learningPeriod;
      const candidates = [...new Set([fromConfig, fromFile ? Number(fromFile) : undefined].filter((n): n is number => !!n))];
      for (const n of candidates) {
        const source = n === fromConfig ? 'aus lernperiode.json' : 'aus dem Dateinamen';
        fixes.push({ title: `Nummer ${n} ${source} übernehmen`, preferred: n === candidates[0],
          edits: [{ range: wholeLine(lines, title), newText: `# Lern-Periode ${n}` }] });
      }
      break;
    }

    case 'period.range':
    case 'period.calendar-range': {
      const days = ctx.config.periodDays;
      const zeitraum = lines.findIndex(l => /^\s*(?:[-*]\s+)?Zeitraum:/.test(l));
      if (!days?.length || zeitraum < 0) break;
      const prefix = /^(\s*(?:[-*]\s+)?)Zeitraum:/.exec(lines[zeitraum]!)![1];
      const value = `${isoToGerman(days[0]!)} bis ${isoToGerman(days[days.length - 1]!)}`;
      fixes.push({ title: `Zeitraum aus lernperiode.json übernehmen (${value})`, preferred: true,
        edits: [{ range: wholeLine(lines, zeitraum), newText: `${prefix}Zeitraum: ${value}` }] });
      break;
    }

    case 'day.missing': {
      const iso = /(\d{4}-\d{2}-\d{2})/.exec(finding.message)?.[1];
      if (!iso) break;
      const insert = insertLineForDay(text);
      const atEnd = insert >= lines.length;
      fixes.push({ title: `Tagesplanung für ${isoToGerman(iso)} einfügen`, preferred: true,
        edits: [{ range: atEnd ? at(lines.length - 1, lines[lines.length - 1]!.length) : at(insert), newText: (atEnd ? '\n\n' : '') + dayBlock(iso) }] });
      break;
    }

    case 'day.date': {
      // heading with the template placeholder "Planung tt.mm.jjjj"
      const next = nextDayToPlan(text, ctx.config, ctx.today);
      const iso = next ?? (plannedDays(text).has(ctx.today) ? null : ctx.today);
      if (!iso) break;
      const current = lines[line] ?? '';
      if (!/tt\.mm\.jjjj/i.test(current)) break;
      fixes.push({ title: `Datum ${isoToGerman(iso)} einsetzen`, preferred: true,
        edits: [{ range: wholeLine(lines, line), newText: current.replace(/tt\.mm\.jjjj/i, isoToGerman(iso)) }] });
      break;
    }

    case 'tasks.count': {
      const heading = dayHeadingAbove(lines, line);
      if (heading < 0) break;
      const m = /: (\d+) ausgefüllte Arbeitspakete; erwartet sind (\d+)–(\d+)/.exec(finding.message);
      const filled = m ? Number(m[1]) : 0;
      const min = m ? Number(m[2]) : 3;
      if (filled < min) {
        const after = taskInsertLine(lines, heading);
        const missing = min - filled;
        // empty placeholders already there count as "filled" once written; add only what is still missing
        const placeholders = lines.slice(heading + 1, dayEnd(lines, heading) + 1).filter(l => l.trim() === PLACEHOLDER_TASK).length;
        const add = Math.max(1, missing - placeholders);
        fixes.push({ title: add === 1 ? 'Arbeitspaket hinzufügen' : `${add} Arbeitspakete hinzufügen`, preferred: placeholders === 0,
          edits: [{ range: at(after, lines[after]!.length), newText: `\n${PLACEHOLDER_TASK}`.repeat(add) }] });
      }
      fixes.push(absentFix(lines, heading));
      break;
    }

    case 'reflection.daily-words': {
      const heading = dayHeadingAbove(lines, line);
      if (heading >= 0 && /: 0 Wörter/.test(finding.message)) fixes.push(absentFix(lines, heading));
      break;
    }

    case 'task.placeholder': {
      if (lines[line]?.trim().startsWith('- [')) {
        fixes.push({ title: 'Leeres Arbeitspaket entfernen', edits: [{ range: deleteLine(lines, line), newText: '' }] });
      }
      break;
    }
  }
  return fixes;
}

function absentFix(lines: string[], heading: number): Fix {
  return {
    title: 'Tag als abwesend markieren',
    edits: [{ range: at(heading, lines[heading]!.length), newText: '\n\nabwesend' }],
  };
}

/** Edit for the name line: keeps "- Name:" and replaces the value. */
export function nameEdit(text: string, nameLine: number, name: string): TextEdit {
  const lines = text.split(/\r?\n/);
  const m = /^(\s*(?:[-*]\s+)?Name:)/.exec(lines[nameLine] ?? '');
  const prefix = m ? m[1] : '- Name:';
  return { range: wholeLine(lines, nameLine), newText: `${prefix} ${name.trim()}` };
}

/** Applies edits to a text (for tests and previews). Edits must not overlap. */
export function applyEdits(text: string, edits: TextEdit[]): string {
  const lines = text.split('\n');
  const offset = (l: number, c: number) => lines.slice(0, l).reduce((n, s) => n + s.length + 1, 0) + c;
  return [...edits]
    .sort((a, b) => offset(b.range.startLine, b.range.startCharacter) - offset(a.range.startLine, a.range.startCharacter))
    .reduce((t, e) => t.slice(0, offset(e.range.startLine, e.range.startCharacter)) + e.newText + t.slice(offset(e.range.endLine, e.range.endCharacter)), text);
}

