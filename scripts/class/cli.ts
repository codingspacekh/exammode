/**
 * `npm run class -- --students 30 --minutes 10 --speed 20`
 *
 * A simulated classroom to watch (architecture §2.14): a teacher's side on this computer and fake students who
 * join, work, lose the network, get killed, come back and hand in. It announces itself on the real ports, so an
 * ExamMode on the same network lists the exam.
 *
 *   --students n   how many students (30)          --minutes m   the exam's length (10)
 *   --speed s      how many times faster than real time (1)      --port p   the server's port (47800)
 *   --keep         keep the hand-ins and the database afterwards
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BEACON_PORT, broadcastAddresses } from '../../src/main/teacher/beacon';
import { PORT } from '../../src/main/teacher/server';
import { SimClassroom, type SimStudent } from './sim';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  const value = i < 0 ? fallback : Number(args[i + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} needs a number above 0`);
  return value;
};
const chance = (p: number): boolean => Math.random() < p;
const between = (a: number, b: number): number => a + Math.random() * (b - a);
const SEC = 1000;

const root = await mkdtemp(join(tmpdir(), 'exammode-class-'));
const sim = await SimClassroom.open({
  students: flag('students', 30), minutes: flag('minutes', 10), speed: flag('speed', 1), port: flag('port', PORT), root,
  beacon: { port: BEACON_PORT, targets: broadcastAddresses() },
});
const { room, clock } = sim;
const clockTime = (): string => new Date(clock.now()).toTimeString().slice(0, 8);
const say = (text: string): void => console.log(`${clockTime()}  ${text}`);
const name = (id?: string): string => sim.students.find((s) => s.id === id)?.name ?? '';

// the log, as the teacher's live view would show it
let shown = 0;
const showLog = async (): Promise<void> => {
  const events = await sim.store.events(room.id);
  for (const e of events.slice(shown)) {
    if (!['joined', 'ready', 'started'].includes(e.kind)) say(`  ${e.kind.padEnd(16)} ${name(e.studentId ?? undefined).padEnd(18)} ${e.pc ?? ''}`);
  }
  shown = events.length;
};
const counts = (): string => {
  const by: Record<string, number> = {};
  for (const s of room.view().students) by[s.state] = (by[s.state] ?? 0) + 1;
  return Object.entries(by).map(([state, n]) => `${n} ${state}`).join(' · ');
};

/** One student's exam: work, and now and then something goes wrong. */
async function sits(s: SimStudent, minutes: number): Promise<void> {
  const end = room.view().run.endsAt!;
  for (let n = 1; clock.now() < end && s.session?.state !== 'handedIn'; n++) {
    await clock.wait(between(20, 60) * SEC);
    if (s.session?.state !== 'inExam') continue;
    await s.write('Report.docx', `${s.name}'s report, saved ${n} times`);
    if (chance(0.3)) await s.write(`code/task${n % 3}.py`, `print(${n})`);
    if (chance(0.03)) s.session.report('appClosed', { app: 'Chrome' });
    if (chance(0.04)) {
      s.unplug();
      await clock.wait(between(5, 60) * SEC);
      s.plug();
    } else if (chance(0.01)) {
      await s.kill();
      await clock.wait(15 * SEC);
      if (await s.join() === 'left') {
        await clock.wait(20 * SEC);
        await room.letBackIn(s.id, 'the simulated teacher is kind');
      }
    } else if (clock.now() > end - minutes * 20 * SEC && chance(0.2)) await s.handIn();
  }
}

say(`${sim.students.length} students · ${room.view().run.title} · the code is ${sim.code} · port ${sim.server.port}`);
await sim.everyoneReady();
say(`everyone is ready: ${counts()}`);
await room.start();
await sim.until(() => sim.students.every((s) => s.session?.state === 'inExam'));
const { minutes, endsAt } = room.view().run;
say(`started; it ends at ${new Date(endsAt!).toTimeString().slice(0, 8)}`);

const status = setInterval(() => void showLog().then(() => say(counts())), clock.ms(30 * SEC));
await Promise.all(sim.students.map((s) => sits(s, minutes)));
// time is up: whoever is still in the exam hands in by itself; give the last ones a moment
await sim.until(() => room.view().students.every((s) => s.state === 'handedIn' || s.state === 'left'), 60_000).catch(() => undefined);
clearInterval(status);
await showLog();
await room.end();

say(`the end: ${counts()}`);
for (const s of room.view().students) say(`  ${s.name.padEnd(18)} ${s.state.padEnd(9)} ${s.handedInHow ?? s.leftHow ?? ''} ${s.receipt ?? ''}`);
await sim.close();
if (args.includes('--keep')) say(`kept in ${root}`);
else await rm(root, { recursive: true, force: true });
