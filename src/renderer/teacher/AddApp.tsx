import { useState } from 'react';
import { CheckIcon, MagnifyingGlassIcon, PlusIcon } from '@phosphor-icons/react';
import { onComputers, type LabApp, type LabApps } from '@lib/profiles/inventory';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/** 11b · Add an app (F-31a): the apps the lab computers say they have, and how many of them have each. The apps
 *  with an exam profile are on Make an exam itself; these have none, and are only allowed to run. */
export function AddApp({ lab, added, onAdd }: { lab: LabApps; /** the programs already in the exam */ added: string[]; onAdd: (apps: LabApp[]) => void }) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const have = new Set(added.map((a) => a.toLowerCase()));
  const words = find.trim().toLowerCase();
  const rows = lab.others.filter((a) => !have.has(a.exe.toLowerCase()) && (words === '' || `${a.name} ${a.publisher ?? ''} ${a.exe}`.toLowerCase().includes(words)));
  const chosen = lab.others.filter((a) => picked.includes(a.exe) && !have.has(a.exe.toLowerCase()));
  const pick = (exe: string) => setPicked(picked.includes(exe) ? picked.filter((p) => p !== exe) : [...picked, exe]);
  function opened(now: boolean) {
    setOpen(now);
    if (now) {
      setFind('');
      setPicked([]);
    }
  }
  function add() {
    onAdd(chosen);
    setOpen(false);
  }
  return (
    <Dialog open={open} onOpenChange={opened}>
      <DialogTrigger asChild><Button type="button" variant="outline"><PlusIcon /> Add an app from the lab computers…</Button></DialogTrigger>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>Add an app to this exam</DialogTitle>
          <DialogDescription>The apps installed on the lab computers. Students can open only the apps you add.</DialogDescription>
        </DialogHeader>
        {lab.computers === 0 ? (
          <p className="rounded-[10px] border border-border bg-muted/40 px-3.5 py-3 text-[13px] text-text-2">
            No lab computer has said what it has installed yet. Each one tells this laptop when it finds an open exam: open an exam once with the lab's computers on, and their apps are listed here from then on.
          </p>
        ) : (
          <>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find an app" placeholder="Find an app" className="h-9 pl-8" />
            </div>
            <div role="group" aria-label="No profile yet" className="max-h-[320px] overflow-y-auto rounded-[10px] border border-border">
              {rows.length === 0 && <p className="px-3.5 py-3 text-[13px] text-muted-foreground">{lab.others.length === 0 ? 'The lab computers have no other apps.' : 'No app like that.'}</p>}
              {rows.map((a, i) => {
                const on = picked.includes(a.exe);
                return (
                  <button key={a.exe} type="button" role="checkbox" aria-checked={on} aria-label={a.name} onClick={() => pick(a.exe)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left outline-none focus-visible:bg-accent ${i > 0 ? 'border-t border-border' : ''} ${on ? 'bg-accent' : ''}`}>
                    <span className="grid size-7 flex-none place-items-center rounded-[7px] bg-muted text-[11px] font-bold text-text-2">{a.name.slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[12.5px]">{a.name}</b>
                      <span className={`block truncate text-[11.5px] ${a.computers < lab.computers ? 'text-warn-ink' : 'text-muted-foreground'}`}>{[a.publisher, onComputers(a.computers, lab.computers)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="flex-none text-[11.5px] text-muted-foreground">only allowed to run</span>
                    <span className={`grid size-[18px] flex-none place-items-center rounded-[5px] border-[1.5px] text-white ${on ? 'border-primary bg-primary' : 'border-input bg-card'}`}>{on && <CheckIcon weight="bold" className="size-3" />}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[12px] text-muted-foreground">
              An app with <b>no profile</b> still can't reach the internet, and anything it starts that isn't allowed is closed. A profile also turns off the app's own ways out — sign-in, add-ons, links that open a browser.
            </p>
          </>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" disabled={chosen.length === 0} onClick={add}>{chosen.length === 0 ? 'Add' : `Add ${chosen.length} app${chosen.length === 1 ? '' : 's'}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
