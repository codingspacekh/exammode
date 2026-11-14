import type { SimClassroom } from '../sim';

/**
 * N-03: 40 students on one teacher's laptop, and every change seen within 2 s. Measured in real time: from the
 * moment something happens on a lab computer to the moment the live view is told about it.
 */
export async function fortyStudents(sim: SimClassroom) {
  const told = new Map<string, number>();
  const watch = (is: (studentId: string) => boolean) => {
    told.clear();
    return sim.room.onChange((studentId) => {
      if (studentId && !told.has(studentId) && is(studentId)) told.set(studentId, performance.now());
    });
  };
  const state = (id: string) => sim.room.view().students.find((s) => s.id === id)!;
  /** Everyone does `act` at once; answers with the longest time until the teacher's view had it. */
  const slowest = async (is: (studentId: string) => boolean, act: (s: SimClassroom['students'][number]) => unknown) => {
    const stop = watch(is);
    const from = performance.now();
    await Promise.all(sim.students.map(act));
    await sim.until(() => told.size === sim.students.length);
    stop();
    return Math.round(Math.max(...told.values()) - from);
  };

  const ready = await slowest((id) => state(id).state === 'ready', (s) => s.sit());
  const from = performance.now();
  await sim.room.start();
  await sim.until(() => sim.students.every((s) => s.session?.state === 'inExam'));
  const start = Math.round(performance.now() - from);
  const warning = await slowest((id) => state(id).warnings === 1, (s) => s.session!.report('appClosed', { app: 'Chrome' }));
  await Promise.all(sim.students.map((s) => s.write('Report.docx', `Report by ${s.name}`)));
  const handIn = await slowest((id) => state(id).state === 'handedIn', (s) => s.handIn());
  return { students: sim.students.length, ms: { ready, start, warning, handIn }, states: sim.room.view().students.map((s) => s.state) };
}
