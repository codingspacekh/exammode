import { ClockIcon, FileIcon, UploadSimpleIcon, UserIcon } from '@phosphor-icons/react';
import type { FileLine, StudentApi, StudentState } from '@lib/app/state';
import { formatClock } from '@lib/session/time';
import { Note, size } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { useNow } from '@/lib/remote';
import { Calm, Card } from './Calm';

function Row({ file, dim }: { file: FileLine; dim?: boolean }) {
  return (
    <li className={`flex items-center gap-2.5 border-t border-border px-3 py-[9px] text-[12.5px] ${dim ? 'text-muted-foreground' : ''}`}>
      <span className="grid size-[22px] flex-none place-items-center rounded-[5px] bg-lost text-white"><FileIcon className="size-3" /></span>
      <span className="truncate">{file.name}</span>
      <span className="ml-auto flex-none text-[11.5px] text-muted-foreground">{size(file.bytes)} · {formatClock(file.modified)}</span>
    </li>
  );
}

/** 09 · Hand in (F-16): exactly which files go to the teacher; it asks once. */
export function HandIn({ state, api }: { state: StudentState; api: StudentApi }) {
  const now = useNow(1000);
  const { exam, student, handIn } = state;
  if (!exam || !student || !handIn) return null;
  const minutes = state.endsAt === undefined ? undefined : Math.max(0, Math.floor((state.endsAt - (now + state.clockOffset)) / 60_000));
  const count = handIn.files.length;
  return (
    <Calm who={<><UserIcon /> {student.name} · {state.pc}</>}>
      <Card role="dialog" aria-labelledby="handin-title" className="w-[min(640px,92%)] overflow-hidden shadow-[0_20px_48px_rgba(16,24,40,.22)]">
        <div className="flex gap-3.5 px-6 pt-[22px] pb-1.5">
          <span className="grid size-10 flex-none place-items-center rounded-[11px] bg-accent text-primary"><UploadSimpleIcon className="size-5" /></span>
          <div>
            <h2 id="handin-title" className="mb-1 text-[17px] font-semibold">Hand in your work</h2>
            <p className="text-[13px] text-text-2">These files from your Exam folder go to {exam.teacher}. After you hand in, the exam ends on this computer.</p>
          </div>
        </div>
        <div className="px-6 pt-3.5 pb-1">
          <ul aria-label="Your work" className="max-h-[38vh] overflow-auto rounded-[10px] border border-border">
            <li className="bg-background px-3 py-[9px] text-[11.5px] font-semibold text-muted-foreground">Your work — {count === 1 ? '1 file' : `${count} files`}</li>
            {handIn.files.map((f) => <Row key={f.name} file={f} />)}
            {count === 0 && <li className="border-t border-border px-3 py-[9px] text-[12.5px] text-muted-foreground">There is nothing in your Exam folder. Save your work there first.</li>}
            {handIn.unchanged.length > 0 && <li className="border-t border-border bg-background px-3 py-[9px] text-[11.5px] font-semibold text-muted-foreground">Given by {exam.teacher}, not changed</li>}
            {handIn.unchanged.map((f) => <Row key={f.name} file={f} dim />)}
          </ul>
          <Note tone="info" icon={<ClockIcon />} className="mt-3">
            {minutes === undefined ? '' : minutes === 1 ? '1 minute is left. ' : `${minutes} minutes are left. `}You can't come back into the exam after you hand in.
          </Note>
        </div>
        <div className="flex justify-end gap-2.5 px-6 pt-4 pb-5">
          <Button variant="outline" disabled={state.handingIn} onClick={() => void api.keepWorking()}>Keep working</Button>
          <Button disabled={state.handingIn} onClick={() => void api.handIn()}><UploadSimpleIcon /> {state.handingIn ? 'Handing in…' : 'Hand in now'}</Button>
        </div>
      </Card>
    </Calm>
  );
}
