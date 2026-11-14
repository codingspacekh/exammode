import { DoorOpenIcon, ExamIcon, HourglassIcon, UserIcon } from '@phosphor-icons/react';
import type { StudentState } from '@lib/app/state';
import { formatMinutes } from '@lib/session/time';
import { Note } from '@/components/brand';
import { Calm, Card } from './Calm';

/** 03 · Waiting for the teacher (F-08). M3: the computer isn't locked yet (F-07 comes with M4). */
export function Waiting({ state }: { state: StudentState }) {
  const { exam, student } = state;
  if (!exam || !student) return null;
  const facts: [string, string][] = [['Time', formatMinutes(exam.minutes)], ['Your name', student.name], ['This computer', state.pc]];
  return (
    <Calm who={<><UserIcon /> {student.name} · {state.pc}</>}>
      <Card className="w-[min(620px,92%)] px-10 pt-10 pb-[34px] text-center">
        <div className="mx-auto mb-[18px] grid size-16 place-items-center rounded-[18px] bg-accent text-primary"><HourglassIcon className="size-8" /></div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">You're in. Waiting for {exam.teacher} to start.</h1>
        <p className="mt-1.5 text-[14px] text-muted-foreground">{exam.title}</p>
        <dl className="my-6 mb-5 grid grid-cols-3 gap-2.5 text-left">
          {facts.map(([label, value]) => (
            <div key={label} className="rounded-[10px] bg-background px-3.5 py-3">
              <dt className="mb-0.5 text-[11.5px] text-muted-foreground">{label}</dt>
              <dd className="truncate text-[14px] font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        {exam.hasQuestions ? (
          <>
            <p className="text-[12px] text-muted-foreground">In this exam you can use</p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <span className="inline-flex h-[30px] items-center gap-[7px] rounded-lg border border-border bg-card pr-[11px] pl-1.5 text-[12.5px] font-medium">
                <span className="grid size-5 place-items-center rounded-[5px] bg-primary text-white"><ExamIcon className="size-3" /></span>The questions
              </span>
            </div>
          </>
        ) : <p className="text-[12px] text-muted-foreground">The questions are on paper.</p>}
        <Note tone="danger" icon={<DoorOpenIcon />} className="mt-5">
          <b>If you leave the exam, you can't come back in</b> — not on this computer and not on another one. Closing ExamMode counts as leaving.
        </Note>
        <div className="mt-[22px]">
          <span role="status" className="inline-flex items-center gap-2 text-[13px] text-text-2">
            <i className="size-2 rounded-full bg-primary shadow-[0_0_0_4px_rgba(59,79,216,.18)]" />Waiting for the teacher
          </span>
        </div>
      </Card>
    </Calm>
  );
}
