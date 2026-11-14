import type { SimClassroom } from '../sim';

/** A student kills ExamMode, tries another computer, and is let back in by the teacher (F-18, F-20, F-40). */
export async function killedAndLetBackIn(sim: SimClassroom, name = 'Vannak Sok') {
  await sim.everyoneReady();
  await sim.room.start();
  const student = sim.student(name);
  await sim.until(() => student.session?.state === 'inExam');
  await student.write('Report.docx', 'before the kill');
  await student.exam!.backUp();

  await student.kill();
  const afterKill = { ...sim.view(name) };
  const reply = await student.join({ pc: 'PC-30' });
  await sim.until(() => sim.view(name).asksBackFrom === 'PC-30');
  const whileWaiting = { ...sim.view(name), session: student.session!.state };

  await sim.room.letBackIn(student.id, 'his computer froze');
  await sim.until(() => student.session!.state === 'inExam');
  await student.write('Report.docx', 'after coming back');
  const receipt = await student.handIn();
  return { afterKill, reply, whileWaiting, back: { ...sim.view(name) }, receipt, log: (await sim.log(name)).map((e) => e.kind), others: sim.room.view().students.filter((s) => s.name !== name).map((s) => s.state) };
}
