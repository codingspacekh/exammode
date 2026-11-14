import { useState } from 'react';
import { CheckIcon, FolderIcon, LockIcon, LockOpenIcon, PlusIcon, WarningIcon, WifiSlashIcon, XIcon } from '@phosphor-icons/react';
import type { FeedItem, KeptFile, RunView, StudentView, TeacherApi } from '@lib/app/state';
import { formatClock } from '@lib/session/time';
import { Pill, type Tone } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { timelineLine } from './feed';

const REASONS = ['The computer crashed', 'The power or the network went', 'Pressed Leave by mistake', 'Closed ExamMode by mistake'];
const OTHER = 'Another reason…';
export const initials = (name: string): string => name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();

const MARK: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-destructive', lost: 'bg-lost-soft text-lost', done: 'bg-done-soft text-primary', wait: 'bg-secondary text-text-2',
};
const ICON: Record<Tone, typeof CheckIcon> = { ok: CheckIcon, warn: WarningIcon, danger: LockIcon, lost: WifiSlashIcon, done: CheckIcon, wait: CheckIcon };

/** 13b · One student (F-18, F-20, F-40): their timeline, and — if they left — Let back in or Keep out with a
 *  reason for the log. More time for this student alone (F-41). */
export function StudentPanel({ student: s, run, events, files, api, onClose }: { student: StudentView; run: RunView; events: FeedItem[]; files: KeptFile[]; api: TeacherApi; onClose(): void }) {
  const [reason, setReason] = useState(REASONS[0]!);
  const [other, setOther] = useState('');
  const why = reason === OTHER ? other.trim() : reason;
  const first = s.name.split(' ')[0];
  const pill = s.state === 'left' ? <Pill tone="danger"><LockIcon /> Left</Pill>
    : s.state === 'handedIn' ? <Pill tone="done"><CheckIcon /> Handed in</Pill>
      : s.state === 'noContact' ? <Pill tone="lost"><WifiSlashIcon /> No contact</Pill>
        : s.state === 'inExam' ? <Pill tone={s.warnings > 0 ? 'warn' : 'ok'}>{s.warnings > 0 ? 'Warning' : 'In the exam'}</Pill>
          : <Pill tone="wait">{s.state === 'notJoined' ? 'Not joined' : 'Joining'}</Pill>;
  const until = s.leftAt ?? s.handedInAt;
  const facts: [string, string][] = [
    ['Computer', s.asksBackFrom && s.asksBackFrom !== s.pc ? `${s.pc} → ${s.asksBackFrom}` : s.pc ?? '—'],
    ['In the exam', run.startedAt === undefined || s.joinedAt === undefined ? '—' : `${formatClock(Math.max(run.startedAt, s.joinedAt))} – ${until ? formatClock(until) : 'now'}`],
    ['Warnings', String(s.warnings)],
    ['Files collected', files.length === 0 ? 'None yet' : String(files.length)],
  ];
  const out = s.leftAt === undefined ? 0 : Math.max(1, Math.round((Date.now() - s.leftAt) / 60_000));
  return (
    <section aria-label={s.name} className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-5 pt-[18px] pb-3.5">
        <div className="flex items-center gap-2.5">
          <span className={cn('grid size-[30px] flex-none place-items-center rounded-full bg-accent text-[11.5px] font-bold text-accent-foreground', s.state === 'left' && 'bg-danger-soft text-danger-ink')}>{initials(s.name)}</span>
          <div className="min-w-0"><b className="block truncate text-[16px]">{s.name}</b><div className="text-[12px] text-muted-foreground">{run.className}</div></div>
          <span className="flex-1" />
          {pill}
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}><XIcon /></Button>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2">
          {facts.map(([label, value]) => <div key={label} className="rounded-lg bg-background px-2.5 py-2"><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="truncate text-[13px] font-semibold">{value}</dd></div>)}
        </dl>
      </div>
      <ol aria-label="Timeline" className="min-h-0 flex-1 overflow-auto px-5 py-3">
        {events.map((item, i) => {
          const line = timelineLine(item);
          const Icon = ICON[line.tone];
          return (
            <li key={item.id} className="relative flex gap-3 pb-3.5">
              {i < events.length - 1 && <span className="absolute top-[26px] bottom-0 left-3 w-[1.5px] bg-border" />}
              <span className={cn('grid size-[26px] flex-none place-items-center rounded-full', MARK[line.tone])}><Icon className="size-3" /></span>
              <div><b className="block text-[12.5px] font-semibold">{line.title}</b>{line.detail && <p className="text-[12px] text-text-2">{line.detail}</p>}<time className="font-mono text-[11px] text-muted-foreground">{formatClock(item.at)}</time></div>
            </li>
          );
        })}
        {events.length === 0 && <li className="text-[12.5px] text-muted-foreground">Nothing has happened yet.</li>}
      </ol>
      <div className="flex flex-col gap-2 border-t border-border px-5 pt-3.5 pb-[18px]">
        {s.state === 'left' && run.endedAt === undefined && (
          <>
            <div>
              <Label htmlFor="reason" className="mb-[5px] text-[12px] font-semibold text-text-2">Reason (for the log)</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="reason" className="h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{[...REASONS, OTHER].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
              {reason === OTHER && <Input aria-label="The reason" value={other} onChange={(e) => setOther(e.target.value)} placeholder="In a few words" className="mt-2 h-9" />}
            </div>
            <div className="flex gap-2.5">
              <Button variant="outline" className="flex-1" disabled={why === ''} onClick={() => void api.keepOut(s.id, why)}>Keep out</Button>
              <Button className="flex-[1.4]" disabled={why === ''} onClick={() => void api.letBackIn(s.id, why)}><LockOpenIcon /> Let back in</Button>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {s.asksBackFrom
                ? `The exam opens on ${s.asksBackFrom} by itself, with ${first}'s files. Time out of the exam: ${out} min.`
                : `${first} hasn't asked to come back yet. If you let them back in now, their next join is accepted.`}
            </span>
          </>
        )}
        {(s.state === 'inExam' || s.state === 'noContact') && run.endedAt === undefined && (
          <div role="group" aria-label={`More time for ${s.name}`} className="flex items-center gap-2">
            <span className="text-[12px] text-text-2">More time for {first}:</span>
            {[5, 10, 15].map((m) => <Button key={m} variant="outline" size="sm" onClick={() => void api.addTime(m, s.id)}><PlusIcon /> {m} min</Button>)}
          </div>
        )}
        {s.receipt && <span className="text-[12px] text-text-2">Receipt <b className="font-mono">{s.receipt}</b></span>}
        <Button variant="ghost" size="sm" className="self-start" onClick={() => void api.openFolder(s.id)}><FolderIcon /> Open {first}'s folder</Button>
      </div>
    </section>
  );
}
