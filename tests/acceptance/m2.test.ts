import { afterEach, describe, expect, it } from 'vitest';
import { SimClassroom, type SimOptions } from '../../scripts/class/sim';
import { fortyStudents } from '../../scripts/class/stories/forty';
import { everyoneHandsIn } from '../../scripts/class/stories/hand-in';
import { killedAndLetBackIn } from '../../scripts/class/stories/killed';
import { networkDrops } from '../../scripts/class/stories/network';
import { crashInTheLobby, wrongCodeAndNameTaken } from '../../scripts/class/stories/refused';
import { timeIsUp } from '../../scripts/class/stories/time-up';

/** M2's stories (MILESTONES §6): the simulated classroom against the real teacher's side, over real sockets. */
let open: SimClassroom | undefined;
async function classroom(options: SimOptions): Promise<SimClassroom> {
  open = await SimClassroom.open(options);
  return open;
}
afterEach(async () => {
  await open?.close();
  open = undefined;
});

const RECEIPT = /^[2-9A-Z]{3}-[2-9A-Z]{3}$/;

describe('M2 the classroom network', () => {
  it('30 students join, start and hand in: 30 receipts, 30 folders, the log complete', async () => {
    const story = await everyoneHandsIn(await classroom({ students: 30, speed: 10 }));
    expect(story.receipts).toHaveLength(30);
    for (const code of story.receipts) expect(code).toMatch(RECEIPT);
    expect(new Set(story.receipts).size).toBe(30);
    expect(story.onTheList).toEqual(story.receipts);
    expect(story.states).toEqual(Array(30).fill('handedIn'));
    expect(story.folders).toEqual(Array(30).fill(true));
    for (const log of story.logs) expect(log).toEqual(['joined', 'ready', 'started', 'handedIn']);
    expect(story.cleaned).toBe(true);
  });

  it('F-18 F-20 a student kills ExamMode: left (stopped suddenly); joins from another PC: refused; let back in: accepted', async () => {
    const story = await killedAndLetBackIn(await classroom({ students: 6, speed: 20 }));
    expect(story.afterKill).toMatchObject({ state: 'left', leftHow: 'stoppedSuddenly', connected: false });
    expect(story.reply).toBe('left');
    expect(story.whileWaiting).toMatchObject({ state: 'left', asksBackFrom: 'PC-30', session: 'waiting' });
    expect(story.back).toMatchObject({ state: 'handedIn', pc: 'PC-30', handedInHow: 'handIn' });
    expect(story.receipt?.code).toMatch(RECEIPT);
    expect(story.log).toEqual(['joined', 'ready', 'started', 'stoppedSuddenly', 'asksBack', 'letBackIn', 'cameBack', 'handedIn']);
    expect(story.others).toEqual(Array(5).fill('inExam'));
  });

  it('F-19 the network drops for 45 s: no contact, then in the exam with a gap; nothing lost', async () => {
    const story = await networkDrops(await classroom({ students: 6, speed: 20 }));
    expect(story.during).toEqual({ teacher: 'noContact', student: 'noContact' });
    expect(story.after).toMatchObject({ state: 'inExam', warnings: 0 });
    expect(story.log).toEqual(['joined', 'ready', 'started', 'noContact', 'gap']);
    expect(story.gap.seconds).toBeGreaterThanOrEqual(40);
    expect(story.gap.seconds).toBeLessThan(70);
    expect(story.gap.localLog.map((e) => e.kind)).toEqual(['contactLost']);
    expect(story.handedIn).toBe('written with no network');
    expect(story.receipt?.code).toMatch(RECEIPT);
    expect(story.others).toEqual(Array(5).fill('inExam'));
  });

  it('F-17 time up: every student handed in, marked time up', async () => {
    const story = await timeIsUp(await classroom({ students: 12, minutes: 1, speed: 20 }));
    for (const s of story.students) expect(s).toMatchObject({ state: 'handedIn', handedInHow: 'timeUp', receipt: expect.stringMatching(RECEIPT) });
    expect(story.work).toEqual(Array(12).fill(true));
    expect(story.receipts).toEqual(story.students.map((s) => s.receipt));
  });

  it('F-02 F-03 a wrong code and a name already taken are refused', async () => {
    const story = await wrongCodeAndNameTaken(await classroom({ students: 2 }));
    expect(story).toMatchObject({ wrongCode: 'codeWrong', rightCode: 'joined', nameTaken: 'nameTaken', ownName: 'joined' });
    expect(story.first).toMatchObject({ state: 'checking', pc: 'PC-01', connected: true });
    expect(story.log).toEqual(['runOpened', 'codeWrong', 'joined', 'nameTaken', 'joined']);
  });

  it('F-18 ExamMode crashes in the lobby before Start: the student joins again normally', async () => {
    const story = await crashInTheLobby(await classroom({ students: 3, speed: 20 }));
    expect(story).toEqual({ reply: 'joined', state: 'inExam', log: ['joined', 'ready', 'leftBeforeStart', 'joined', 'ready', 'started'] });
  });

  it('N-03 40 students on the teacher\'s laptop: every change is seen within 2 s', async () => {
    const story = await fortyStudents(await classroom({ students: 40 }));
    expect(story.students).toBe(40);
    expect(story.states).toEqual(Array(40).fill('handedIn'));
    console.log(`N-03 with 40 students — slowest, in ms: ${JSON.stringify(story.ms)}`);
    for (const ms of Object.values(story.ms)) expect(ms).toBeLessThan(2000);
  });
});
