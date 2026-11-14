import { ArrowLeftIcon, CheckIcon, ClipboardIcon, UserIcon, WarningIcon, XIcon } from '@phosphor-icons/react';
import type { StudentApi, StudentState } from '@lib/app/state';
import { Note } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { checkWords } from '@/lib/checks';
import { cn } from '@/lib/utils';
import { Calm, Card } from './Calm';

const MARK = { ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', busy: 'bg-accent text-primary', bad: 'bg-danger-soft text-destructive' };

function Row({ tone, icon, title, detail, children, first }: { tone: keyof typeof MARK; icon: React.ReactNode; title: string; detail: string; children?: React.ReactNode; first?: boolean }) {
  return (
    <li className={cn('flex items-start gap-3 py-3', !first && 'border-t border-border')}>
      <span className={cn('grid size-[26px] flex-none place-items-center rounded-full [&>svg]:size-3.5', MARK[tone])}>{icon}</span>
      <div className="min-w-0 flex-1"><b className="block text-[13.5px]">{title}</b><span className="text-[12px] text-muted-foreground">{detail}</span>{children}</div>
    </li>
  );
}

/** 02 · Getting this computer ready (F-04, F-05, F-06): each check, plainly; the apps that will be closed, listed
 *  first, with a file that isn't saved; then the computer is locked. */
export function Checks({ state, api }: { state: StudentState; api: StudentApi }) {
  const { exam, student, checks } = state;
  if (!exam || !student || !checks) return null;
  const looking = checks.checks.length === 0;
  const apps = checks.toClose;
  const windows = (n: number) => (n > 1 ? `· ${n} windows` : '');
  return (
    <Calm who={<><UserIcon /> {student.name} · {state.pc}</>}>
      <Card className="w-[min(640px,92%)] px-[34px] py-[30px]">
        <h1 className="mb-1 text-[22px] font-semibold tracking-[-0.01em]">Getting this computer ready</h1>
        <p className="mb-3.5 text-[14px] text-muted-foreground">{exam.title} · {exam.teacher}</p>
        <ul aria-label="Checks">
          <Row first tone="ok" icon={<CheckIcon />} title={`Connected to ${exam.teacher}'s computer`} detail="Your work is sent there when you hand in." />
          {looking && <Row tone="busy" icon={<CheckIcon />} title="Looking at this computer…" detail="One screen, no remote control, a real computer." />}
          {checks.checks.filter((c) => c.check !== 'guard' || !c.ok).map((c) => {
            const words = checkWords(c);
            return <Row key={c.check} tone={c.ok ? 'ok' : 'bad'} icon={c.ok ? <CheckIcon /> : <XIcon />} title={words.title} detail={words.detail} />;
          })}
          {!looking && apps.length > 0 && (
            <Row tone="warn" icon={<WarningIcon />} title={apps.length === 1 ? '1 app will be closed' : `${apps.length} apps will be closed`} detail="They aren't part of this exam. Save anything you need first.">
              <ul aria-label="Apps that will be closed" className="mt-2.5 flex flex-col gap-1.5">
                {apps.map((app) => (
                  <li key={app.name} className="flex items-center gap-2.5 rounded-lg bg-background px-2.5 py-[7px] text-[12.5px]">
                    <span className="grid size-[22px] flex-none place-items-center rounded-[5px] bg-lost text-[10px] font-bold text-white">{app.name.charAt(0).toUpperCase()}</span>
                    {app.name}<span className="text-muted-foreground">{windows(app.windows)}</span>
                    {app.unsaved && <span className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-warn-ink"><WarningIcon className="size-3" /> not saved — {app.unsaved}</span>}
                  </li>
                ))}
              </ul>
            </Row>
          )}
          {!looking && <Row tone="busy" icon={<ClipboardIcon />} title="The clipboard is emptied" detail="Anything copied before the exam can't be pasted in." />}
        </ul>
        {checks.error && <Note tone="danger" icon={<WarningIcon />} className="mt-2">{checks.error}</Note>}
        <div className="mt-4 flex items-center gap-2.5">
          <Button variant="ghost" disabled={checks.locking} onClick={() => void api.backOut()}><ArrowLeftIcon /> Back</Button>
          <span className="flex-1" />
          {!looking && !checks.ok && <Button variant="outline" onClick={() => void api.checkAgain()}>Check again</Button>}
          <Button size="lg" className="h-[42px] rounded-[9px] px-5 text-[14px]" disabled={!checks.ok || checks.locking} onClick={() => void api.lock()}>
            {checks.locking ? 'Getting ready…' : apps.length === 0 ? 'Continue' : apps.length === 1 ? 'Close the app and continue' : `Close the ${apps.length} apps and continue`}
          </Button>
        </div>
      </Card>
    </Calm>
  );
}
