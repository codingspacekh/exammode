import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExamForm } from '@lib/app/state';
import { runChecks, type AppToClose } from '@lib/lockdown/checks';
import { StudentFlow } from '../../src/main/student/flow';
import type { LockInfo, Lockdown } from '../../src/main/student/lockdown';
import { TeacherDesk, type DeskOptions } from '../../src/main/teacher/desk';
import { eventually, later, tempFolder } from './helpers';

/** M3: the teacher's side and the student's side as the app runs them, without their windows, on this computer. */
const FORM: ExamForm = {
  teacher: 'Ms Srey Leak', title: 'Year 10 ICT — Term 1 practical exam', className: 'Year 10 A',
  studentNames: 'Sokha Chan\nDara Kim\n\n  Vannak Sok  \nDara Kim', minutes: 90, websites: [],
};

/** A lab computer's lock that only remembers what it was asked. */
class FakeLockdown implements Lockdown {
  displays = 1;
  apps: AppToClose[] = [{ name: 'Google Chrome', pids: [10, 11], windows: 2 }, { name: 'notepad', pids: [20], windows: 1, unsaved: 'notes.txt' }];
  locks: LockInfo[] = [];
  unlocks = 0;
  failWith?: string;
  /** an app that isn't allowed is closed during the exam */
  closes: (app: { name: string; kind: string }) => void = () => undefined;
  async check() {
    return { ...runChecks({ guard: true, displays: this.displays, remoteSession: false, remoteTools: [], machine: { manufacturer: 'Dell Inc.', model: 'OptiPlex', bios: '' } }), toClose: this.apps };
  }
  async lock(info: LockInfo, onClosed: (app: { name: string; kind: string }) => void) {
    if (this.failWith) return this.failWith;
    this.locks.push(info);
    this.closes = onClosed;
    return undefined;
  }
  async unlock() {
    this.unlocks++;
  }
}

async function lab(over: Partial<DeskOptions> = {}, lockdown?: Lockdown) {
  const root = await tempFolder();
  const clock = { ahead: 0 };
  const now = () => Date.now() + clock.ahead;
  const student = async (pc: string) => {
    const flow = new StudentFlow({ pc, examRoot: join(root, pc), bootId: `boot-${pc}`, discoveryPort: 0, now, lockdown: pc === 'PC-14' ? lockdown : undefined, timing: { beatMs: 40, retryMs: 40, clockMs: 20, graceMs: 40 } });
    await flow.start();
    later(() => flow.stop());
    return flow;
  };
  const flows = [await student('PC-14'), await student('PC-03')];
  const options: DeskOptions = {
    db: join(root, 'exammode.db'), handIns: join(root, 'Hand-ins'), port: 0, now, tickMs: 30,
    // every lab computer on this one: the beacon is sent to each listener's own port
    beacon: { everyMs: 50, port: flows[0]!.discoveryPort, targets: () => ['127.0.0.1'] }, ...over,
  };
  const open = async () => {
    const desk = await TeacherDesk.open(options);
    later(() => desk.close());
    return desk;
  };
  const desk = await open();
  /** the student at PC-14 finds the exam, picks their name and joins */
  const sit = async (flow: StudentFlow, name: string, code = desk.state().run!.code) => {
    await eventually(() => expect(flow.state().found).toHaveLength(1));
    await flow.pick(flow.state().found[0]!.runId);
    await flow.join(flow.state().names.find((n) => n.name === name)!.id, code);
  };
  const card = (d: TeacherDesk, name: string) => d.state().students.find((s) => s.name === name)!;
  return { root, clock, desk, open, options, flows, sokha: flows[0]!, sit, card };
}

describe('F-30 opening an exam (the minimal form of M3)', () => {
  it('the form says in words what is missing', async () => {
    const { desk } = await lab();
    expect(await desk.openExam({ ...FORM, teacher: ' ' })).toMatch(/your name/);
    expect(await desk.openExam({ ...FORM, title: '' })).toMatch(/title/);
    expect(await desk.openExam({ ...FORM, minutes: 0 })).toMatch(/between 1 minute and 10 hours/);
    expect(await desk.openExam({ ...FORM, minutes: 1.5 })).toMatch(/between/);
    expect(await desk.openExam({ ...FORM, className: '' })).toMatch(/Name the class/);
    expect(await desk.openExam({ ...FORM, studentNames: ' \n ' })).toMatch(/one on each line/);
    expect(await desk.openExam({ ...FORM, websites: ['docs.python.org/*', 'two words'] })).toMatch(/"two words" isn't a website address/);
    expect(desk.state()).toMatchObject({ screen: 'make', classes: [], students: [] });
    expect(desk.folder).toBeUndefined();
  });

  it('opening makes the class, the exam and a run with a code; the lobby lists the class', async () => {
    const { desk } = await lab();
    const seen: string[] = [];
    desk.onState((s) => seen.push(s.screen));
    expect(await desk.openExam(FORM)).toBeUndefined();
    const state = desk.state();
    expect(state.screen).toBe('lobby');
    expect(state.run).toMatchObject({ title: FORM.title, teacher: 'Ms Srey Leak', className: 'Year 10 A', minutes: 90, websites: [] });
    expect(state.run!.code).toMatch(/^\d{4}$/);
    // empty lines and a name typed twice are left out
    expect(state.students.map((s) => `${s.name}:${s.state}`)).toEqual(['Dara Kim:notJoined', 'Sokha Chan:notJoined', 'Vannak Sok:notJoined']);
    expect(state.classes).toEqual([{ id: expect.any(String), name: 'Year 10 A', students: 3, roster: [{ name: 'Dara Kim' }, { name: 'Sokha Chan' }, { name: 'Vannak Sok' }] }]);
    expect(state.exams).toMatchObject([{ title: FORM.title, className: 'Year 10 A', minutes: 90, websites: [], files: [], runs: 1 }]);
    expect(seen).toContain('lobby');
    expect(existsSync(desk.folder!)).toBe(true);
    expect(await desk.openExam(FORM)).toBe('An exam is already open.');
  });

  it('the next exam starts from the last one: the teacher\'s name and the class, which is kept', async () => {
    const { desk } = await lab();
    await desk.openExam(FORM);
    await desk.done();
    expect(desk.state().screen).toBe('lobby');
    await desk.end();
    await desk.done();
    const { classes, defaults, screen } = desk.state();
    expect(screen).toBe('make');
    expect(defaults).toEqual({ teacher: 'Ms Srey Leak', classId: classes[0]!.id });
    expect(await desk.openExam({ ...FORM, title: 'Term 2', classId: classes[0]!.id, className: '', studentNames: '' })).toBeUndefined();
    expect(desk.state().students).toHaveLength(3);
    expect(desk.state().classes).toHaveLength(1);
  });

  it('F-10 a website is opened once when it is added, and the hosts its pages load from are kept with it', async () => {
    const asked: string[] = [];
    const { desk, sokha, sit } = await lab({
      record: async (start) => {
        asked.push(start);
        if (start.includes('python')) throw new Error('no internet here');
        return ['fonts.gstatic.com'];
      },
    });
    await desk.openExam({ ...FORM, websites: ['ict.school.local/exams/y10-term1', ' ', 'docs.python.org/*'] });
    expect(asked).toEqual(['https://ict.school.local/exams/y10-term1', 'https://docs.python.org/']);
    const websites = [{ url: 'ict.school.local/exams/y10-term1', hosts: ['fonts.gstatic.com'] }, { url: 'docs.python.org/*', hosts: [] }];
    expect(desk.state().run!.websites).toEqual(websites);

    await sit(sokha, 'Sokha Chan');
    expect(sokha.websites).toEqual(websites);
    expect(sokha.state().exam).toMatchObject({ hasQuestions: true });
    // a page that isn't part of the exam is a note in the teacher's feed (F-13)
    await desk.start();
    await eventually(() => expect(sokha.state().screen).toBe('exam'));
    await sokha.exam!.begin();
    sokha.report('pageBlocked', { url: 'https://stackoverflow.com/questions/1' });
    await eventually(() => expect(desk.state().feed[0]).toMatchObject({ kind: 'pageBlocked', student: 'Sokha Chan', pc: 'PC-14', details: { url: 'https://stackoverflow.com/questions/1' } }));
    expect(desk.state().students.find((s) => s.name === 'Sokha Chan')!.warnings).toBe(0);
  });
});

describe('F-33 F-35 F-43 exams that are kept, classes, and files to give', () => {
  it('F-35 an exam is saved without opening it, changed, copied, opened again, and deleted only if it was never run', async () => {
    const { desk } = await lab();
    const saved = await desk.saveExam(FORM);
    if ('error' in saved) throw new Error(saved.error);
    expect(desk.state()).toMatchObject({ screen: 'make', exams: [{ id: saved.id, title: FORM.title, runs: 0 }] });
    expect(await desk.saveExam({ ...FORM, title: ' ' })).toEqual({ error: 'Give the exam a title.' });

    const classId = desk.state().classes[0]!.id;
    await desk.saveExam({ ...FORM, id: saved.id, classId, title: 'Term 1 practical', minutes: 60 });
    expect(desk.state().exams).toMatchObject([{ id: saved.id, title: 'Term 1 practical', minutes: 60 }]);
    expect(desk.state().classes).toHaveLength(1);

    await desk.copyExam(saved.id);
    await desk.copyExam('no-such-exam');
    expect(desk.state().exams.map((e) => e.title).sort()).toEqual(['Term 1 practical', 'Term 1 practical (copy)']);
    const copy = desk.state().exams.find((e) => e.title.endsWith('(copy)'))!;
    expect(await desk.deleteExam(copy.id)).toBeUndefined();

    expect(await desk.openSaved('no-such-exam')).toMatch(/isn't kept/);
    expect(await desk.openSaved(saved.id)).toBeUndefined();
    expect(desk.state()).toMatchObject({ screen: 'lobby', run: { title: 'Term 1 practical', minutes: 60 } });
    expect(await desk.openSaved(saved.id)).toBe('An exam is already open.');
    expect(await desk.deleteExam(saved.id)).toBe('This exam is open now.');
    await desk.end();
    await desk.done();
    expect(await desk.deleteExam(saved.id)).toMatch(/was run/);
    expect(desk.state().exams).toMatchObject([{ id: saved.id, runs: 1 }]);
  });

  it('F-43 a class is made from a pasted list, changed, and deleted only when no exam uses it', async () => {
    const { desk, sokha, sit } = await lab();
    expect(await desk.saveClass({ name: ' ', list: 'Sokha Chan' })).toBe('Name the class.');
    expect(await desk.saveClass({ name: 'Year 10 A', list: ' \n' })).toMatch(/one on each line/);
    expect(await desk.saveClass({ name: 'Year 10 A', list: 'No\tName\tEmail\n1\tSokha Chan\tsokha.chan@school.edu\n2\tDara Kim\tdara.kim@school.edu' })).toBeUndefined();
    const cls = desk.state().classes[0]!;
    expect(cls).toMatchObject({ name: 'Year 10 A', students: 2, roster: [{ name: 'Dara Kim', email: 'dara.kim@school.edu', number: 2 }, { name: 'Sokha Chan', email: 'sokha.chan@school.edu', number: 1 }] });
    expect(await desk.saveClass({ name: 'year 10 a', list: 'Someone' })).toBe('There is already a class called year 10 a.');

    // an exam with this class is run; Sokha takes it
    await desk.openExam({ ...FORM, classId: cls.id });
    expect(await desk.saveClass({ id: cls.id, name: 'Year 10 A', list: 'Dara Kim' })).toMatch(/in the exam that is open now/);
    await sit(sokha, 'Sokha Chan');
    await desk.end();
    await desk.done();

    // Sokha is renamed (the email says it is her), Dara is taken off, Vannak is new
    expect(await desk.saveClass({ id: cls.id, name: 'Year 10 A (ICT)', list: 'Sokha C. Chan\tsokha.chan@school.edu\nVannak Sok' })).toBeUndefined();
    expect(desk.state().classes[0]).toMatchObject({ name: 'Year 10 A (ICT)', roster: [{ name: 'Sokha C. Chan' }, { name: 'Vannak Sok' }] });
    // taking Sokha off: she stays, as the exam has her record
    expect(await desk.saveClass({ id: cls.id, name: 'Year 10 A (ICT)', list: 'Vannak Sok' })).toBe('Saved. 1 student who was taken off stays on the list: earlier exams have their work.');
    expect(desk.state().classes[0]!.students).toBe(2);

    expect(await desk.deleteClass(cls.id)).toMatch(/An exam uses this class/);
    await desk.saveClass({ name: 'Year 9 C', list: 'Kosal Meas' });
    const spare = desk.state().classes.find((c) => c.name === 'Year 9 C')!;
    expect(await desk.deleteClass(spare.id)).toBeUndefined();
    expect(desk.state().classes.map((c) => c.name)).toEqual(['Year 10 A (ICT)']);
  });

  it('F-33 files to give are kept with the exam, reach every student\'s Exam folder at Start, and are handed in only if changed', async () => {
    const { desk, sokha, sit, card, root } = await lab();
    const mine = join(root, 'teacher-files');
    await mkdir(mine, { recursive: true });
    await writeFile(join(mine, 'marks.csv'), 'name,mark\n');
    await writeFile(join(mine, 'grades.py'), '# starter code\n');
    const files = [{ name: 'marks.csv', bytes: 0, path: join(mine, 'marks.csv') }, { name: 'grades.py', bytes: 0, path: join(mine, 'grades.py') }];
    expect(await desk.saveExam({ ...FORM, files: [files[0]!, { ...files[0]!, name: 'MARKS.csv' }] })).toEqual({ error: 'Two of the files to give have the same name.' });
    expect(await desk.saveExam({ ...FORM, files: [{ name: 'a/b.txt', bytes: 0, path: files[0]!.path }] })).toMatchObject({ error: expect.stringContaining('can\'t be given') });
    expect(await desk.saveExam({ ...FORM, files: [{ name: 'gone.txt', bytes: 0 }] })).toMatchObject({ error: expect.stringContaining('can\'t be read any more') });
    const saved = await desk.saveExam({ ...FORM, files });
    if ('error' in saved) throw new Error(saved.error);
    const classId = desk.state().classes.at(-1)!.id;
    expect(desk.state().exams.find((e) => e.id === saved.id)!.files).toEqual([{ name: 'grades.py', bytes: 15 }, { name: 'marks.csv', bytes: 10 }]);
    // the teacher's own copy can change or go: the exam has its own. One file is taken off again
    await writeFile(join(mine, 'marks.csv'), 'changed afterwards');
    await desk.copyExam(saved.id);
    await desk.saveExam({ ...FORM, id: saved.id, classId, files: [{ name: 'marks.csv', bytes: 10 }, { name: 'grades.py', bytes: 15 }] });
    expect(desk.state().exams.find((e) => e.title.endsWith('(copy)'))!.files).toHaveLength(2);

    await desk.openSaved(saved.id);
    await sit(sokha, 'Sokha Chan');
    await eventually(() => expect(card(desk, 'Sokha Chan').state).toBe('ready'));
    await desk.start();
    await eventually(() => expect(sokha.state().screen).toBe('exam'));
    await sokha.exam!.begin();
    expect(readFileSync(join(sokha.folder!, 'marks.csv'), 'utf8')).toBe('name,mark\n');
    expect(readFileSync(join(sokha.folder!, 'grades.py'), 'utf8')).toBe('# starter code\n');

    // a given file that wasn't touched isn't backed up; one that was changed is
    expect(await sokha.exam!.backUp()).toBe(0);
    await writeFile(join(sokha.folder!, 'grades.py'), '# starter code\nprint(1)\n');
    await sokha.askHandIn();
    expect(sokha.state().handIn).toMatchObject({ files: [{ name: 'grades.py' }], unchanged: [{ name: 'marks.csv', bytes: 10 }] });
    await sokha.handIn();
    expect(sokha.state().receipt!.files.map((f) => f.name)).toEqual(['grades.py']);
    await eventually(() => expect(card(desk, 'Sokha Chan')).toMatchObject({ state: 'handedIn', files: 1 }));

    // a file is given only to a student of the run
    const base = `http://127.0.0.1:${desk.port}/runs/${desk.state().run!.id}/files`;
    expect((await fetch(`${base}/marks.csv`)).status).toBe(404);
    expect((await fetch(`${base}/marks.csv`, { headers: { 'x-exammode-token': 'made-up' } })).status).toBe(404);
  });
});

describe('M3 an exam from the lobby to the receipts', () => {
  it('F-01 F-02 F-03 a lab computer lists the exam, shows the class to pick a name from, and refuses a wrong code', async () => {
    const { desk, sokha, sit, card } = await lab();
    expect(sokha.state()).toMatchObject({ screen: 'join', pc: 'PC-14', found: [], names: [], joining: false });
    await desk.openExam(FORM);
    await eventually(() => expect(sokha.state().found).toHaveLength(1));
    expect(sokha.state().found[0]).toMatchObject({ title: FORM.title, teacher: 'Ms Srey Leak', class: 'Year 10 A', minutes: 90, host: '127.0.0.1', port: desk.port });

    await sokha.pick('no-such-run');
    expect(sokha.state().picked).toBeUndefined();
    await sokha.pick(sokha.state().found[0]!.runId);
    expect(sokha.state().names.map((n) => n.name)).toEqual(['Dara Kim', 'Sokha Chan', 'Vannak Sok']);
    await sokha.join('nobody', '0000');
    expect(sokha.state().joining).toBe(false);

    await sit(sokha, 'Sokha Chan', desk.state().run!.code === '0000' ? '1111' : '0000');
    expect(sokha.state()).toMatchObject({ screen: 'join', joining: false, joinError: 'codeWrong' });
    expect(card(desk, 'Sokha Chan').state).toBe('notJoined');
    expect(sokha.state().names).toHaveLength(3);
  });

  it('F-08 F-16 two students join, the teacher starts, they hand in: the receipts are the same on both sides', async () => {
    const { desk, flows, sit, card } = await lab();
    const [sokha, dara] = flows as [StudentFlow, StudentFlow];
    await desk.openExam(FORM);
    // (this computer's second listener is on another port: the name is typed in instead, F-01)
    await sit(sokha, 'Sokha Chan');
    await dara.lookAt('127.0.0.1');
    expect(dara.state().joinError).toBe('unreachable');
    Object.assign(dara, { options: { ...dara['options'], teacherPort: desk.port } });
    await dara.lookAt(' 127.0.0.1 ');
    await sit(dara, 'Dara Kim');
    expect(sokha.state()).toMatchObject({ screen: 'waiting', student: { name: 'Sokha Chan' }, contact: true, exam: { title: FORM.title, teacher: 'Ms Srey Leak', minutes: 90, hasQuestions: false } });
    await eventually(() => expect(desk.state().students.filter((s) => s.state === 'ready')).toHaveLength(2));
    expect(desk.state().screen).toBe('lobby');
    // Dara's name can't be picked on a third computer
    expect(card(desk, 'Dara Kim')).toMatchObject({ pc: 'PC-03', connected: true });

    await desk.start();
    await eventually(() => expect([sokha.state().screen, dara.state().screen]).toEqual(['exam', 'exam']));
    // (the Exam folders are there)
    await Promise.all([sokha.exam!.begin(), dara.exam!.begin()]);
    const { run } = desk.state();
    expect(desk.state().screen).toBe('live');
    expect(sokha.state().endsAt).toBe(run!.endsAt);
    expect(Math.abs(sokha.state().clockOffset)).toBeLessThan(1000);
    expect(desk.state().feed.map((f) => f.kind)).toEqual(['runStarted']);

    // Sokha works in the Exam folder, looks at what would go, keeps working, then hands in
    await mkdir(join(sokha.folder!, 'code'), { recursive: true });
    await writeFile(join(sokha.folder!, 'Report.docx'), 'my report');
    await writeFile(join(sokha.folder!, 'code', 'grades.py'), 'print(1)');
    await sokha.handIn();
    expect(sokha.state().handingIn).toBe(false);
    await sokha.askHandIn();
    expect(sokha.state()).toMatchObject({ screen: 'handIn', handIn: { files: [{ name: 'code/grades.py', bytes: 8 }, { name: 'Report.docx', bytes: 9 }], unchanged: [] } });
    sokha.keepWorking();
    expect(sokha.state()).toMatchObject({ screen: 'exam', handIn: undefined });
    sokha.finish();
    expect(sokha.state().screen).toBe('exam');
    await sokha.askHandIn();
    await sokha.handIn();
    const { receipt } = sokha.state();
    expect(sokha.state()).toMatchObject({ screen: 'handedIn', handingIn: false, receipt: { byItself: false, files: [{ name: 'code/grades.py' }, { name: 'Report.docx' }] } });
    await eventually(() => expect(card(desk, 'Sokha Chan')).toMatchObject({ state: 'handedIn', handedInHow: 'handIn', receipt: receipt!.code, files: 2 }));
    expect(readFileSync(join(desk.folder!, 'Sokha Chan', 'Report.docx'), 'utf8')).toBe('my report');
    expect(desk.state().feed[0]).toMatchObject({ kind: 'handedIn', student: 'Sokha Chan', pc: 'PC-14' });

    // F-41 the teacher ends the exam: Dara's work is handed in by itself
    await writeFile(join(dara.folder!, 'sales.xlsx'), 'numbers');
    await desk.end();
    await eventually(() => expect(dara.state().screen).toBe('handedIn'));
    expect(dara.state().receipt).toMatchObject({ byItself: true, files: [{ name: 'sales.xlsx', bytes: 7 }] });
    await eventually(() => expect(card(desk, 'Dara Kim')).toMatchObject({ state: 'handedIn', handedInHow: 'ended', receipt: dara.state().receipt!.code }));
    expect(desk.state().run!.endedAt).toBeDefined();

    // Finish: ExamMode is as it was; joining the exam again is refused
    sokha.finish();
    expect(sokha.state().screen).toBe('join');
    expect(sokha.state().receipt ?? sokha.state().exam).toBeUndefined();
    dara.keepWorking();
    await dara.askHandIn();
    expect(dara.state().screen).toBe('handedIn');
  });

  it('F-17 at time up the work is handed in by itself', async () => {
    const { desk, sokha, sit, card, clock } = await lab();
    await desk.openExam({ ...FORM, minutes: 1 });
    await sit(sokha, 'Sokha Chan');
    await desk.start();
    await eventually(() => expect(sokha.state().screen).toBe('exam'));
    await sokha.exam!.begin();
    await writeFile(join(sokha.folder!, 'answer.txt'), '42');
    await sokha.askHandIn();
    clock.ahead = 61_000;
    await eventually(() => expect(sokha.state().screen).toBe('handedIn'));
    expect(sokha.state().receipt).toMatchObject({ byItself: true, files: [{ name: 'answer.txt' }] });
    await eventually(() => expect(card(desk, 'Sokha Chan')).toMatchObject({ handedInHow: 'timeUp' }));
  });

  it('F-18 F-20 a student who left is told so on any computer, and waits for the teacher (10)', async () => {
    const { desk, flows, sit } = await lab();
    const [sokha, other] = flows as [StudentFlow, StudentFlow];
    await desk.openExam(FORM);
    await sit(sokha, 'Sokha Chan');
    await desk.start();
    await eventually(() => expect(sokha.state().screen).toBe('exam'));
    await sokha.exam!.begin();
    // someone starts another ExamMode as Sokha on the same computer: the first had stopped, for the teacher's laptop
    Object.assign(other, { options: { ...other['options'], teacherPort: desk.port, pc: 'PC-14' } });
    await other.lookAt('127.0.0.1');
    await sit(other, 'Sokha Chan');
    expect(other.state()).toMatchObject({ screen: 'cantJoin', student: { name: 'Sokha Chan' }, exam: { title: FORM.title }, left: { how: 'stoppedSuddenly', pc: 'PC-14' } });
    await eventually(() => expect(desk.state().students.find((s) => s.name === 'Sokha Chan')).toMatchObject({ state: 'left', asksBackFrom: 'PC-14' }));
    // … and the first one finds that out when it hands in
    await sokha.askHandIn();
    await sokha.handIn();
    await eventually(() => expect(sokha.state()).toMatchObject({ screen: 'join', joinError: 'left' }));

    // F-40 Keep out: the waiting ExamMode is told, and is back on the join screen
    await desk.keepOut(desk.state().students.find((s) => s.name === 'Sokha Chan')!.id, ' was seen with a phone ');
    await eventually(() => expect(other.state()).toMatchObject({ screen: 'join', joinError: 'keptOut' }));
    expect(desk.state().events.at(-1)).toMatchObject({ kind: 'keptOut', student: 'Sokha Chan', details: { reason: 'was seen with a phone' } });

    // asking again, then giving up, is back on the join screen with nothing said
    await sit(other, 'Sokha Chan');
    expect(other.state().screen).toBe('cantJoin');
    other.giveUp();
    expect(other.state().screen).toBe('join');
    expect(other.state().joinError).toBeUndefined();
  });

  it('F-15 F-18 F-40 Leave is asked first; after it the student can\'t join again until the teacher lets them back in — then the exam opens by itself', async () => {
    const { desk, sokha, sit, card } = await lab();
    await desk.openExam(FORM);
    await sit(sokha, 'Sokha Chan');
    await eventually(() => expect(card(desk, 'Sokha Chan').state).toBe('ready'));
    await desk.start();
    await eventually(() => expect(sokha.state().screen).toBe('exam'));
    await sokha.exam!.begin();
    const folder = sokha.folder!;
    await writeFile(join(folder, 'Report.docx'), 'half done');

    await sokha.leave();
    await sokha.askLeave();
    expect(sokha.state()).toMatchObject({ screen: 'leave', handIn: { files: [{ name: 'Report.docx' }] } });
    sokha.keepWorking();
    expect(sokha.state().screen).toBe('exam');
    await sokha.askLeave();
    await sokha.leave();
    expect(sokha.state()).toMatchObject({ screen: 'join', handingIn: false });
    await eventually(() => expect(card(desk, 'Sokha Chan')).toMatchObject({ state: 'left', leftHow: 'pressedLeave', files: 1 }));
    expect(readFileSync(join(desk.folder!, 'Sokha Chan', 'Report.docx'), 'utf8')).toBe('half done');
    expect(existsSync(folder)).toBe(false);
    expect(desk.state().files[card(desk, 'Sokha Chan').id]).toEqual([{ name: 'Report.docx', bytes: 9, kind: 'backup' }]);

    // joining again: refused; the teacher sees the request and lets them back in
    await sit(sokha, 'Sokha Chan');
    expect(sokha.state()).toMatchObject({ screen: 'cantJoin', left: { how: 'pressedLeave', pc: 'PC-14' } });
    await desk.letBackIn(card(desk, 'Sokha Chan').id, 'Pressed Leave by mistake');
    await eventually(() => expect(sokha.state()).toMatchObject({ screen: 'exam', endsAt: desk.state().run!.endsAt }));
    expect(sokha.state().left).toBeUndefined();
    await eventually(() => expect(card(desk, 'Sokha Chan')).toMatchObject({ state: 'inExam', connected: true }));
    expect(desk.state().events.filter((e) => e.student === 'Sokha Chan').map((e) => e.kind)).toEqual(['joined', 'ready', 'started', 'left', 'asksBack', 'letBackIn', 'cameBack']);

    // F-41 more time, for this student and then for everyone
    await desk.addTime(10, card(desk, 'Sokha Chan').id);
    await desk.addTime(5);
    await desk.addTime(0);
    await eventually(() => expect(sokha.state().endsAt).toBe(desk.state().run!.startedAt! + 105 * 60_000));
    expect(card(desk, 'Sokha Chan').extraMinutes).toBe(10);

    // F-42 after the end: the screen is the list of hand-ins, and the log is a spreadsheet
    await desk.end();
    await eventually(() => expect(desk.state().screen).toBe('ended'));
    const csv = desk.logCsv().split('\r\n');
    expect(csv[0]).toContain('Time,Student,Computer,What happened,Details');
    expect(csv.some((row) => row.includes(',Sokha Chan,PC-14,letBackIn,reason: Pressed Leave by mistake'))).toBe(true);
    expect(desk.folderOf(card(desk, 'Sokha Chan').id)).toBe(join(desk.folder!, 'Sokha Chan'));
  });

  it('F-19 with no contact the exam bar says so, and says so no longer when contact is back', async () => {
    const { desk, sokha, sit } = await lab();
    await desk.openExam(FORM);
    await sit(sokha, 'Sokha Chan');
    await desk.start();
    await eventually(() => expect(sokha.state().screen).toBe('exam'));
    await sokha.exam!.begin();
    sokha.session!.drop();
    await eventually(() => expect(sokha.state().contact).toBe(false));
    await eventually(() => expect(sokha.state()).toMatchObject({ contact: true, screen: 'exam' }));
  });

  it('N-05 the teacher\'s laptop restarts during the exam: ExamMode opens on the live view, and the student is still in', async () => {
    const { desk, open, options, sokha, sit, card } = await lab();
    await desk.openExam(FORM);
    await sit(sokha, 'Sokha Chan');
    await desk.start();
    await eventually(() => expect(sokha.state().screen).toBe('exam'));
    await sokha.exam!.begin();
    const port = desk.port;
    await desk.close();
    await eventually(() => expect(sokha.state().contact).toBe(false));

    options.port = port;
    const again = await open();
    expect(again.state()).toMatchObject({ screen: 'live', run: { title: FORM.title } });
    await eventually(() => expect(sokha.state().contact).toBe(true));
    await eventually(() => expect(card(again, 'Sokha Chan')).toMatchObject({ state: 'inExam', connected: true }));
  });

  it('a second ExamMode in teacher mode on the same port says so instead of opening', async () => {
    const { desk, options } = await lab();
    await expect(TeacherDesk.open({ ...options, db: join(await tempFolder(), 'other.db'), port: desk.port })).rejects.toThrow(/EADDRINUSE/);
  });
});

describe('M4 locking the lab computer, in the student\'s flow (F-04–F-07, F-12, F-21)', () => {
  async function locking() {
    const lockdown = new FakeLockdown();
    const l = await lab({}, lockdown);
    await l.desk.openExam(FORM);
    return { ...l, lockdown };
  }

  it('after Join the computer is checked and the apps to close are listed; locking it makes the student ready', async () => {
    const { desk, sokha, sit, card, lockdown } = await locking();
    await sit(sokha, 'Sokha Chan');
    await eventually(() => expect(sokha.state().checks?.checks).toHaveLength(4));
    expect(sokha.state()).toMatchObject({ screen: 'checks', locked: false, checks: { ok: true, locking: false, toClose: [{ name: 'Google Chrome', windows: 2 }, { name: 'notepad', unsaved: 'notes.txt' }] } });
    await eventually(() => expect(card(desk, 'Sokha Chan')).toMatchObject({ state: 'checking', failed: [] }));
    expect(lockdown.locks).toEqual([]);

    await sokha.lock();
    expect(lockdown.locks).toEqual([{ runId: desk.state().run!.id, teacher: { host: '127.0.0.1', port: desk.port }, websites: false, token: sokha.session!.token, instanceId: sokha.session!.seat.instanceId, pc: 'PC-14' }]);
    expect(sokha.state()).toMatchObject({ screen: 'waiting', locked: true, checks: undefined });
    await eventually(() => expect(card(desk, 'Sokha Chan').state).toBe('ready'));
    // pressed twice, or pressed on another screen, it does nothing more
    await sokha.lock();
    await sokha.checkAgain();
    sokha.backOut();
    expect(lockdown.locks).toHaveLength(1);
    expect(sokha.state().screen).toBe('waiting');
  });

  it('F-04 a computer that fails a check can\'t be locked, and the teacher sees why; fixed and checked again, it can', async () => {
    const { desk, sokha, sit, card, lockdown } = await locking();
    lockdown.displays = 2;
    await sit(sokha, 'Sokha Chan');
    await eventually(() => expect(sokha.state().checks?.checks).toHaveLength(4));
    expect(sokha.state().checks).toMatchObject({ ok: false, checks: [{ check: 'guard', ok: true }, { check: 'oneScreen', ok: false, found: '2 screens' }, {}, {}] });
    await eventually(() => expect(card(desk, 'Sokha Chan').failed).toEqual(['oneScreen']));
    expect(desk.state().feed[0]).toMatchObject({ kind: 'checkFailed', student: 'Sokha Chan', details: { check: 'oneScreen' } });
    await sokha.lock();
    expect(lockdown.locks).toEqual([]);

    lockdown.displays = 1;
    await sokha.checkAgain();
    expect(sokha.state().checks?.ok).toBe(true);
    await eventually(() => expect(card(desk, 'Sokha Chan').failed).toEqual([]));
    await sokha.lock();
    expect(sokha.state()).toMatchObject({ screen: 'waiting', locked: true });
  });

  it('a computer that can\'t be locked says why, and isn\'t ready', async () => {
    const { desk, sokha, sit, card, lockdown } = await locking();
    lockdown.failWith = 'ExamMode Guard didn\'t answer.';
    await sit(sokha, 'Sokha Chan');
    await eventually(() => expect(sokha.state().checks?.ok).toBe(true));
    await sokha.lock();
    expect(sokha.state()).toMatchObject({ screen: 'checks', locked: false, checks: { locking: false, error: 'ExamMode Guard didn\'t answer.' } });
    expect(card(desk, 'Sokha Chan').state).toBe('checking');
    lockdown.failWith = undefined;
    await sokha.lock();
    expect(sokha.state().screen).toBe('waiting');
  });

  it('Back on the checks takes the student off the teacher\'s list; nothing was locked', async () => {
    const { desk, sokha, sit, card, lockdown } = await locking();
    await sit(sokha, 'Sokha Chan');
    await eventually(() => expect(sokha.state().screen).toBe('checks'));
    sokha.backOut();
    expect(sokha.state()).toMatchObject({ screen: 'join', names: [{}, {}, {}] });
    expect(sokha.state().joinError).toBeUndefined();
    await eventually(() => expect(card(desk, 'Sokha Chan').state).toBe('notJoined'));
    expect(lockdown.unlocks).toBe(0);
  });

  it('F-12 an app closed during the exam is said to the student and counts as a warning for the teacher; F-21 Finish unlocks', async () => {
    const { desk, sokha, sit, card, lockdown } = await locking();
    await sit(sokha, 'Sokha Chan');
    await eventually(() => expect(sokha.state().checks?.ok).toBe(true));
    await sokha.lock();
    await eventually(() => expect(card(desk, 'Sokha Chan').state).toBe('ready'));
    await desk.start();
    await eventually(() => expect(sokha.state().screen).toBe('exam'));

    lockdown.closes({ name: 'Google Chrome', kind: 'browser' });
    expect(sokha.state().closed).toMatchObject({ name: 'Google Chrome' });
    await eventually(() => expect(card(desk, 'Sokha Chan').warnings).toBe(1));
    expect(desk.state().feed[0]).toMatchObject({ kind: 'appClosed', student: 'Sokha Chan', details: { app: 'Google Chrome' } });

    await sokha.askHandIn();
    await sokha.handIn();
    // still locked on the receipt: Finish is what puts the computer back
    expect(sokha.state()).toMatchObject({ screen: 'handedIn', locked: true });
    expect(lockdown.unlocks).toBe(0);
    sokha.finish();
    expect(sokha.state()).toMatchObject({ screen: 'join', locked: false });
    expect(sokha.state().closed).toBeUndefined();
    expect(lockdown.unlocks).toBe(1);
  });

  it('F-15 F-18 leaving unlocks; a student who is let back in is locked again before the exam opens', async () => {
    const { desk, sokha, sit, card, lockdown } = await locking();
    await sit(sokha, 'Sokha Chan');
    await eventually(() => expect(sokha.state().checks?.ok).toBe(true));
    await sokha.lock();
    await eventually(() => expect(card(desk, 'Sokha Chan').state).toBe('ready'));
    await desk.start();
    await eventually(() => expect(sokha.state().screen).toBe('exam'));
    await sokha.askLeave();
    await sokha.leave();
    expect(lockdown.unlocks).toBe(1);
    expect(sokha.state().locked).toBe(false);

    await sit(sokha, 'Sokha Chan');
    expect(sokha.state()).toMatchObject({ screen: 'cantJoin', locked: false });
    await desk.letBackIn(card(desk, 'Sokha Chan').id, 'Pressed Leave by mistake');
    await eventually(() => expect(sokha.state()).toMatchObject({ screen: 'exam', locked: true }));
    expect(lockdown.locks).toHaveLength(2);
    expect(lockdown.locks[1]!.token).toBe(sokha.session!.token);
  });
});

