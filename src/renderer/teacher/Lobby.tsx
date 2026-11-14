import { CheckIcon, PlayIcon, UserIcon } from '@phosphor-icons/react';
import type { StudentView, TeacherApi, TeacherState } from '@lib/app/state';
import { formatClock, formatMinutes } from '@lib/session/time';
import { Pill } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ExamName, Section, TeacherBar } from './TeacherBar';

function State({ s }: { s: StudentView }) {
  if (s.state === 'ready') return <Pill tone="ok"><CheckIcon /> Ready</Pill>;
  if (s.state === 'checking') return <Pill tone="wait">Checking the computer…</Pill>;
  return <Pill tone="wait">Not joined yet</Pill>;
}

/** 12 · Students joining (F-36, F-37): the code for the board, who is ready, and Start. */
export function Lobby({ state, api }: { state: TeacherState; api: TeacherApi }) {
  const { run, students } = state;
  if (!run) return null;
  const ready = students.filter((s) => s.state === 'ready').length;
  const away = students.filter((s) => s.state === 'notJoined').length;
  // those who are here first, in the order they joined
  const listed = [...students].sort((a, b) => (a.joinedAt ?? Infinity) - (b.joinedAt ?? Infinity) || a.name.localeCompare(b.name));
  return (
    <div className="flex h-screen flex-col">
      <TeacherBar teacher={run.teacher}>
        <ExamName title={run.title} sub={`${run.className} · ${formatMinutes(run.minutes)} · not started`} />
        <Pill tone="wait">Students joining</Pill>
        <Button className="h-[42px] rounded-[9px] bg-ok px-5 text-[14px] hover:bg-ok/90" onClick={() => void api.start()}><PlayIcon weight="fill" className="size-3" /> Start the exam</Button>
      </TeacherBar>
      <div className="flex min-h-0 flex-1 gap-[22px] px-[26px] py-[22px]">
        <div className="flex w-[clamp(320px,30%,420px)] flex-col gap-3.5">
          <section className="rounded-xl border border-border bg-card px-[18px] py-6 text-center">
            <span className="text-[12px] font-semibold tracking-[.08em] text-muted-foreground uppercase">Exam code</span>
            <div aria-label={`Exam code ${run.code.split('').join(' ')}`} className="my-3 flex justify-center gap-2.5">
              {run.code.split('').map((digit, i) => <b key={i} className="grid h-[84px] w-[66px] place-items-center rounded-xl border border-input bg-background font-mono text-[44px] font-semibold">{digit}</b>)}
            </div>
            <p className="text-[12.5px] text-text-2">On each lab computer: open ExamMode, choose this exam, type the code.</p>
          </section>
          <Section title="Ready">
            <div className="flex items-baseline gap-2.5"><b className="text-[26px]">{ready}</b><span className="text-muted-foreground">of {students.length} students</span></div>
            <Progress value={students.length === 0 ? 0 : (ready / students.length) * 100} aria-label="Students ready" className="mt-2 h-2 bg-secondary [&>div]:bg-ok" />
            {away > 0 && <div className="mt-3 flex items-center gap-2 text-[12.5px] text-muted-foreground"><UserIcon className="size-3.5" /><span>{away === 1 ? '1 student' : `${away} students`} not here yet</span></div>}
          </Section>
        </div>
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center px-[18px] py-3.5"><h2 className="text-[15px] font-semibold">Students</h2></div>
          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead className="pl-[18px]">Student</TableHead><TableHead>Computer</TableHead><TableHead>Joined</TableHead><TableHead>State</TableHead></TableRow></TableHeader>
              <TableBody>
                {listed.map((s) => {
                  const here = s.state !== 'notJoined';
                  return (
                    <TableRow key={s.id} className={here ? '' : 'text-muted-foreground'}>
                      <TableCell className={`pl-[18px] ${here ? 'font-semibold' : ''}`}>{s.name}</TableCell>
                      <TableCell className="font-mono text-[12px]">{here ? s.pc : '—'}</TableCell>
                      <TableCell className="font-mono text-[12px]">{here && s.joinedAt ? formatClock(s.joinedAt) : '—'}</TableCell>
                      <TableCell><State s={s} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </div>
  );
}
