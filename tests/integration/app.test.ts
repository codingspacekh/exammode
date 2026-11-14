import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExamForm } from '@lib/app/state';
import { StudentFlow } from '../../src/main/student/flow';
import { TeacherDesk, type DeskOptions } from '../../src/main/teacher/desk';
import { eventually, later, tempFolder } from './helpers';

/** M3: the teacher's side and the student's side as the app runs them, without their windows, on this computer. */
const FORM: ExamForm = {
  teacher: 'Ms Srey Leak', title: 'Year 10 ICT — Term 1 practical exam', className: 'Year 10 A',
  studentNames: 'Sokha Chan\nDara Kim\n\n  Vannak Sok  \nDara Kim', minutes: 90, websites: [],
};

async function lab(over: Partial<DeskOptions> = {}) {
  const root = await tempFolder();
  const clock = { ahead: 0 };
  const now = () => Date.now() + clock.ahead;
  const student = async (pc: string) => {
    const flow = new StudentFlow({ pc, examRoot: join(root, pc), bootId: `boot-${pc}`, discoveryPort: 0, now, timing: { beatMs: 40, retryMs: 40, clockMs: 20, graceMs: 40 } });
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
    expect(state.classes).toEqual([{ id: expect.any(String), name: 'Year 10 A', students: 3 }]);
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
    sokha.report('pageBlocked', { url: 'https://stackoverflow.com/questions/1' });
    await eventually(() => expect(desk.state().feed[0]).toMatchObject({ kind: 'pageBlocked', student: 'Sokha Chan', pc: 'PC-14', details: { url: 'https://stackoverflow.com/questions/1' } }));
    expect(desk.state().students.find((s) => s.name === 'Sokha Chan')!.warnings).toBe(0);
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
    expect(sokha.state()).toMatchObject({ screen: 'handIn', handIn: { files: [{ name: 'Report.docx', bytes: 9 }, { name: 'code/grades.py', bytes: 8 }], unchanged: [] } });
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
    await writeFile(join(sokha.folder!, 'answer.txt'), '42');
    await sokha.askHandIn();
    clock.ahead = 61_000;
    await eventually(() => expect(sokha.state().screen).toBe('handedIn'));
    expect(sokha.state().receipt).toMatchObject({ byItself: true, files: [{ name: 'answer.txt' }] });
    await eventually(() => expect(card(desk, 'Sokha Chan')).toMatchObject({ handedInHow: 'timeUp' }));
  });

  it('F-18 a student who is refused is back on the join screen, told why', async () => {
    const { desk, flows, sit } = await lab();
    const [sokha, other] = flows as [StudentFlow, StudentFlow];
    await desk.openExam(FORM);
    await sit(sokha, 'Sokha Chan');
    await desk.start();
    await eventually(() => expect(sokha.state().screen).toBe('exam'));
    // someone starts another ExamMode as Sokha on the same computer: the first had stopped, for the teacher's laptop
    Object.assign(other, { options: { ...other['options'], teacherPort: desk.port, pc: 'PC-14' } });
    await other.lookAt('127.0.0.1');
    await sit(other, 'Sokha Chan');
    expect(other.state()).toMatchObject({ screen: 'join', joinError: 'left' });
    // … and the first one finds that out when it hands in
    await sokha.askHandIn();
    await sokha.handIn();
    await eventually(() => expect(sokha.state()).toMatchObject({ screen: 'join', joinError: 'left' }));
  });

  it('F-19 with no contact the exam bar says so, and says so no longer when contact is back', async () => {
    const { desk, sokha, sit } = await lab();
    await desk.openExam(FORM);
    await sit(sokha, 'Sokha Chan');
    await desk.start();
    await eventually(() => expect(sokha.state().screen).toBe('exam'));
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
