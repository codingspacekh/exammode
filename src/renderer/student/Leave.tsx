import { useState } from 'react';
import { DoorOpenIcon, FileIcon, UserIcon } from '@phosphor-icons/react';
import type { StudentApi, StudentState } from '@lib/app/state';
import { formatClock } from '@lib/session/time';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Calm, Card } from './Calm';

/** 08 · Leave the exam? (F-15): the one thing that can't be undone, so it is said in full. Leave stays greyed
 *  out until the box is ticked; Stay is the button already chosen, so Enter is safe. */
export function Leave({ state, api }: { state: StudentState; api: StudentApi }) {
  const [understood, setUnderstood] = useState(false);
  const { exam, student, handIn } = state;
  if (!exam || !student || !handIn) return null;
  return (
    <Calm who={<><UserIcon /> {student.name} · {state.pc}</>}>
      <Card role="alertdialog" aria-labelledby="leave-title" className="w-[min(520px,92%)] overflow-hidden shadow-[0_20px_48px_rgba(16,24,40,.22)]">
        <div className="flex gap-3.5 px-6 pt-[22px] pb-1.5">
          <span className="grid size-10 flex-none place-items-center rounded-[11px] bg-danger-soft text-destructive"><DoorOpenIcon className="size-5" /></span>
          <div>
            <h2 id="leave-title" className="mb-1 text-[17px] font-semibold">Leave the exam?</h2>
            <p className="text-[13px] text-text-2">If you leave now, <b>you can't come back into this exam</b> — not on this computer and not on another one. Only {exam.teacher} can let you back in.</p>
          </div>
        </div>
        <div className="pt-3.5 pr-6 pb-1 pl-[78px]">
          <p className="mb-2 text-[12px] text-muted-foreground">Your work so far is handed in as it is:</p>
          <ul aria-label="Your work so far" className="max-h-[30vh] overflow-auto rounded-[10px] border border-border">
            {handIn.files.map((f, i) => (
              <li key={f.name} className={`flex items-center gap-2.5 px-3 py-[9px] text-[12.5px] ${i > 0 ? 'border-t border-border' : ''}`}>
                <span className="grid size-[22px] flex-none place-items-center rounded-[5px] bg-lost text-white"><FileIcon className="size-3" /></span>
                <span className="truncate">{f.name}</span>
                <span className="ml-auto flex-none text-[11.5px] text-muted-foreground">saved {formatClock(f.modified)}</span>
              </li>
            ))}
            {handIn.files.length === 0 && <li className="px-3 py-[9px] text-[12.5px] text-muted-foreground">There is nothing in your Exam folder.</li>}
          </ul>
          <div className="mt-3.5 flex items-center gap-[9px]">
            <Checkbox id="understood" checked={understood} onCheckedChange={(on) => setUnderstood(on === true)} />
            <Label htmlFor="understood" className="text-[13px] font-normal">I understand I can't come back into this exam</Label>
          </div>
        </div>
        <div className="flex justify-end gap-2.5 px-6 pt-4 pb-5">
          <Button variant="destructive" disabled={!understood || state.handingIn} onClick={() => void api.leave()}><DoorOpenIcon /> {state.handingIn ? 'Leaving…' : 'Leave the exam'}</Button>
          <Button autoFocus disabled={state.handingIn} onClick={() => void api.keepWorking()}>Stay in the exam</Button>
        </div>
      </Card>
    </Calm>
  );
}
