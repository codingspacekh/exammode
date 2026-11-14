import { useState } from 'react';
import { BellIcon, CheckIcon, DoorOpenIcon, FolderIcon, GlobeIcon, LockIcon, PlayIcon, StopIcon, WarningIcon, WifiSlashIcon } from '@phosphor-icons/react';
import type { FeedItem, StudentView, TeacherApi, TeacherState } from '@lib/app/state';
import { formatClock, formatLeft } from '@lib/session/time';
import { Pill, type Tone } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { useNow } from '@/lib/remote';
import { cn } from '@/lib/utils';
import { feedLine } from './feed';
import { ExamName, TeacherBar } from './TeacherBar';

type Look = 'ok' | 'warn' | 'lost' | 'left' | 'done' | 'wait';

/** One of the five states, by colour (13): a warning is a student in the exam with an app that was closed. */
export function lookOf(s: StudentView): Look {
  switch (s.state) {
    case 'inExam': return s.warnings > 0 ? 'warn' : 'ok';
    case 'noContact': return 'lost';
    case 'left': return 'left';
    case 'handedIn': return 'done';
    default: return 'wait';
  }
}

const CARD: Record<Look, string> = {
  ok: 'before:bg-ok',
  warn: 'border-warn-line bg-[#fffdf7] before:bg-warn',
  lost: 'border-dashed border-lost-line before:bg-lost',
  left: 'border-danger-line bg-[#fffafa] before:bg-destructive',
  done: 'before:bg-done',
  wait: 'before:bg-input',
};

function Card({ s }: { s: StudentView }) {
  const look = lookOf(s);
  const pill = {
    ok: <Pill tone="ok">In the exam</Pill>,
    warn: <Pill tone="warn"><WarningIcon /> Warning</Pill>,
    lost: <Pill tone="lost"><WifiSlashIcon /> No contact</Pill>,
    left: <Pill tone="danger"><LockIcon /> Left</Pill>,
    done: <Pill tone="done"><CheckIcon /> Handed in</Pill>,
    wait: <Pill tone="wait">{s.state === 'notJoined' ? 'Not joined' : s.state === 'ready' ? 'Ready' : 'Checking…'}</Pill>,
  }[look];
  const files = s.files === 1 ? '1 file' : `${s.files} files`;
  const line = {
    ok: s.front ?? `${files} backed up`,
    warn: s.front ?? `${files} backed up`,
    lost: 'The computer can\'t be reached',
    left: `Left ${s.leftAt ? formatClock(s.leftAt) : ''}${s.asksBackFrom ? ' · asks to come back' : ''}`,
    done: `${s.handedInAt ? formatClock(s.handedInAt) : ''} · ${files} · ${s.receipt ?? ''}`,
    wait: s.state === 'notJoined' ? 'Not here' : 'Joining late',
  }[look];
  return (
    <article aria-label={s.name} data-look={look} className={cn('relative flex flex-col gap-[7px] overflow-hidden rounded-[11px] border border-border bg-card px-3 pt-[11px] pb-2.5 before:absolute before:inset-y-0 before:left-0 before:w-1', CARD[look])}>
      <div className="flex items-center gap-2"><b className="truncate text-[13px]">{s.name}</b><span className="ml-auto font-mono text-[11px] text-muted-foreground">{s.pc ?? ''}</span></div>
      <div className="flex items-center gap-1.5">
        {pill}
        {s.warnings > 0 && <span aria-label={`${s.warnings} warnings`} className="ml-auto inline-flex items-center gap-[3px] font-semibold text-warn-ink"><WarningIcon className="size-3" /> {s.warnings}</span>}
      </div>
      <div className="truncate text-[11.5px] text-muted-foreground">{line}</div>
    </article>
  );
}

const MARK: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-destructive', lost: 'bg-lost-soft text-lost', done: 'bg-done-soft text-primary', wait: 'bg-secondary text-text-2',
};
const ICON: Record<Tone, typeof CheckIcon> = { ok: PlayIcon, warn: WarningIcon, danger: DoorOpenIcon, lost: WifiSlashIcon, done: CheckIcon, wait: CheckIcon };

function Event({ item }: { item: FeedItem }) {
  const line = feedLine(item);
  if (!line) return null;
  const Icon = item.kind === 'pageBlocked' ? GlobeIcon : item.kind === 'asksBack' ? LockIcon : ICON[line.tone];
  return (
    <li className="flex gap-2.5 px-[18px] py-[9px] text-[12.5px]">
      <span className={cn('grid size-[26px] flex-none place-items-center rounded-lg', MARK[line.tone])}><Icon className="size-3.5" /></span>
      <div><p className="text-text-2">{line.who && <b className="font-semibold text-foreground">{line.who} </b>}{line.text}</p><time className="mt-px block font-mono text-[11px] text-muted-foreground">{formatClock(item.at)}</time></div>
    </li>
  );
}

/** 13 · The exam, live (F-38, F-39, F-41): a card per student by state, what's happening, and the end. */
export function Live({ state, api }: { state: TeacherState; api: TeacherApi }) {
  const now = useNow();
  const [asking, setAsking] = useState(false);
  const { run, students } = state;
  if (!run || run.startedAt === undefined || run.endsAt === undefined) return null;
  const ended = run.endedAt !== undefined;
  const count = (look: Look) => students.filter((s) => lookOf(s) === look).length;
  const tiles: [string, string, number][] = [
    ['In the exam', 'bg-ok', count('ok') + count('warn')], ['Warnings', 'bg-warn', count('warn')], ['No contact', 'bg-lost', count('lost')],
    ['Left', 'bg-destructive', count('left')], ['Handed in', 'bg-done', count('done')], ['Not joined', 'bg-input', count('wait')],
  ];
  return (
    <div className="flex h-screen flex-col">
      <TeacherBar teacher={run.teacher}>
        <ExamName title={run.title} sub={`${run.className} · started ${formatClock(run.startedAt)} · ${ended ? `ended ${formatClock(run.endedAt!)}` : `ends ${formatClock(run.endsAt)}`}`} />
        {ended ? (
          <>
            <Pill tone="done"><CheckIcon /> Ended {formatClock(run.endedAt!)}</Pill>
            <Button variant="outline" onClick={() => void api.openFolder()}><FolderIcon /> Open the hand-in folder</Button>
            <Button onClick={() => void api.done()}>Done</Button>
          </>
        ) : (
          <>
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-ok-soft px-2.5 text-[11.5px] font-semibold text-ok"><i className="size-[7px] rounded-full bg-ok shadow-[0_0_0_3px_rgba(25,135,84,.2)]" />Live</span>
            <span role="timer" className="font-mono text-[18px] font-semibold">{formatLeft(run.endsAt - now)}</span><span className="text-[12px] text-muted-foreground">left</span>
            {asking ? (
              <span role="alertdialog" aria-label="End the exam?" className="flex items-center gap-2">
                <span className="text-[12.5px] text-text-2">End it for everyone and collect their work?</span>
                <Button variant="outline" size="sm" onClick={() => setAsking(false)}>Keep going</Button>
                <Button variant="destructive" size="sm" onClick={() => { setAsking(false); void api.end(); }}>End the exam</Button>
              </span>
            ) : (
              <Button variant="outline" className="border-danger-line text-destructive hover:bg-danger-soft hover:text-destructive" onClick={() => setAsking(true)}><StopIcon weight="fill" className="size-3" /> End the exam…</Button>
            )}
          </>
        )}
      </TeacherBar>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden px-[26px] py-[22px]">
          <dl className="grid grid-cols-6 gap-2.5">
            {tiles.map(([label, dot, n]) => (
              <div key={label} className="flex flex-col gap-0.5 rounded-[11px] border border-border bg-card px-3.5 py-3">
                <dt className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><i className={cn('size-2 rounded-full', dot)} />{label}</dt>
                <dd className="text-[24px] font-semibold">{n}</dd>
              </div>
            ))}
          </dl>
          <div aria-label="Students" className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(200px,1fr))] content-start gap-2.5 overflow-auto">
            {students.map((s) => <Card key={s.id} s={s} />)}
          </div>
        </div>
        <aside className="flex min-h-0 w-[clamp(300px,24%,380px)] flex-col border-l border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-[18px] pt-4 pb-2.5"><h2 className="text-[15px] font-semibold">What's happening</h2><span className="flex-1" /><BellIcon className="size-3.5 text-muted-foreground" /></div>
          <ol aria-label="What's happening" className="min-h-0 flex-1 overflow-auto py-1.5">{state.feed.map((item) => <Event key={item.id} item={item} />)}</ol>
        </aside>
      </div>
    </div>
  );
}
