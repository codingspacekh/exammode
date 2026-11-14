import type { SimClassroom } from '../sim';

/** A wrong code, and a name that is already in the run on another computer, are refused (F-02, F-03). */
export async function wrongCodeAndNameTaken(sim: SimClassroom) {
  const [first, second] = sim.students;
  if (!first || !second) throw new Error('Two students are needed');
  const wrongCode = await first.join({ code: sim.code === '0000' ? '1111' : '0000' });
  const rightCode = await first.join();
  const nameTaken = await second.join({ studentId: first.id });
  const ownName = await second.join();
  return { wrongCode, rightCode, nameTaken, ownName, first: { ...sim.view(first.name) }, log: (await sim.log()).map((e) => e.kind) };
}

/** ExamMode crashes in the lobby, before Start: the student isn't locked out, and joins again normally (F-18). */
export async function crashInTheLobby(sim: SimClassroom, name = 'Dara Kim') {
  const student = sim.student(name);
  await student.sit();
  await sim.until(() => sim.view(name).state === 'ready');
  await student.kill(false);
  await sim.until(() => sim.view(name).state === 'notJoined');
  const reply = await student.join();
  student.session!.checks([{ check: 'oneScreen', ok: true }]);
  student.session!.ready();
  await sim.until(() => sim.view(name).state === 'ready');
  await sim.room.start();
  await sim.until(() => student.session!.state === 'inExam');
  return { reply, state: sim.view(name).state, log: (await sim.log(name)).map((e) => e.kind) };
}
