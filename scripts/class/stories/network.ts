import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SimClassroom } from '../sim';

/** The network drops for one student for 45 s (F-19): not leaving, and nothing lost. */
export async function networkDrops(sim: SimClassroom, name = 'Mealea Heng', seconds = 45) {
  await sim.everyoneReady();
  await sim.room.start();
  const student = sim.student(name);
  await sim.until(() => student.session?.state === 'inExam');
  await student.write('Report.docx', 'before the gap');
  await student.exam!.backUp();

  student.unplug();
  await sim.until(() => sim.view(name).state === 'noContact');
  const during = { teacher: sim.view(name).state, student: student.session!.state };
  await student.write('Report.docx', 'written with no network');
  await sim.clock.wait(seconds * 1000 - 10_000);
  student.plug();
  await sim.until(() => sim.view(name).state === 'inExam' && student.session!.state === 'inExam');

  const log = await sim.log(name);
  const after = { ...sim.view(name) };
  const receipt = await student.handIn();
  return {
    during, after, log: log.map((e) => e.kind), gap: log.find((e) => e.kind === 'gap')?.details as { seconds: number; localLog: { kind: string }[] },
    receipt, handedIn: readFileSync(join(sim.room.folderOf(student.id), 'Report.docx'), 'utf8'),
    others: sim.room.view().students.filter((s) => s.name !== name).map((s) => s.state),
  };
}
