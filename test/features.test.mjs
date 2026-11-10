// Tests for quick fixes, progress and inline hints (src/fixes.ts, src/progress.ts).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { applyEdits, check, chooseConfig, isConfigFile, periodNumberOf, saveTarget, inlineHints, nameEdit, newPeriodText, progress, quickFixes } from '../out/core.mjs';

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const complete = await fixture('Lernperiode-5.md');
const template = await fixture('Lernperiode-template.md');
const codes = text => check(text, {}, '2026-09-30').findings.map(f => f.code);
const findingOf = (text, code, config = {}, today = '2026-09-30') =>
  check(text, config, today).findings.find(f => f.code === code);
const ctx = (extra = {}) => ({ fileName: 'Lernperiode-5.md', config: {}, today: '2026-09-30', ...extra });

// ---- quick fixes: applying the fix removes the finding ------------------------------------

test('fix: period number from the file name', () => {
  const text = complete.replace('# Lern-Periode 5', '# Lern-Periode NR');
  const [fix] = quickFixes(text, findingOf(text, 'period.number'), ctx());
  assert.equal(fix.title, 'Nummer 5 aus dem Dateinamen übernehmen');
  assert.ok(!codes(applyEdits(text, fix.edits)).includes('period.number'));
});

test('fix: period number from lernperiode.json is offered first on a mismatch', () => {
  const config = { learningPeriod: 6, periodDays: ['2026-09-18', '2026-09-25'] };
  const finding = findingOf(complete, 'period.number-mismatch', config);
  const fixes = quickFixes(complete, finding, ctx({ config }));
  assert.deepEqual(fixes.map(f => f.title), ['Nummer 6 aus lernperiode.json übernehmen', 'Nummer 5 aus dem Dateinamen übernehmen']);
  assert.equal(fixes[0].preferred, true);
  const fixed = applyEdits(complete, fixes[0].edits);
  assert.ok(!check(fixed, config, '2026-09-30').findings.some(f => f.code === 'period.number-mismatch'));
});

test('fix: Zeitraum from lernperiode.json, keeping the list dash', () => {
  const text = complete.replace('Zeitraum: 18.09.2026 bis 25.09.2026', 'Zeitraum: tt.mm.jjjj bis tt.mm.jjjj');
  const config = { periodDays: ['2026-09-18', '2026-09-25'] };
  const [fix] = quickFixes(text, findingOf(text, 'period.range', config), ctx({ config }));
  assert.equal(fix.title, 'Zeitraum aus lernperiode.json übernehmen (18.09.2026 bis 25.09.2026)');
  const fixed = applyEdits(text, fix.edits);
  assert.match(fixed, /^- Zeitraum: 18\.09\.2026 bis 25\.09\.2026$/m);
  assert.ok(!check(fixed, config, '2026-09-30').findings.some(f => f.code.startsWith('period.')));
});

test('fix: missing day is inserted before the period reflection', () => {
  const config = { periodDays: ['2026-09-18', '2026-09-25', '2026-10-02'] };
  const finding = findingOf(complete, 'day.missing', config, '2026-09-26');
  assert.match(finding.message, /2026-10-02/);
  const [fix] = quickFixes(complete, finding, ctx({ config, today: '2026-09-26' }));
  assert.equal(fix.title, 'Tagesplanung für 02.10.2026 einfügen');
  const fixed = applyEdits(complete, fix.edits);
  assert.ok(fixed.indexOf('### Planung 02.10.2026') < fixed.indexOf('## Lernperiode Reflexion'));
  const after = check(fixed, config, '2026-09-26').findings.map(f => f.code);
  assert.ok(!after.includes('day.missing'));
  assert.ok(after.includes('task.placeholder'), 'the new day has placeholders to fill');
});

test('fix: placeholder date "tt.mm.jjjj" gets the next school day', () => {
  const text = newPeriodText(template, 5);
  const finding = findingOf(text, 'day.date');
  const config = { periodDays: ['2026-11-06', '2026-11-13'] };
  const [fix] = quickFixes(text, finding, ctx({ config, today: '2026-11-01' }));
  assert.equal(fix.title, 'Datum 06.11.2026 einsetzen');
  assert.match(applyEdits(text, fix.edits), /^### Planung 06\.11\.2026$/m);
});

test('fix: too few work packages adds placeholder tasks after the last one', () => {
  const text = complete.replace('- [ ] Erste Diagnosen im Problems-Panel anzeigen\n', '');
  const finding = findingOf(text, 'tasks.count');
  const fixes = quickFixes(text, finding, ctx());
  assert.deepEqual(fixes.map(f => f.title), ['Arbeitspaket hinzufügen', 'Tag als abwesend markieren']);
  const fixed = applyEdits(text, fixes[0].edits);
  assert.match(fixed, /- \[x\] Parser der Bibliothek lesen und verstehen\n- \[ \] \.\.\.Ihr Text\.\.\.\n\n#### Tagesreflexion/);
  const after = check(fixed, {}, '2026-09-30').findings.map(f => f.code);
  assert.ok(after.includes('task.placeholder'), 'the new placeholder is pointed out until it is filled');
  const filledIn = fixed.replace('- [ ] ...Ihr Text...', '- [ ] Tests schreiben');
  assert.ok(!check(filledIn, {}, '2026-09-30').findings.some(f => f.code === 'tasks.count'), 'filled in: count is fine');
});

test('fix: marking a day absent removes its task and reflection findings', () => {
  const text = complete.replace(/### Planung 25\.09\.2026[\s\S]*?(?=## Lernperiode Reflexion)/, '### Planung 25.09.2026\n\n');
  const finding = findingOf(text, 'tasks.count');
  const absent = quickFixes(text, finding, ctx()).find(f => f.title === 'Tag als abwesend markieren');
  const fixed = applyEdits(text, absent.edits);
  assert.match(fixed, /### Planung 25\.09\.2026\n\nabwesend\n/);
  assert.deepEqual(codes(fixed), []);
});

test('fix: an empty placeholder task can be removed', () => {
  const text = complete.replace('- [ ] Tests mit Fixtures ergänzen', '- [ ] Tests mit Fixtures ergänzen\n- [ ] ...Ihr Text...');
  const finding = findingOf(text, 'task.placeholder');
  const [fix] = quickFixes(text, finding, ctx());
  assert.equal(fix.title, 'Leeres Arbeitspaket entfernen');
  assert.equal(applyEdits(text, fix.edits), complete);
});

test('fix: name is entered through a command, nameEdit keeps the dash', () => {
  const text = complete.replace('Name: Max Beispiel', 'Name: Exemplibus Exemplio');
  const [fix] = quickFixes(text, findingOf(text, 'name.missing'), ctx());
  assert.equal(fix.command.id, 'lernatelier.fixName');
  const line = fix.command.args[0];
  const fixed = applyEdits(text, [nameEdit(text, line, '  Max Beispiel ')]);
  assert.equal(fixed, complete);
});

// ---- progress ------------------------------------------------------------------------------

test('progress without calendar: every day required, every reflection due', () => {
  const doc = check(complete, {}, '2026-09-30').result.document;
  const p = progress(doc, {}, '2026-09-30');
  assert.equal(p.calendar, false);
  assert.deepEqual(p.days.map(d => [d.label, d.state, d.tasksFilled, d.tasksDone]), [
    ['Fr 18.09.2026', 'complete', 3, 2],
    ['Fr 25.09.2026', 'complete', 3, 0],
  ]);
  assert.deepEqual([p.required, p.complete, p.tasksFilled, p.tasksDone, p.reflectionsDue, p.reflectionsOk, p.overviewDone],
    [2, 2, 6, 2, 2, 2, 4]);
  assert.deepEqual(p.periodReflection, { words: 150, min: 100, max: 200, due: true, ok: true });
});

test('progress with calendar: next day, later days, missing days and lines', () => {
  const doc = check(complete, {}, '2026-09-20').result.document;
  const p = progress(doc, { periodDays: ['2026-09-18', '2026-09-25', '2026-10-02', '2026-10-09'] }, '2026-09-20');
  assert.deepEqual(p.days.map(d => [d.date, d.state, d.reflectionOk]), [
    ['2026-09-18', 'complete', true],
    ['2026-09-25', 'next', null],
    ['2026-10-02', 'later', null],
    ['2026-10-09', 'later', null],
  ]);
  assert.equal(p.required, 2);
  assert.equal(p.complete, 2);
  assert.equal(p.periodReflection.due, false);
  assert.match(complete.split('\n')[p.days[0].line], /^### Planung 18\.09\.2026/);
  const later = progress(doc, { periodDays: ['2026-09-18', '2026-09-25', '2026-10-02'] }, '2026-10-02');
  assert.equal(later.days[2].state, 'missing');
  assert.equal(later.days[2].line, -1);
});

test('progress: absent days count as complete; undated template day is listed', () => {
  const absent = complete.replace(/### Planung 25\.09\.2026[\s\S]*?(?=## Lernperiode Reflexion)/, '### Planung 25.09.2026\n\nkrank\n\n');
  const p = progress(check(absent, {}, '2026-09-30').result.document, {}, '2026-09-30');
  assert.equal(p.days[1].state, 'absent');
  assert.equal(p.complete, 2);
  const t = progress(check(template, {}, '2026-09-30').result.document, {}, '2026-09-30');
  assert.deepEqual(t.days.map(d => [d.date, d.label, d.state]), [[null, 'Planung tt.mm.jjjj', 'incomplete']]);
});

// ---- inline hints ----------------------------------------------------------------------------

test('inline hints: work packages on day headings, words on reflection headings', () => {
  const lines = complete.split('\n');
  const hints = inlineHints(check(complete, {}, '2026-09-30').result.document, {}, '2026-09-30');
  const at = re => hints.find(h => re.test(lines[h.line]));
  assert.deepEqual(at(/^### Planung 18\.09/), { line: lines.indexOf('### Planung 18.09.2026'), text: '3 Arbeitspakete (3–5), 2 erledigt', level: 'ok' });
  const reflection = hints.filter(h => /^#### Tagesreflexion/.test(lines[h.line]));
  assert.deepEqual(reflection.map(h => [h.text, h.level]), [['Reflexion 60/50–100 Wörter', 'ok'], ['Reflexion 70/50–100 Wörter', 'ok']]);
  assert.deepEqual([at(/^## Lernperiode Reflexion/).text, at(/^## Lernperiode Reflexion/).level], ['150/100–200 Wörter', 'ok']);
  assert.equal(at(/^### Noten/).level, 'ok');
});

test('inline hints: warnings and "not due yet"', () => {
  const short = complete.replace(/(#### Tagesreflexion\n\n)[^\n]+/, '$1Zu kurz heute.').replace('### Noten\n\nMathematik ist stabil, im Modul 164 möchte ich die Note verbessern.', '### Noten\n\nkurz');
  const lines = short.split('\n');
  const hints = inlineHints(check(short, {}, '2026-09-20').result.document, { periodDays: ['2026-09-18', '2026-09-25'] }, '2026-09-20');
  const texts = hints.map(h => [lines[h.line], h.text, h.level]);
  assert.deepEqual(texts.find(t => t[0] === '### Noten'), ['### Noten', '4/20 Zeichen', 'warn']);
  const reflections = texts.filter(t => t[0] === '#### Tagesreflexion');
  assert.deepEqual(reflections[0].slice(1), ['Reflexion 3/50–100 Wörter', 'warn']);
  assert.deepEqual(reflections[1].slice(1), ['Reflexion 70/50–100 Wörter (noch nicht fällig)', 'info']);
  assert.match(texts.find(t => t[0] === '## Lernperiode Reflexion')[1], /fällig am letzten Unterrichtstag/);
});

test('chooseConfig: lernperiode.json only applies to its own Lernperiode, lernperiode-N.json wins', () => {
  const shared = { name: 'lernperiode.json', config: { learningPeriod: 5, days: [] }, errors: [] };
  const own4 = { name: 'lernperiode-4.json', config: { learningPeriod: 4, days: [] }, errors: [] };
  assert.equal(chooseConfig(5, [shared]).file, shared);
  const other = chooseConfig(4, [shared]);
  assert.equal(other.file, null);
  assert.match(other.reason, /gehört zu Lernperiode 5.*lernperiode-4\.json/);
  assert.equal(chooseConfig(4, [own4, shared]).file, own4);
  assert.equal(chooseConfig(null, [shared]).file, shared, 'unknown number: use the shared file');
  const noNumber = { name: 'lernperiode.json', config: { days: [] }, errors: [] };
  assert.equal(chooseConfig(4, [noNumber]).file, noNumber, 'file without learningperiod applies to all');
  assert.match(chooseConfig(4, []).reason, /Kein Kalender/);
});

test('saveTarget and isConfigFile', () => {
  const shared = { name: 'lernperiode.json', config: { learningPeriod: 5, days: [] }, errors: [] };
  assert.equal(saveTarget(4, []), 'lernperiode.json');
  assert.equal(saveTarget(5, [shared]), 'lernperiode.json');
  assert.equal(saveTarget(4, [shared]), 'lernperiode-4.json');
  assert.equal(saveTarget(4, [{ ...shared, name: 'lernperiode-4.json' }, shared]), 'lernperiode-4.json');
  assert.ok(isConfigFile('lernperiode.json') && isConfigFile('Lernperiode-12.json'));
  assert.ok(!isConfigFile('lernperiode-x.json') && !isConfigFile('Lernperiode-5.md'));
  assert.equal(periodNumberOf('Lernperiode-7.md', ''), 7);
});

// ---- carrying open work packages over ----------------------------------------------------
import { carrySource, carrySourceFor, carryTarget, planCarry, carryMessage, parseDocument } from '../out/core.mjs';

test('carry over: the open package of 18.09 is appended to 25.09, a second run changes nothing', () => {
  const doc = parseDocument(complete);
  assert.equal(carryTarget(doc, 0), 1);
  assert.equal(carrySourceFor(doc, 1), 0);
  const plan = planCarry(complete, doc, 0, 1);
  assert.deepEqual(plan.tasks, ['Erste Diagnosen im Problems-Panel anzeigen']);
  const after = applyEdits(complete, plan.edits);
  assert.match(after, /- \[ \] Tests mit Fixtures ergänzen\n- \[ \] Erste Diagnosen im Problems-Panel anzeigen\n\n#### Tagesreflexion/);
  assert.equal(planCarry(after, parseDocument(after), 0, 1), null, 'already there');
  assert.match(carryMessage(plan), /^1 offenes Arbeitspaket vom 18\.09\.2026 in die Tagesplanung 25\.09\.2026 übernommen\.$/);
});

test('carry over: placeholders are replaced first', () => {
  const text = complete.replace(/- \[ \] Statusleiste.*\n- \[ \] Befehle.*\n- \[ \] Tests.*\n/, '- [ ] ...Ihr Text...\n- [ ] ...Ihr Text...\n- [ ] ...Ihr Text...\n');
  const after = applyEdits(text, planCarry(text, parseDocument(text), 0, 1).edits);
  assert.match(after, /### Planung 25\.09\.2026\n\n- \[ \] Erste Diagnosen im Problems-Panel anzeigen\n- \[ \] \.\.\.Ihr Text\.\.\.\n- \[ \] \.\.\.Ihr Text\.\.\.\n\n/);
});

test('carry over: without a next day a new day is inserted before the period reflection', () => {
  const doc = parseDocument(complete);
  assert.equal(carrySource(doc, '2026-11-10'), 1, 'latest day with open packages');
  assert.equal(carrySource(doc, '2026-09-20'), 0, 'days after today are not sources');
  assert.equal(carrySource(doc, '2026-09-01'), -1);
  assert.equal(carryTarget(doc, 1), -1);
  const plan = planCarry(complete, doc, 1, -1, '2026-10-02');
  assert.equal(plan.created, true);
  const after = applyEdits(complete, plan.edits);
  assert.match(after, /### Planung 02\.10\.2026\n\n- \[ \] Statusleiste mit Ampel einbauen\n- \[ \] Befehle für neue Dateien schreiben\n- \[ \] Tests mit Fixtures ergänzen\n\n#### Tagesreflexion\n\n\.\.\.Ihr Text\.\.\.\n\n\n## Lernperiode Reflexion/);
  const day = parseDocument(after).days[2];
  assert.equal(day.date, '2026-10-02');
  assert.equal(day.tasks.filter(t => t.filled).length, 3);
  assert.equal(planCarry(complete, doc, 1, -1), null, 'needs a date');
});

// ---- week planning and weekly progress -------------------------------------------------
import { weekToPlan, addDaysIso, weeks } from '../out/core.mjs';

test('weekToPlan: calendar days of the coming 7 days that are not planned', () => {
  const config = { periodDays: ['2026-11-06', '2026-11-11', '2026-11-13', '2026-11-18', '2026-12-02'] };
  assert.deepEqual(weekToPlan(config, new Set(), '2026-11-10'), ['2026-11-11', '2026-11-13']);
  assert.deepEqual(weekToPlan(config, new Set(['2026-11-11']), '2026-11-10'), ['2026-11-13']);
  // holidays: nothing in the next 7 days, so the week from the next school day
  assert.deepEqual(weekToPlan(config, new Set(), '2026-11-19'), ['2026-12-02']);
  assert.deepEqual(weekToPlan(config, new Set(), '2026-12-03'), []);
  // without calendar: the weekdays used so far (Wednesday = 3, Friday = 5)
  assert.deepEqual(weekToPlan({}, new Set(['2026-11-13']), '2026-11-10', [3, 5]), ['2026-11-11']);
  assert.deepEqual(weekToPlan({}, new Set(), '2026-11-10'), []);
  assert.equal(addDaysIso('2026-12-29', 6), '2027-01-04');
});

test('weekly progress groups the days into ISO calendar weeks', () => {
  const day = (date, state, filled = 3, done = 1, words = 60) => ({ date, state, tasksFilled: filled, tasksDone: done, reflectionWords: words });
  const w = weeks([day('2026-11-06', 'complete'), day('2026-11-09', 'incomplete', 2, 0, 10), day('2026-11-13', 'later', 0, 0, 0), day('2027-01-01', 'later', 0, 0, 0)]);
  assert.deepEqual(w.map(x => [x.label, x.range, x.days, x.complete, x.required, x.tasksDone, x.tasksFilled, x.reflectionWords]), [
    ['KW 45', '02.11.–08.11.', 1, 1, 1, 1, 3, 60],
    ['KW 46', '09.11.–15.11.', 2, 0, 1, 0, 2, 10],
    ['KW 53', '28.12.–03.01.', 1, 0, 0, 0, 0, 0],
  ]);
  assert.equal(progress(parseDocument(complete), {}, '2026-11-10').weeks.length, 2);
});

test('weekToPlan: a fully planned week does not jump to the next one', () => {
  const config = { periodDays: ['2026-11-11', '2026-11-13', '2026-11-18'] };
  assert.deepEqual(weekToPlan(config, new Set(['2026-11-11', '2026-11-13']), '2026-11-10'), []);
});

// ---- everyday writing helpers -------------------------------------------------------------
import { toggleTaskLine, dayLines, todayLine, neighbourDay, counterAt, counterText, todayView, review, takeOver, takeOverChoices } from '../out/core.mjs';

const lineIn = (text, s) => text.split('\n').indexOf(s);

test('toggleTaskLine ticks and unticks work packages only', () => {
  assert.equal(toggleTaskLine('- [ ] Tests schreiben'), '- [x] Tests schreiben');
  assert.equal(toggleTaskLine('  * [X] Tests'), '  * [ ] Tests');
  assert.equal(toggleTaskLine('- Tests'), null);
  assert.equal(toggleTaskLine('### Planung 18.09.2026'), null);
});

test('jumping between days', () => {
  const doc = parseDocument(complete);
  const [first, second] = dayLines(doc);
  assert.equal(first, lineIn(complete, '### Planung 18.09.2026'));
  assert.equal(todayLine(doc, '2026-09-25'), second);
  assert.equal(todayLine(doc, '2026-09-20'), second, 'no plan for today: the next planned day');
  assert.equal(todayLine(doc, '2026-11-10'), second, 'after the period: the last day');
  assert.equal(neighbourDay(doc, 0, 1), first);
  assert.equal(neighbourDay(doc, first, 1), second);
  assert.equal(neighbourDay(doc, second, 1), -1);
  assert.equal(neighbourDay(doc, second + 3, -1), second, 'inside a day: its own heading first');
  assert.equal(neighbourDay(doc, second, -1), first);
  assert.equal(neighbourDay(doc, first, -1), -1);
});

test('live counter: reflections in words, overview in characters, nothing on work packages', () => {
  const doc = parseDocument(complete);
  const lines = complete.split('\n');
  const reflection = lines.indexOf('#### Tagesreflexion');
  const c = counterAt(doc, complete, reflection + 2);
  assert.equal(c.label, 'Tagesreflexion Fr 18.09.2026');
  assert.equal(c.unit, 'Wörter');
  assert.ok(c.ok && c.value >= 50 && c.value <= 100);
  assert.match(counterText(c), /^\d+\/50–100 Wörter$/);
  assert.equal(counterAt(doc, complete, lineIn(complete, '### Planung 18.09.2026') + 2), null, 'on a work package');
  const period = counterAt(doc, complete, lines.length - 1);
  assert.equal(period.label, 'Lernperiodenreflexion');
  assert.match(counterText(period), /^150\/100–200 Wörter$/);
  const noten = counterAt(doc, complete, lines.findIndex(l => /^### Noten/.test(l)) + 2);
  assert.equal(noten.unit, 'Zeichen');
  assert.match(counterText(noten), /^\d+\/20 Zeichen$/);
  assert.equal(counterAt(doc, complete, 0), null);
  // empty reflection in the template: 0 words, not ok
  const t = parseDocument(template);
  const tr = counterAt(t, template, lineIn(template, '#### Tagesreflexion') + 1);
  assert.equal(tr.value, 0);
  assert.equal(tr.ok, false);
});

test('today view lists the filled work packages of today with their lines', () => {
  const doc = parseDocument(complete);
  assert.equal(todayView(doc, '2026-11-10'), null);
  const v = todayView(doc, '2026-09-18');
  assert.equal(v.label, 'Fr 18.09.2026');
  assert.deepEqual(v.tasks.map(t => [t.text, t.checked]), [
    ['Projekt aufsetzen und Abhängigkeiten installieren', true], ['Parser der Bibliothek lesen und verstehen', true], ['Erste Diagnosen im Problems-Panel anzeigen', false]]);
  assert.equal(complete.split('\n')[v.tasks[2].line], '- [ ] Erste Diagnosen im Problems-Panel anzeigen');
  assert.deepEqual([v.min, v.max], [50, 100]);
});

test('review collects days, reflections and work packages that were never ticked', () => {
  const r = review(parseDocument(complete));
  assert.equal(r.number, 5);
  assert.equal(r.days.length, 2);
  assert.equal(r.tasksDone, 2);
  assert.equal(r.open.length, 4);
  assert.ok(r.days[0].reflection.length > 100 && r.goals.length > 20);
  // carried over and ticked later: not open any more
  const later = complete.replace('- [ ] Statusleiste mit Ampel einbauen', '- [x] Erste Diagnosen im Problems-Panel anzeigen');
  assert.ok(!review(parseDocument(later)).open.includes('Erste Diagnosen im Problems-Panel anzeigen'));
});

test('taking over into a new Lernperiode: name, projects, goals and open work packages', () => {
  const prev = parseDocument(complete);
  assert.deepEqual(takeOverChoices(prev), { name: true, projects: true, goals: true, tasks: true });
  assert.deepEqual(takeOverChoices(parseDocument(template)), { name: false, projects: false, goals: false, tasks: false });
  const fresh = newPeriodText(template, 6);
  const text = takeOver(fresh, complete, prev, { name: true, projects: true, goals: true, tasks: true });
  const doc = parseDocument(text);
  assert.equal(doc.number, 6);
  assert.equal(doc.name, prev.name);
  assert.equal(doc.overview.projects.text, prev.overview.projects.text);
  assert.equal(doc.overview.goals.text, prev.overview.goals.text);
  assert.equal(doc.overview.grades.text, '', 'Noten stay empty');
  assert.equal(doc.period, null, 'Zeitraum stays to be filled in');
  assert.deepEqual(doc.days[0].tasks.map(t => t.text), [
    'Erste Diagnosen im Problems-Panel anzeigen', 'Statusleiste mit Ampel einbauen', 'Befehle für neue Dateien schreiben', 'Tests mit Fixtures ergänzen']);
  assert.ok(doc.days[0].tasks.every(t => !t.checked));
  assert.match(text, /### Generelle Ziele\n<!--[\s\S]*?-->\n\n\S/, 'the hint comment stays, the text follows');
  // nothing chosen: unchanged
  assert.equal(takeOver(fresh, complete, prev, {}), fresh);
  // only one open package: the other placeholders stay
  const one = takeOver(fresh, complete, parseDocument(complete.replace(/- \[ \] (Statusleiste|Befehle|Tests)/g, '- [x] $1')), { tasks: true });
  assert.match(one, /- \[ \] Erste Diagnosen im Problems-Panel anzeigen\n- \[ \] \.\.\.Ihr Text\.\.\.\n- \[ \] \.\.\.Ihr Text\.\.\.\n/);
});
