import { DoorOpenIcon, ExamIcon, FolderIcon, LockIcon, UploadSimpleIcon, WarningIcon, WifiSlashIcon } from '@phosphor-icons/react';
import type { StudentApi, StudentState } from '@lib/app/state';
import { formatClock, formatLeft } from '@lib/session/time';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { useNow } from '@/lib/remote';
import { cn } from '@/lib/utils';

/** Under this much time the clock turns amber. */
const LOW_MS = 10 * 60_000;
/** How long the bar says that an app was closed (07). */
export const CLOSED_MS = 8000;

/** 04 · The exam bar (F-09): across the top of the screen for the whole exam. M3: an ordinary always-on-top
 *  window. The exam's apps are buttons on it (05, 06). Leave is the door at the end (08): a menu can't open inside a window
 *  this low. With no contact, a strip under the bar says so (10b). */
export function ExamBar({ state, api }: { state: StudentState; api: StudentApi }) {
  const now = useNow();
  const { exam, student } = state;
  if (!exam || !student) return null;
  const left = state.endsAt === undefined ? undefined : state.endsAt - (now + state.clockOffset);
  const sep = <div className="h-7 w-px flex-none bg-xbar-3" />;
  const tab = 'inline-flex h-[34px] flex-none items-center gap-2 rounded-[7px] pr-[13px] pl-2 text-[13px] font-medium whitespace-nowrap text-xbar-foreground disabled:opacity-60';
  const tabOn = 'bg-white text-foreground shadow-[0_1px_3px_rgba(0,0,0,.3)]';
  const anyFront = state.apps.some((a) => a.front);
  const button = 'h-[34px] gap-[7px] rounded-[7px] border border-xbar-3 bg-transparent px-3 text-[13px] font-medium text-xbar-foreground hover:bg-xbar-3 hover:text-white';
  const lost = state.lostAt === undefined ? 0 : Math.max(0, now - state.lostAt);
  const recentlyClosed = state.closed !== undefined && now - state.closed.at < CLOSED_MS;
  return (
    <>
    <header className="flex h-[54px] items-center gap-3.5 overflow-hidden bg-xbar pr-3.5 pl-4 text-xbar-foreground">
      <Brand dark />
      <span className="inline-flex h-6 items-center gap-[5px] rounded-md bg-xtag px-[9px] text-[11.5px] font-bold tracking-[.06em] text-white"><LockIcon className="size-3" /> EXAM</span>
      <div className="flex min-w-0 flex-col leading-tight">
        <b className="truncate text-[13px] text-white">{exam.title}</b>
        <span className="truncate text-[11.5px] text-xbar-muted">{student.name} · {state.pc} · set by {exam.teacher}</span>
      </div>
      {(exam.hasQuestions || state.apps.length > 0) && (
        <>
          {sep}
          <div role="toolbar" aria-label="The exam's apps" className="flex min-w-0 gap-1 overflow-hidden rounded-[10px] bg-xbar-2 p-1">
            {exam.hasQuestions && (
              <button type="button" onClick={() => void api.showQuestions()} className={cn(tab, !anyFront && tabOn)}>
                <span className="grid size-[22px] place-items-center rounded-[5px] bg-primary text-white"><ExamIcon className="size-3" /></span>Questions
              </button>
            )}
            {state.apps.map((app) => (
              // 05, 06: an app of the exam — pressed, it opens under the bar or comes to the front; a dot says it is open
              <button key={app.id} type="button" aria-pressed={app.front} disabled={state.screen !== 'exam'} onClick={() => void api.openApp(app.id)} className={cn(tab, app.front && tabOn)}>
                <span className="grid size-[22px] flex-none place-items-center rounded-[5px] text-[10px] font-bold text-white" style={{ background: app.badge?.color ?? '#5b6472' }}>{app.badge?.text ?? app.name.charAt(0).toUpperCase()}</span>
                {app.name}
                {app.running && <i role="img" aria-label="open" className={cn('-ml-0.5 size-1.5 rounded-full bg-[#4ade80]', app.front && 'bg-ok')} />}
              </button>
            ))}
          </div>
        </>
      )}
      <span className="flex-1" />
      <span role="status" className={cn('inline-flex items-center gap-1.5 text-[12px] whitespace-nowrap text-xbar-muted', !state.contact && 'text-[#fbbf24]')}>
        <i className={cn('size-2 rounded-full bg-[#4ade80]', !state.contact && 'bg-[#fbbf24]')} />
        {state.contact ? 'Connected' : `Can't reach ${exam.teacher} — keep working`}
      </span>
      {sep}
      <div className="flex flex-col items-end leading-[1.15]">
        <b role="timer" className={cn('font-mono text-[17px] font-semibold tracking-[.02em] text-white', left !== undefined && left < LOW_MS && 'text-[#fbbf24]')}>{left === undefined ? '–:––:––' : formatLeft(left)}</b>
        <span className="text-[10.5px] whitespace-nowrap text-xbar-muted">{state.endsAt === undefined ? 'left' : `left · ends ${formatClock(state.endsAt - state.clockOffset)}`}</span>
      </div>
      {sep}
      <Button variant="ghost" className={button} onClick={() => void api.openFolder()}><FolderIcon /> Exam folder</Button>
      <Button className={cn(button, 'border-[#6366f1] bg-[#6366f1] text-white hover:bg-[#5558e6]')} disabled={state.screen !== 'exam'} onClick={() => void api.askHandIn()}><UploadSimpleIcon /> Hand in…</Button>
      <Button variant="ghost" size="icon" aria-label="Leave the exam…" title="Leave the exam…" className="size-[34px] rounded-[7px] text-xbar-foreground hover:bg-xbar-3 hover:text-white" disabled={state.screen !== 'exam'} onClick={() => void api.askLeave()}><DoorOpenIcon /></Button>
    </header>
    {state.contact && recentlyClosed && state.closed && (
      // 07: an app that isn't part of the exam was closed — said plainly, and the teacher was told
      <div role="alert" className="flex h-11 items-center justify-center gap-3 border-b border-warn-line bg-[#fffbeb] px-4 text-[13px] whitespace-nowrap text-warn-ink">
        <WarningIcon className="size-[18px]" />
        <span><b className="text-[#5b3d08]">{state.closed.name} isn't part of this exam.</b> It was closed. {exam.teacher} can see that it was opened at {formatClock(state.closed.at)}.</span>
      </div>
    )}
    {state.contact && !recentlyClosed && state.appMissing && now - state.appMissing.at < CLOSED_MS && (
      <div role="alert" className="flex h-11 items-center justify-center gap-3 border-b border-warn-line bg-[#fffbeb] px-4 text-[13px] whitespace-nowrap text-warn-ink">
        <WarningIcon className="size-[18px]" />
        <span><b className="text-[#5b3d08]">{state.appMissing.name} couldn't be opened on this computer.</b> Tell {exam.teacher}.</span>
      </div>
    )}
    {!state.contact && (
      // 10b: not leaving — the computer stays as it is, the clock keeps going, the work is saved here
      <div role="alert" className="flex h-11 items-center justify-center gap-3 border-b border-warn-line bg-[#fffbeb] px-4 text-[13px] whitespace-nowrap text-warn-ink">
        <WifiSlashIcon className="size-[18px]" />
        <span><b className="text-[#5b3d08]">Can't reach the teacher's computer.</b> Keep working — your work is saved on this computer. Trying again · {Math.floor(lost / 60_000)}:{String(Math.floor(lost / 1000) % 60).padStart(2, '0')}</span>
      </div>
    )}
    </>
  );
}
