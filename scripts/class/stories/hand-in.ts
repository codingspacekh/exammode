import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SimClassroom } from '../sim';

/** Every student joins, the teacher starts, everyone works and hands in (F-01–F-03, F-08, F-16). */
export async function everyoneHandsIn(sim: SimClassroom) {
  await sim.everyoneReady();
  await sim.room.start();
  await sim.until(() => sim.students.every((s) => s.session?.state === 'inExam'));
  await Promise.all(sim.students.map(async (s) => {
    await s.write('Report.docx', `Report by ${s.name}`);
    await s.write('code/main.py', `print("${s.name}")`);
  }));
  const receipts = await Promise.all(sim.students.map((s) => s.handIn()));
  return {
    receipts: receipts.map((r) => r?.code),
    /** the receipt on the teacher's list, by student */
    onTheList: sim.students.map((s) => sim.view(s.name).receipt),
    states: sim.students.map((s) => sim.view(s.name).state),
    /** each student's folder in Hand-ins has their own work */
    folders: sim.students.map((s) => existsSync(join(sim.room.folderOf(s.id), 'code', 'main.py'))
      && readFileSync(join(sim.room.folderOf(s.id), 'Report.docx'), 'utf8') === `Report by ${s.name}`),
    /** what the log says about each student, in order */
    logs: await Promise.all(sim.students.map(async (s) => (await sim.log(s.name)).map((e) => e.kind))),
    /** the lab computers' Exam folders are gone */
    cleaned: sim.students.every((s) => !existsSync(s.folder)),
  };
}
