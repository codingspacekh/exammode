import { useState } from 'react';
import { CheckIcon, ClockIcon, FileCsvIcon, FileIcon, FolderIcon, LockIcon, MagnifyingGlassIcon, WarningIcon } from '@phosphor-icons/react';
import type { KeptFile, StudentView, TeacherApi, TeacherState } from '@lib/app/state';
import { formatClock } from '@lib/session/time';
import { Pill, size } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { ExamName, TeacherBar } from './TeacherBar';

/** How a student's exam ended, for the list: the pill, when, and how in words. */
export function outcome(s: StudentView, kept: number): { kind: 'handedIn' | 'byClock' | 'left' | 'none'; pill: React.ReactNode; at?: number; how: string } {
  if (s.state === 'handedIn' && s.handedInHow === 'handIn') return { kind: 'handedIn', pill: <Pill tone="done"><CheckIcon /> Handed in</Pill>, at: s.handedInAt, how: 'Pressed Hand in' };
  if (s.state === 'handedIn') return { kind: 'byClock', pill: <Pill tone="wait"><ClockIcon /> {s.handedInHow === 'timeUp' ? 'Time up' : 'Ended'}</Pill>, at: s.handedInAt, how: s.handedInHow === 'timeUp' ? 'Handed in by itself' : 'Handed in when you ended the exam' };
  if (s.state === 'left') return { kind: 'left', pill: <Pill tone="danger"><LockIcon /> Left{s.leftAt ? ` ${formatClock(s.leftAt)}` : ''}</Pill>, at: s.leftAt, how: s.leftAt ? `Files up to ${formatClock(s.leftAt)}` : 'Files up to then' };
  if (s.state === 'inExam' || s.state === 'noContact') return { kind: 'none', pill: <Pill tone="lost">No hand-in</Pill>, how: kept > 0 ? 'No contact at the end — the latest backup' : 'No contact at the end — nothing received' };
  return { kind: 'none', pill: <Pill tone="wait">Didn't join</Pill>, how: '—' };
}

/** 14 · After the exam (F-17, F-42): every hand-in, how and when, the warnings, and the log as a spreadsheet. */
export function After({ state, api }: { state: TeacherState; api: TeacherApi }) {
  const [find, setFind] = useState('');
  const [saved, setSaved] = useState<string>();
  const { run, students } = state;
  if (!run || run.endedAt === undefined) return null;
  const files = (s: StudentView): KeptFile[] => {
    const kept = state.files[s.id] ?? [];
    // a hand-in is what was handed in; the earlier backups it replaced are kept apart
    return s.state === 'handedIn' ? kept.filter((f) => f.kind !== 'backup') : kept;
  };
  const rows = students.map((s) => ({ s, kept: files(s), ...outcome(s, files(s).length) }));
  const all = rows.flatMap((r) => r.kept);
  const tiles: [string, string, number][] = [
    ['Handed in', 'bg-done', rows.filter((r) => r.kind === 'handedIn').length],
    ['Handed in when time ran out', 'bg-input', rows.filter((r) => r.kind === 'byClock').length],
    ['Left — work up to then', 'bg-destructive', rows.filter((r) => r.kind === 'left').length],
    ['Students with warnings', 'bg-warn', students.filter((s) => s.warnings > 0).length],
  ];
  const wanted = find.trim().toLowerCase();
  const listed = rows.filter((r) => wanted === '' || r.s.name.toLowerCase().includes(wanted));
  return (
    <div className="flex h-screen flex-col">
      <TeacherBar teacher={run.teacher}>
        <ExamName title={run.title} sub={`${run.className} · ${run.startedAt ? `${formatClock(run.startedAt)} – ` : ''}${formatClock(run.endedAt)}`} />
        <Pill tone="done"><CheckIcon /> Ended {formatClock(run.endedAt)}</Pill>
        <Button variant="outline" onClick={() => void api.exportLog().then(setSaved)}><FileCsvIcon /> Export the log (CSV)</Button>
        <Button onClick={() => void api.openFolder()}><FolderIcon /> Open the hand-in folder</Button>
        <Button variant="outline" onClick={() => void api.done()}>Done</Button>
      </TeacherBar>
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-[26px] py-[22px]">
        <dl className="grid grid-cols-4 gap-2.5">
          {tiles.map(([label, dot, n]) => (
            <div key={label} className="flex flex-col gap-0.5 rounded-[11px] border border-border bg-card px-3.5 py-3">
              <dt className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><i className={cn('size-2 rounded-full', dot)} />{label}</dt>
              <dd className="text-[24px] font-semibold">{n}</dd>
            </div>
          ))}
        </dl>
        {saved && <p role="status" className="text-[12.5px] text-text-2">The log was saved as <span className="font-mono">{saved}</span></p>}
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-3.5">
            <h2 className="text-[15px] font-semibold">Hand-ins</h2>
            <span className="text-[12px] text-muted-foreground">{students.length} students · {all.length === 1 ? '1 file' : `${all.length} files`} · {size(all.reduce((sum, f) => sum + f.bytes, 0))}</span>
            <span className="flex-1" />
            <div className="relative w-[260px]">
              <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" aria-label="Find a student" placeholder="Find a student" value={find} onChange={(e) => setFind(e.target.value)} className="h-[34px] pl-8" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="pl-[18px]">Student</TableHead><TableHead>Computer</TableHead><TableHead>Status</TableHead><TableHead>At</TableHead><TableHead>How</TableHead><TableHead>Files</TableHead><TableHead>Receipt</TableHead><TableHead>Warnings</TableHead><TableHead />
              </TableRow></TableHeader>
              <TableBody>
                {listed.map(({ s, kept, pill, at, how }) => (
                  <TableRow key={s.id}>
                    <TableCell className="pl-[18px] font-semibold">{s.name}</TableCell>
                    <TableCell className="font-mono text-[12px] text-text-2">{s.pc ?? '—'}</TableCell>
                    <TableCell>{pill}</TableCell>
                    <TableCell className="font-mono text-[12px] text-text-2">{at ? formatClock(at) : '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{how}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1.5">
                        {kept.map((f) => <span key={f.name} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-0.5 text-[11.5px]"><FileIcon className="size-3 text-muted-foreground" />{f.name}</span>)}
                        {kept.length === 0 && <span className="text-muted-foreground">—</span>}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-[12px]">{s.receipt ?? '—'}</TableCell>
                    <TableCell>{s.warnings > 0 ? <Pill tone="warn"><WarningIcon /> {s.warnings}</Pill> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell><Button variant="ghost" size="sm" aria-label={`Open ${s.name}'s folder`} onClick={() => void api.openFolder(s.id)}><FolderIcon /> Open</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </div>
  );
}
