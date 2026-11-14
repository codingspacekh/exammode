import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SimClassroom, type SimOptions } from '../sim';

/** The prototype's class, with the computers its screens show (design/src/partials/students-grid.html). */
export const PROTOTYPE_CLASS: [string, string][] = [
  ['Sokha Chan', 'PC-14'], ['Dara Kim', 'PC-03'], ['Vannak Sok', 'PC-07'], ['Mealea Chea', 'PC-11'], ['Rithy Heng', 'PC-01'], ['Sophea Lim', 'PC-09'],
  ['Bopha Ouk', 'PC-12'], ['Chenda Ly', 'PC-02'], ['Kosal Meas', 'PC-19'], ['Leakena Pich', 'PC-05'], ['Nary Tep', 'PC-16'], ['Piseth Nhem', 'PC-08'],
  ['Ratana Keo', 'PC-20'], ['Seyha Mao', 'PC-04'], ['Sreymom Phan', 'PC-17'], ['Thida Ros', 'PC-06'], ['Vibol Yim', 'PC-21'], ['Chanthy Sam', 'PC-10'],
  ['Kunthea Hun', 'PC-13'], ['Makara Pen', 'PC-22'], ['Rotha Seng', 'PC-15'], ['Sovann Chhay', 'PC-18'], ['Dalin Kong', 'PC-23'], ['Sothea Nuon', 'PC-24'],
  ['Panha Choun', 'PC-25'], ['Visal Long', 'PC-26'],
];
/** Still working when the time runs out. */
const TO_THE_END = ['Piseth Nhem', 'Sothea Nuon', 'Panha Choun', 'Visal Long'];

/** Ten times as fast as a real exam: 26 students on a slow computer still have a whole second before they
 *  would count as *no contact*. */
export const wholeExamOptions: SimOptions = { students: PROTOTYPE_CLASS.map(([name]) => name), minutes: 2, speed: 10 };

/**
 * The teacher's whole exam, as the prototype tells it (MILESTONES §6, M6): Dara opens Chrome twice, Sophea, Seyha
 * and Vannak something once, Bopha clicks a site that isn't allowed; Rithy and Kosal hand in early; Mealea's
 * network goes for a while; Vannak's ExamMode is closed, he asks to come back from another computer and is kept
 * out; most hand in, four work until the time is up. It ends on screen 14.
 */
export async function wholeExam(sim: SimClassroom) {
  for (const [name, pc] of PROTOTYPE_CLASS) sim.student(name).pc = pc;
  await sim.everyoneReady();
  await sim.room.start();
  await sim.until(() => sim.students.every((s) => s.session?.state === 'inExam'));
  await Promise.all(sim.students.map((s) => s.write('Report.docx', `Report by ${s.name}`)));
  const closed = (name: string, app: string) => sim.student(name).session!.report('appClosed', { app });

  closed('Dara Kim', 'Google Chrome');
  closed('Seyha Mao', 'Notepad');
  closed('Vannak Sok', 'Notepad');
  sim.student('Bopha Ouk').session!.report('pageBlocked', { url: 'https://stackoverflow.com/questions/1' });
  closed('Sophea Lim', 'Discord');
  await sim.student('Rithy Heng').handIn();
  closed('Dara Kim', 'Google Chrome');
  await sim.student('Kosal Meas').handIn();

  // Mealea's network goes, and comes back: not leaving
  const mealea = sim.student('Mealea Chea');
  mealea.unplug();
  await sim.until(() => sim.view('Mealea Chea').state === 'noContact');
  const duringGap = sim.room.view().students.filter((s) => s.state === 'noContact').map((s) => s.name);

  // Vannak's ExamMode is closed from Task Manager; he tries another computer; the teacher keeps him out
  const vannak = sim.student('Vannak Sok');
  await vannak.exam!.backUp();
  await vannak.kill();
  const asked = await vannak.join({ pc: 'PC-27' });
  await sim.until(() => sim.view('Vannak Sok').asksBackFrom === 'PC-27');
  await sim.room.keepOut(vannak.id, 'Closed ExamMode from Task Manager');
  await sim.until(() => vannak.session!.state === 'refused');

  mealea.plug();
  await sim.until(() => sim.view('Mealea Chea').state === 'inExam' && mealea.session!.state === 'inExam');

  // most hand in; four work until the time is up
  const done = new Set(['Rithy Heng', 'Kosal Meas', 'Vannak Sok', ...TO_THE_END]);
  await Promise.all(sim.students.filter((s) => !done.has(s.name)).map((s) => s.handIn()));
  await sim.until(() => TO_THE_END.every((name) => sim.view(name).state === 'handedIn'), sim.clock.ms(sim.room.view().run.minutes * 60_000) + 20_000);
  await sim.room.end();

  const students = sim.room.view().students;
  const kinds = async (name: string) => (await sim.log(name)).map((e) => e.kind);
  return {
    asked, duringGap,
    /** the counts on screen 14 */
    handedIn: students.filter((s) => s.handedInHow === 'handIn').length,
    timeUp: students.filter((s) => s.handedInHow === 'timeUp').map((s) => s.name).sort(),
    left: students.filter((s) => s.state === 'left').map((s) => `${s.name}: ${s.leftHow}`),
    warnings: Object.fromEntries(students.filter((s) => s.warnings > 0).map((s) => [s.name, s.warnings])),
    receipts: new Set(students.map((s) => s.receipt).filter(Boolean)).size,
    /** everyone's work is on the teacher's laptop */
    folders: sim.students.filter((s) => existsSync(join(sim.room.folderOf(s.id), 'Report.docx'))).length,
    ended: sim.room.view().run.endedAt !== undefined,
    logs: { mealea: await kinds('Mealea Chea'), vannak: await kinds('Vannak Sok'), bopha: await kinds('Bopha Ouk'), rithy: await kinds('Rithy Heng') },
  };
}
