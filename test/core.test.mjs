// Unit tests for src/core.ts (built to out/core.mjs by `node scripts/build.mjs --test`).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  check, checkOptions, configText, counts, dayBlock, germanToIso, insertLineForDay, isoToGerman,
  newPeriodText, nextDayToPlan, parseConfig, parseDayList, plannedDays, report, summary, todayIso, toFindings,
} from '../out/core.mjs';

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const complete = await fixture('Lernperiode-5.md');
const template = await fixture('Lernperiode-template.md');
const config = parseConfig(await fixture('lernperiode.json')).config;
const codes = outcome => outcome.findings.map(f => f.code);

test('complete document without calendar is green', () => {
  const outcome = check(complete, {}, '2026-09-30');
  assert.deepEqual(codes(outcome), []);
  assert.equal(outcome.result.status, 'green');
});

test('complete document with calendar after the last day is green', () => {
  const outcome = check(complete, config, '2026-09-30');
  assert.deepEqual(codes(outcome), []);
  assert.equal(outcome.result.calendarChecksApplied, true);
});

test('empty template is red with errors for name, period, number and placeholders', () => {
  const outcome = check(template, {}, '2026-09-19');
  assert.equal(outcome.result.status, 'red');
  for (const code of ['name.missing', 'period.range', 'period.number', 'overview.grades', 'day.date']) {
    assert.ok(codes(outcome).includes(code), `expected ${code}`);
  }
});

test('findings without library position are placed on the matching line', () => {
  const lines = template.split('\n');
  const byCode = code => check(template, {}, '2026-09-19').findings.find(f => f.code === code);
  const name = byCode('name.missing');
  assert.equal(name.located, true);
  assert.match(lines[name.range.startLine], /Name:/);
  const period = byCode('period.range');
  assert.match(lines[period.range.startLine], /Zeitraum:/);
  const number = byCode('period.number');
  assert.match(lines[number.range.startLine], /^# Lern-Periode/);
});

test('findings with a position use zero-based ranges on a single line', () => {
  const dated = newPeriodText(template, 5).replace('Planung tt.mm.jjjj', 'Planung 18.09.2026');
  const outcome = check(dated, {}, '2026-09-19');
  assert.ok(codes(outcome).includes('tasks.count'));
  const placeholder = outcome.findings.find(f => f.code === 'task.placeholder');
  assert.equal(placeholder.located, false);
  assert.equal(placeholder.range.startLine, placeholder.range.endLine);
  assert.match(dated.split('\n')[placeholder.range.startLine], /^- \[ \] \.\.\.Ihr Text\.\.\./);
  assert.ok(placeholder.range.endCharacter > placeholder.range.startCharacter);
});

test('calendar: missing planning for the next school day is reported', () => {
  const twoDays = complete.replace(/### Planung 25\.09\.2026[\s\S]*?(?=## Lernperiode Reflexion)/, '');
  const outcome = check(twoDays, config, '2026-09-19');
  const missing = outcome.findings.find(f => f.code === 'day.missing');
  assert.ok(missing, 'day.missing expected');
  assert.match(missing.message, /2026-09-25/);
  assert.match(twoDays.split('\n')[missing.range.startLine], /^## Tagesplanungen/);
});

test('calendar: learning period number mismatch is an error', () => {
  const outcome = check(complete, { ...config, learningPeriod: 6 }, '2026-09-30');
  assert.ok(codes(outcome).includes('period.number-mismatch'));
  assert.equal(outcome.result.status, 'red');
});

test('parseConfig accepts the Python checker format', () => {
  assert.deepEqual(parseConfig('{"learningperiod": 4, "days": ["2026-04-24", "2026-04-17"]}'),
    { config: { learningPeriod: 4, periodDays: ['2026-04-17', '2026-04-24'] }, errors: [] });
});

test('parseConfig reports invalid JSON, numbers, dates and duplicates but keeps valid parts', () => {
  assert.match(parseConfig('{nope').errors[0], /kein gültiges JSON/);
  assert.match(parseConfig('[]').errors[0], /Objekt/);
  const r = parseConfig('{"learningperiod": 0, "days": ["2026-02-30", "2026-03-01", "2026-03-01", 5]}');
  assert.equal(r.config.learningPeriod, undefined);
  assert.deepEqual(r.config.periodDays, ['2026-03-01']);
  assert.equal(r.errors.length, 3);
});

test('checkOptions only enables calendar checks with days', () => {
  assert.deepEqual(checkOptions({ learningPeriod: 3 }, '2026-01-01'), { learningPeriod: 3 });
  assert.deepEqual(checkOptions({ periodDays: ['2026-01-02'] }, '2026-01-01'), { periodDays: ['2026-01-02'], today: '2026-01-01' });
});

test('date helpers', () => {
  assert.equal(germanToIso('8.9.2026'), '2026-09-08');
  assert.equal(germanToIso('31.02.2026'), null);
  assert.equal(isoToGerman('2026-09-08'), '08.09.2026');
  assert.equal(todayIso(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
  assert.deepEqual(parseDayList('18.09.2026, 2026-09-25; 18.09.2026 foo'), { days: ['2026-09-18', '2026-09-25'], invalid: ['foo'] });
});

test('new period text sets the number and keeps the template', () => {
  const text = newPeriodText(template, 7);
  assert.match(text, /^# Lern-Periode 7$/m);
  assert.equal(text.split('\n').length, template.split('\n').length);
  assert.equal(check(text, {}, '2026-01-01').result.document.number, 7);
});

test('config text is valid and readable again', () => {
  assert.deepEqual(parseConfig(configText(5, ['2026-09-18'])).config, { learningPeriod: 5, periodDays: ['2026-09-18'] });
});

test('next day to plan and insert position', () => {
  assert.deepEqual([...plannedDays(complete)].sort(), ['2026-09-18', '2026-09-25']);
  const cfg = { periodDays: ['2026-09-18', '2026-09-25', '2026-10-02'] };
  assert.equal(nextDayToPlan(complete, cfg, '2026-09-26'), '2026-10-02');
  assert.equal(nextDayToPlan(complete, { periodDays: ['2026-09-18'] }, '2026-09-26'), null);
  const nextText = (text, at) => text.split('\n').slice(at).find(l => l.trim() !== '');
  assert.match(nextText(complete, insertLineForDay(complete)), /^## Lernperiode Reflexion/);
  // with the template's "insert further days here" comment, the new day goes before that comment
  assert.match(nextText(template, insertLineForDay(template)), /^<!--/);
});

test('inserted day block is recognised as a planned day with three placeholder tasks', () => {
  const lines = complete.split('\n');
  const at = insertLineForDay(complete);
  const text = [...lines.slice(0, at), dayBlock('2026-10-02'), ...lines.slice(at)].join('\n');
  const day = check(text, {}, '2026-10-01').result.document.days.find(d => d.date === '2026-10-02');
  assert.ok(day);
  assert.equal(day.tasks.length, 3);
  assert.ok(day.tasks.every(t => !t.filled));
});

test('summary and report', () => {
  const outcome = check(template, {}, '2026-09-19');
  const { errors, warnings } = counts(outcome.findings);
  assert.equal(summary('red', outcome.findings), `${errors} Fehler, ${warnings} Warnungen → Handlungsbedarf`);
  const text = report('Lernperiode-NR.md', outcome, ['lernperiode.json nicht gefunden.']);
  assert.match(text, /^Lernperiode-NR\.md/);
  assert.match(text, /HINWEIS  lernperiode\.json nicht gefunden\./);
  assert.match(text, /FEHLER   Zeile \d+: /);
  assert.ok(text.indexOf('FEHLER') < text.indexOf('WARNUNG'), 'errors before warnings');
  assert.match(summary('green', []), /0 Fehler, 0 Warnungen → Alles in Ordnung/);
});

test('toFindings tolerates odd positions', () => {
  const f = toFindings([{ code: 'x', severity: 'warning', message: 'm',
    position: { start: { line: 3, column: 1 }, end: { line: 3, column: 1 } } }], 'a\nb\nc');
  assert.deepEqual(f[0].range, { startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 1 });
});

// ---- lernperiode.json generator ----
import { dayChoices, dayLabel, generateDays, numberFromText, periodFromText, plannedWeekdays, weekdayOf } from '../out/core.mjs';

test('generator: number and period are read from the document', () => {
  assert.equal(numberFromText(complete), 5);
  assert.equal(numberFromText(template), null);
  assert.deepEqual(periodFromText(complete), { start: '2026-09-18', end: '2026-09-25' });
  assert.equal(periodFromText(template), null, 'tt.mm.jjjj placeholders are not a period');
  assert.equal(periodFromText('- Zeitraum: 25.09.2026 bis 18.09.2026'), null, 'end before start');
  assert.deepEqual(periodFromText('Zeitraum: 1.9.2026 – 3.9.2026'), { start: '2026-09-01', end: '2026-09-03' });
});

test('generator: weekdays and labels', () => {
  assert.equal(weekdayOf('2026-11-13'), 5);
  assert.equal(dayLabel('2026-11-13'), 'Fr 13.11.2026');
  assert.deepEqual(plannedWeekdays(complete), [5]);
});

test('generator: every Friday in the period, inclusive, across months and DST change', () => {
  assert.deepEqual(generateDays('2026-10-16', '2026-11-06', [5]), ['2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06']);
  assert.deepEqual(generateDays('2026-11-09', '2026-11-13', [1, 3]), ['2026-11-09', '2026-11-11']);
  assert.deepEqual(generateDays('2026-11-10', '2026-11-12', [5]), []);
});

test('generator: choices are ticked, include planned off-weekday days and mark planned ones', () => {
  const text = complete.replace('### Planung 25.09.2026', '### Planung 23.09.2026');
  const choices = dayChoices(text, '2026-09-14', '2026-09-30', [5]);
  assert.deepEqual(choices.map(c => c.iso), ['2026-09-18', '2026-09-23', '2026-09-25']);
  assert.ok(choices.every(c => c.picked));
  assert.equal(choices[0].note, 'im Dokument geplant');
  assert.equal(choices[1].note, 'im Dokument geplant');
  assert.equal(choices[2].note, '');
});

// ---- calendar editor ----
import { calendarInit, calendarProblems, calendarRows } from '../out/core.mjs';

test('calendarInit without a file: from the document, nothing unticked', () => {
  const init = calendarInit(complete, undefined, false);
  assert.deepEqual(init, { number: 5, start: '2026-09-18', end: '2026-09-25', periodSource: 'document',
    weekdays: [5], extra: [], unchecked: [], existing: false });
});

test('calendarInit with a file: weekdays from its days, extra and unticked days restored', () => {
  const init = calendarInit(template, { learningPeriod: 2, periodDays: ['2026-11-06', '2026-11-11', '2026-11-20'] }, true);
  assert.equal(init.number, 2);
  assert.equal(init.periodSource, 'config');
  assert.deepEqual([init.start, init.end], ['2026-11-06', '2026-11-20']);
  assert.deepEqual(init.weekdays, [3, 5]);
  assert.deepEqual(init.unchecked, ['2026-11-13', '2026-11-18']);
  assert.deepEqual(init.extra, []);
});

test('calendarRows: months, notes, extra days outside the period', () => {
  const rows = calendarRows(complete, '2026-09-18', '2026-10-02', [5], ['2026-09-30', '2026-11-04'], ['2026-10-02']);
  assert.deepEqual(rows.map(r => [r.label, r.month, r.checked, r.note]), [
    ['Fr 18.09.2026', 'September 2026', true, 'im Dokument geplant'],
    ['Fr 25.09.2026', 'September 2026', true, 'im Dokument geplant'],
    ['Mi 30.09.2026', 'September 2026', true, 'zusätzlicher Tag'],
    ['Fr 02.10.2026', 'Oktober 2026', false, ''],
    ['Mi 04.11.2026', 'November 2026', true, 'zusätzlicher Tag · ausserhalb des Zeitraums'],
  ]);
});

test('calendarProblems', () => {
  assert.deepEqual(calendarProblems(5, '2026-09-18', '2026-09-25', ['2026-09-18']), []);
  assert.equal(calendarProblems(null, '2026-09-25', '2026-09-18', []).length, 3);
});
