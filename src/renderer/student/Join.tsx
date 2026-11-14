import { useEffect, useState } from 'react';
import { ArrowRightIcon, DesktopIcon, ExamIcon, InfoIcon, WarningIcon } from '@phosphor-icons/react';
import type { JoinError, StudentApi, StudentState } from '@lib/app/state';
import { formatMinutes } from '@lib/session/time';
import { Note } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Calm, Card } from './Calm';

const WHY: Record<JoinError, string> = {
  codeWrong: 'That isn\'t the code on the board. Look again and type it once more.',
  nameTaken: 'That name is already in this exam on another computer. Pick your own name, or tell your teacher.',
  notInClass: 'That name isn\'t in this exam\'s class. Tell your teacher.',
  left: 'You left this exam, so you can\'t join it again. Tell your teacher.',
  keptOut: 'Your teacher has kept you out of this exam.',
  handedIn: 'You have already handed in for this exam.',
  notJoined: 'That didn\'t work. Try once more.',
  ended: 'This exam has ended.',
  update: 'This ExamMode isn\'t the same version as your teacher\'s. Tell your teacher.',
  unreachable: 'That computer can\'t be reached. Check the name with your teacher and try again.',
};

/** 01 · Join an exam (F-01, F-02, F-03): the exams found on the classroom network, your name from the class list,
 *  the code on the board. */
export function Join({ state, api }: { state: StudentState; api: StudentApi }) {
  const [studentId, setStudentId] = useState('');
  const [code, setCode] = useState('');
  const [typing, setTyping] = useState(false);
  const [host, setHost] = useState('');
  // a wrong code is typed again from the start
  useEffect(() => {
    if (state.joinError === 'codeWrong') setCode('');
  }, [state.joinError, state.joining]);
  const name = state.names.some((n) => n.id === studentId) ? studentId : '';
  const ready = state.picked !== undefined && name !== '' && /^\d{4}$/.test(code) && !state.joining;

  return (
    <Calm who={<><DesktopIcon /> {state.pc}</>}>
      <Card className="w-[min(560px,92%)] px-9 pt-8 pb-[30px]">
        <form onSubmit={(e) => { e.preventDefault(); if (ready) void api.join(name, code); }}>
          <h1 className="mb-1 text-[22px] font-semibold tracking-[-0.01em]">Join your exam</h1>
          <p className="mb-[22px] text-[14px] text-text-2">
            {state.found.length > 0 ? 'These exams are open on the classroom network.' : 'Looking for exams on the classroom network…'}
          </p>

          <div role="radiogroup" aria-label="Exams" className="mb-[18px] flex flex-col gap-2">
            {state.found.map((exam) => {
              const on = exam.runId === state.picked;
              return (
                <button
                  key={exam.runId} type="button" role="radio" aria-checked={on} onClick={() => void api.pick(exam.runId)}
                  className={cn('flex items-center gap-3 rounded-[10px] border border-input px-3.5 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30',
                    on && 'border-primary bg-accent shadow-[0_0_0_3px_rgba(59,79,216,.12)]')}
                >
                  <span className={cn('grid size-[38px] flex-none place-items-center rounded-[9px] bg-secondary text-text-2', on && 'bg-primary text-white')}><ExamIcon className="size-5" /></span>
                  <span className="min-w-0">
                    <b className="block truncate text-[14px]">{exam.title}</b>
                    <span className="text-[12px] text-muted-foreground">{[exam.teacher, exam.class, exam.minutes ? formatMinutes(exam.minutes) : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className={cn('relative ml-auto size-[18px] flex-none rounded-full border-[1.5px] border-input bg-card', on && 'border-primary after:absolute after:inset-[3.5px] after:rounded-full after:bg-primary')} />
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-[1.3fr_1fr] items-end gap-x-3.5 gap-y-3">
            <div>
              <Label htmlFor="name" className="mb-[5px] text-[12px] font-semibold text-text-2">Your name</Label>
              <Select value={name} onValueChange={setStudentId} disabled={state.names.length === 0}>
                <SelectTrigger id="name" className="h-9 w-full"><SelectValue placeholder={state.picked ? 'Pick your name' : 'Choose your exam first'} /></SelectTrigger>
                <SelectContent>
                  {state.names.map((n) => <SelectItem key={n.id} value={n.id}>{n.name}{n.email ? <span className="text-muted-foreground"> · {n.email}</span> : null}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="code" className="mb-[5px] text-[12px] font-semibold text-text-2">Exam code (on the board)</Label>
              <InputOTP id="code" maxLength={4} inputMode="numeric" pattern="^\d*$" value={code} onChange={setCode} aria-label="Exam code">
                <InputOTPGroup className="gap-2">
                  {[0, 1, 2, 3].map((i) => <InputOTPSlot key={i} index={i} className="h-[54px] w-[46px] rounded-[9px] border border-input font-mono text-[24px] font-semibold first:rounded-l-[9px] last:rounded-r-[9px]" />)}
                </InputOTPGroup>
              </InputOTP>
            </div>
          </div>

          {state.joinError && <Note tone="danger" icon={<WarningIcon />} className="mt-4">{WHY[state.joinError]}</Note>}

          {typing && (
            <div className="mt-4 flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="host" className="mb-[5px] text-[12px] font-semibold text-text-2">Your teacher's computer name</Label>
                <Input id="host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="Your teacher will tell you" className="h-9" />
              </div>
              <Button type="button" variant="outline" disabled={host.trim() === ''} onClick={() => void api.lookAt(host)}>Look there</Button>
            </div>
          )}

          <div className="mt-6 flex items-center gap-3">
            <div className="flex items-start gap-2 text-[12px] text-muted-foreground">
              <InfoIcon className="mt-px size-3.5 flex-none" />
              <span>
                Can't see your exam? Ask your teacher to open it{typing ? '.' : <>, or <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setTyping(true)}>type your teacher's computer name</button>.</>}
                {' '}Not on the list? Your teacher can add you.
              </span>
            </div>
            <span className="flex-1" />
            <Button type="submit" size="lg" disabled={!ready} className="h-[42px] rounded-[9px] px-5 text-[14px]">{state.joining ? 'Joining…' : 'Join'} <ArrowRightIcon /></Button>
          </div>
        </form>
      </Card>
    </Calm>
  );
}
