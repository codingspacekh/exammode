import { BellIcon, DesktopIcon, LockIcon } from '@phosphor-icons/react';
import type { StudentApi, StudentState } from '@lib/app/state';
import { formatClock } from '@lib/session/time';
import { Note } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Calm, Card, Facts } from './Calm';

/** 10 · Can't join again (F-18, F-20): refused on any computer; the teacher was told. If the teacher lets the
 *  student back in, the exam opens here by itself. */
export function CantJoin({ state, api }: { state: StudentState; api: StudentApi }) {
  const { exam, student, left } = state;
  if (!exam || !student) return null;
  const where = !left ? '' : left.pc === state.pc ? ' on this computer' : ` on ${left.pc}`;
  return (
    <Calm who={<><DesktopIcon /> {state.pc}</>}>
      <Card className="w-[min(560px,92%)] px-10 pt-9 pb-[30px] text-center">
        <div className="mx-auto mb-[18px] grid size-[68px] place-items-center rounded-[20px] bg-danger-soft text-destructive"><LockIcon className="size-10" /></div>
        <h1 className="mb-2 text-[22px] font-semibold tracking-[-0.01em]">You can't join this exam again</h1>
        <p className="text-[14px] text-text-2">You left <b>{exam.title}</b>.</p>
        <Facts rows={[
          ['Name', student.name],
          ...(left ? [
            ['Left at', `${formatClock(left.at - state.clockOffset)}${where}`] as [string, string],
            ['How', left.how === 'pressedLeave' ? 'You pressed Leave' : 'ExamMode stopped suddenly'] as [string, string],
            ['Your work', `Handed in as it was at ${formatClock(left.at - state.clockOffset)}`] as [string, string],
          ] : []),
        ]} />
        <Note tone="info" icon={<BellIcon />} className="mt-3">
          <b>{exam.teacher} has been told you'd like to come back.</b> If your computer crashed or switched off, tell them. If they let you back in, the exam opens here by itself.
        </Note>
        <div className="mt-5 flex flex-col items-center gap-2.5">
          <span role="status" className="inline-flex items-center gap-2 text-[13px] text-text-2"><i className="size-2 rounded-full bg-primary shadow-[0_0_0_4px_rgba(59,79,216,.18)]" />Waiting for {exam.teacher}…</span>
          <Button variant="ghost" onClick={() => void api.giveUp()}>Close</Button>
        </div>
      </Card>
    </Calm>
  );
}
