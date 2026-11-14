import { CheckCircleIcon, UserIcon } from '@phosphor-icons/react';
import type { StudentApi, StudentState } from '@lib/app/state';
import { formatClock } from '@lib/session/time';
import { size } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Calm, Card, Facts } from './Calm';

/** 09b · Handed in (F-16, F-17): the receipt, with the code that is also on the teacher's list. */
export function HandedIn({ state, api }: { state: StudentState; api: StudentApi }) {
  const { exam, student, receipt } = state;
  if (!exam || !student || !receipt) return null;
  const bytes = receipt.files.reduce((sum, f) => sum + f.bytes, 0);
  const files = receipt.files.length === 0 ? 'No files' : `${receipt.files.map((f) => f.name).join(', ')} · ${size(bytes)}`;
  return (
    <Calm who={<><UserIcon /> {student.name} · {state.pc}</>}>
      <Card className="w-[min(560px,92%)] px-10 pt-9 pb-[30px] text-center">
        <div className="mx-auto mb-[18px] grid size-[68px] place-items-center rounded-[20px] bg-ok-soft text-ok"><CheckCircleIcon className="size-10" /></div>
        <h1 className="mb-2 text-[22px] font-semibold tracking-[-0.01em]">Handed in</h1>
        <p className="text-[14px] text-text-2">{exam.teacher} has your work. You can't change it now.</p>
        <Facts rows={[
          ['Exam', exam.title],
          ['Name', student.name],
          ['Handed in', `${formatClock(receipt.at)}${receipt.byItself ? ', by itself when the exam ended' : ''}`],
          ['Files', files],
          ['Receipt', <span key="code" className="font-mono">{receipt.code}</span>],
        ]} />
        <div className="mt-5 flex flex-col items-center gap-2.5">
          <Button size="lg" className="h-[42px] rounded-[9px] px-5 text-[14px]" onClick={() => void api.finish()}>Finish</Button>
          <span className="text-[12px] text-muted-foreground">This computer goes back to normal.</span>
        </div>
      </Card>
    </Calm>
  );
}
