import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SimClassroom } from '../sim';

/** Nobody presses Hand in: at time up every student's work is handed in by itself (F-17). */
export async function timeIsUp(sim: SimClassroom) {
  await sim.everyoneReady();
  await sim.room.start();
  await sim.until(() => sim.students.every((s) => s.session?.state === 'inExam'));
  await Promise.all(sim.students.map((s) => s.write('answer.txt', `by ${s.name}`)));
  const { minutes } = sim.room.view().run;
  await sim.until(() => sim.room.view().students.every((s) => s.state === 'handedIn'), sim.clock.ms(minutes * 60_000) + 15_000);
  // … and every lab computer has its receipt
  await sim.until(() => sim.students.every((s) => s.exam?.receipt));
  return {
    students: sim.students.map((s) => sim.view(s.name)),
    work: sim.students.map((s) => readFileSync(join(sim.room.folderOf(s.id), 'answer.txt'), 'utf8') === `by ${s.name}`),
    receipts: sim.students.map((s) => s.exam?.receipt?.code),
  };
}
