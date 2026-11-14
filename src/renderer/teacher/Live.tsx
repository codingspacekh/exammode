import { useEffect, useRef, useState } from 'react';
import { BellIcon, BellSlashIcon, CheckIcon, DoorOpenIcon, GlobeIcon, ListIcon, LockIcon, MagnifyingGlassIcon, PlayIcon, PlusIcon, SquaresFourIcon, StopIcon, WarningIcon, WifiSlashIcon } from '@phosphor-icons/react';
import type { FeedItem, StudentView, TeacherApi, TeacherState } from '@lib/app/state';
import { formatClock, formatLeft } from '@lib/session/time';
import { Pill, type Tone } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useNow } from '@/lib/remote';
import { cn } from '@/lib/utils';
import { feedLine } from './feed';
import { StudentPanel } from './StudentPanel';
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

function pillOf(s: StudentView) {
  return {
    ok: <Pill tone="ok">In the exam</Pill>,
    warn: <Pill tone="warn"><WarningIcon /> Warning</Pill>,
    lost: <Pill tone="lost"><WifiSlashIcon /> No contact</Pill>,
    left: <Pill tone="danger"><LockIcon /> Left</Pill>,
    done: <Pill tone="done"><CheckIcon /> Handed in</Pill>,
    wait: <Pill tone="wait">{s.state === 'notJoined' ? 'Not joined' : s.state === 'ready' ? 'Ready' : 'Checking…'}</Pill>,
  }[lookOf(s)];
}

function lineOf(s: StudentView): string {
  const files = s.files === 1 ? '1 file' : `${s.files} files`;
  return {
    ok: s.front ?? `${files} backed up`,
    warn: s.front ?? `${files} backed up`,
    lost: 'The computer can\'t be reached',
    left: `Left ${s.leftAt ? formatClock(s.leftAt) : ''}${s.asksBackFrom ? ' · asks to come back' : ''}`,
    done: `${s.handedInAt ? formatClock(s.handedInAt) : ''} · ${files} · ${s.receipt ?? ''}`,
    wait: s.state === 'notJoined' ? 'Not here' : 'Joining late',
  }[lookOf(s)];
}

const Flags = ({ s }: { s: StudentView }) => (s.warnings > 0
  ? <span aria-label={`${s.warnings} warnings`} className="ml-auto inline-flex items-center gap-[3px] font-semibold text-warn-ink"><WarningIcon className="size-3" /> {s.warnings}</span> : null);

/** A student's card: press it for their timeline (13b). */
function Card({ s, selected, onSelect }: { s: StudentView; selected: boolean; onSelect(): void }) {
  const look = lookOf(s);
  return (
    <button
      type="button" aria-label={s.name} aria-pressed={selected} data-look={look} onClick={onSelect}
      className={cn('relative flex flex-col gap-[7px] overflow-hidden rounded-[11px] border border-border bg-card px-3 pt-[11px] pb-2.5 text-left outline-none before:absolute before:inset-y-0 before:left-0 before:w-1 focus-visible:ring-[3px] focus-visible:ring-ring/30',
        CARD[look], selected && 'shadow-[0_0_0_2px_var(--primary)]')}
    >
      <span className="flex items-center gap-2"><b className="truncate text-[13px]">{s.name}</b><span className="ml-auto font-mono text-[11px] text-muted-foreground">{s.pc ?? ''}</span></span>
      <span className="flex items-center gap-1.5">{pillOf(s)}<Flags s={s} /></span>
      <span className="truncate text-[11.5px] text-muted-foreground">{lineOf(s)}</span>
    </button>
  );
}

const MARK: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-destructive', lost: 'bg-lost-soft text-lost', done: 'bg-done-soft text-primary', wait: 'bg-secondary text-text-2',
};
const ICON: Record<Tone, typeof CheckIcon> = { ok: PlayIcon, warn: WarningIcon, danger: DoorOpenIcon, lost: WifiSlashIcon, done: CheckIcon, wait: CheckIcon };

function Event({ item, onLook }: { item: FeedItem; onLook?: () => void }) {
  const line = feedLine(item);
  if (!line) return null;
  const Icon = item.kind === 'pageBlocked' ? GlobeIcon : item.kind === 'asksBack' ? LockIcon : ICON[line.tone];
  return (
    <li className="flex gap-2.5 px-[18px] py-[9px] text-[12.5px]">
      <span className={cn('grid size-[26px] flex-none place-items-center rounded-lg', MARK[line.tone])}><Icon className="size-3.5" /></span>
      <div><p className="text-text-2">{line.who && <b className="font-semibold text-foreground">{line.who} </b>}{line.text}</p><time className="mt-px block font-mono text-[11px] text-muted-foreground">{formatClock(item.at)}</time>{onLook && <Button size="xs" className="mt-1.5" onClick={onLook}>Look</Button>}</div>
    </li>
  );
}

type Filter = 'all' | 'needs' | Look;
const NEEDS: Look[] = ['warn', 'lost', 'left'];
const shows = (filter: Filter, look: Look): boolean => filter === 'all' || (filter === 'needs' ? NEEDS.includes(look) : filter === 'ok' ? look === 'ok' || look === 'warn' : filter === look);

/** A short sound for something that needs a look. */
function beep(): void {
  try {
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.25);
    tone.connect(gain).connect(audio.destination);
    tone.start();
    tone.stop(audio.currentTime + 0.25);
    tone.onended = () => void audio.close();
  } catch {
    // no sound on this computer
  }
}

/** 13 · The exam, live (F-38, F-39, F-41): a card per student by state, what's happening, more time, the end.
 *  13b: a student's card opens their timeline in the place of *What's happening*. */
export function Live({ state, api }: { state: TeacherState; api: TeacherApi }) {
  const now = useNow();
  const [asking, setAsking] = useState<'end' | 'time'>();
  const [filter, setFilter] = useState<Filter>('all');
  const [find, setFind] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<string>();
  const [sound, setSound] = useState(true);
  const newest = state.feed[0];
  const heard = useRef(newest?.id);
  useEffect(() => {
    if (newest === undefined || newest.id === heard.current) return;
    heard.current = newest.id;
    const tone = feedLine(newest)?.tone;
    if (sound && (tone === 'warn' || tone === 'danger')) beep();
  }, [newest, sound]);

  const { run, students } = state;
  if (!run || run.startedAt === undefined || run.endsAt === undefined) return null;
  const count = (look: Look) => students.filter((s) => lookOf(s) === look).length;
  const tiles: [string, string, number, Look][] = [
    ['In the exam', 'bg-ok', count('ok') + count('warn'), 'ok'], ['Warnings', 'bg-warn', count('warn'), 'warn'], ['No contact', 'bg-lost', count('lost'), 'lost'],
    ['Left', 'bg-destructive', count('left'), 'left'], ['Handed in', 'bg-done', count('done'), 'done'], ['Not joined', 'bg-input', count('wait'), 'wait'],
  ];
  const wanted = find.trim().toLowerCase();
  const listed = students.filter((s) => shows(filter, lookOf(s)) && (wanted === '' || s.name.toLowerCase().includes(wanted) || (s.pc ?? '').toLowerCase().includes(wanted)));
  const chosen = students.find((s) => s.id === selected);
  const select = (id: string) => setSelected(selected === id ? undefined : id);
  return (
    <div className="flex h-screen flex-col">
      <TeacherBar teacher={run.teacher}>
        <ExamName title={run.title} sub={`${run.className} · started ${formatClock(run.startedAt)} · ends ${formatClock(run.endsAt)}`} />
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-ok-soft px-2.5 text-[11.5px] font-semibold text-ok"><i className="size-[7px] rounded-full bg-ok shadow-[0_0_0_3px_rgba(25,135,84,.2)]" />Live</span>
        <span role="timer" className="font-mono text-[18px] font-semibold">{formatLeft(run.endsAt - now)}</span><span className="text-[12px] text-muted-foreground">left</span>
        {asking === 'end' && (
          <span role="alertdialog" aria-label="End the exam?" className="flex items-center gap-2">
            <span className="text-[12.5px] text-text-2">End it for everyone and collect their work?</span>
            <Button variant="outline" size="sm" onClick={() => setAsking(undefined)}>Keep going</Button>
            <Button variant="destructive" size="sm" onClick={() => { setAsking(undefined); void api.end(); }}>End the exam</Button>
          </span>
        )}
        {asking === 'time' && (
          <span role="group" aria-label="More time for everyone" className="flex items-center gap-2">
            <span className="text-[12.5px] text-text-2">More time for everyone:</span>
            {[5, 10, 15].map((m) => <Button key={m} variant="outline" size="sm" onClick={() => { setAsking(undefined); void api.addTime(m); }}><PlusIcon /> {m} min</Button>)}
            <Button variant="ghost" size="sm" onClick={() => setAsking(undefined)}>Cancel</Button>
          </span>
        )}
        {asking === undefined && (
          <>
            <Button variant="outline" onClick={() => setAsking('time')}><PlusIcon /> Add time</Button>
            <Button variant="outline" className="border-danger-line text-destructive hover:bg-danger-soft hover:text-destructive" onClick={() => setAsking('end')}><StopIcon weight="fill" className="size-3" /> End the exam…</Button>
          </>
        )}
      </TeacherBar>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden px-[26px] py-[22px]">
          <div role="group" aria-label="Students by state" className="grid grid-cols-6 gap-2.5">
            {tiles.map(([label, dot, n, look]) => (
              <button
                key={label} type="button" aria-pressed={filter === look} onClick={() => setFilter(filter === look ? 'all' : look)}
                className={cn('flex flex-col gap-0.5 rounded-[11px] border border-border bg-card px-3.5 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30', filter === look && 'border-primary shadow-[0_0_0_3px_rgba(59,79,216,.1)]')}
              >
                <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><i className={cn('size-2 rounded-full', dot)} />{label}</span>
                <b className="text-[24px] font-semibold">{n}</b>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2.5">
            <div className="relative w-[260px]">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" aria-label="Find a student or computer" placeholder="Find a student or computer" value={find} onChange={(e) => setFind(e.target.value)} className="h-[34px] bg-card pl-8" />
            </div>
            <ToggleGroup type="single" variant="outline" size="sm" value={filter === 'all' || filter === 'needs' || filter === 'done' ? filter : ''} onValueChange={(v) => setFilter((v || 'all') as Filter)} aria-label="Which students">
              <ToggleGroupItem value="all" className="px-3">Everyone · {students.length}</ToggleGroupItem>
              <ToggleGroupItem value="needs" className="px-3">Needs a look · {NEEDS.reduce((n, look) => n + count(look), 0)}</ToggleGroupItem>
              <ToggleGroupItem value="done" className="px-3">Handed in · {count('done')}</ToggleGroupItem>
            </ToggleGroup>
            <span className="flex-1" />
            <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && setView(v as 'grid' | 'list')} aria-label="Cards or a list">
              <ToggleGroupItem value="grid" aria-label="Cards"><SquaresFourIcon /></ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="A list"><ListIcon /></ToggleGroupItem>
            </ToggleGroup>
          </div>
          {view === 'grid' ? (
            <div role="group" aria-label="Students" className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(200px,1fr))] content-start gap-2.5 overflow-auto p-0.5">
              {listed.map((s) => <Card key={s.id} s={s} selected={s.id === selected} onSelect={() => select(s.id)} />)}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-card">
              <Table aria-label="Students">
                <TableHeader><TableRow><TableHead className="pl-[18px]">Student</TableHead><TableHead>Computer</TableHead><TableHead>State</TableHead><TableHead>Now</TableHead><TableHead>Warnings</TableHead></TableRow></TableHeader>
                <TableBody>
                  {listed.map((s) => (
                    <TableRow key={s.id} data-state={s.id === selected ? 'selected' : undefined} onClick={() => select(s.id)} className="cursor-pointer">
                      <TableCell className="pl-[18px] font-semibold">{s.name}</TableCell><TableCell className="font-mono text-[12px]">{s.pc ?? '—'}</TableCell>
                      <TableCell>{pillOf(s)}</TableCell><TableCell className="text-muted-foreground">{lineOf(s)}</TableCell><TableCell>{s.warnings > 0 ? <Flags s={s} /> : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {listed.length === 0 && <p className="text-[12.5px] text-muted-foreground">No student matches.</p>}
        </div>
        <aside className="flex min-h-0 w-[clamp(300px,24%,380px)] flex-col border-l border-border bg-card">
          {chosen ? (
            <StudentPanel key={chosen.id} student={chosen} run={run} events={state.events.filter((e) => e.studentId === chosen.id)} files={state.files[chosen.id] ?? []} api={api} onClose={() => setSelected(undefined)} />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-border px-[18px] pt-4 pb-2.5">
                <h2 className="text-[15px] font-semibold">What's happening</h2><span className="flex-1" />
                <Button variant="ghost" size="xs" aria-pressed={sound} onClick={() => setSound(!sound)} className="rounded-full bg-secondary text-text-2">{sound ? <BellIcon /> : <BellSlashIcon />} sound {sound ? 'on' : 'off'}</Button>
              </div>
              <ol aria-label="What's happening" className="min-h-0 flex-1 overflow-auto py-1.5">
                {state.feed.map((item) => <Event key={item.id} item={item} onLook={item.studentId && item.kind === 'asksBack' ? () => setSelected(item.studentId) : undefined} />)}
              </ol>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
