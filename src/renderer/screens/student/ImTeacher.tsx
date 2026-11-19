import { useState } from 'react';
import { CheckCircleIcon, CopyIcon, EnvelopeSimpleIcon, FileArrowUpIcon, SealCheckIcon, WarningIcon } from '@phosphor-icons/react';
import type { LicenceLoaded, StudentApi, TeacherRequestForm } from '@contracts/ipc/state';
import { Note } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const WHY: Record<Extract<LicenceLoaded, { ok: false }>['why'], string> = {
  unreadable: 'That file isn\'t a teacher licence.',
  invalid: 'That file isn\'t a teacher licence.',
  notFromAuthor: 'This licence wasn\'t made by the author of this ExamMode, or was changed since. Ask for it again.',
  withdrawn: 'This licence has been withdrawn.',
  otherComputer: 'This licence is for another computer. Ask for teacher mode from this one.',
  noRequest: 'This computer hasn\'t asked for teacher mode. Ask from here first: a licence only works on the computer that asked.',
};
const FIELDS: [field: keyof TeacherRequestForm, label: string, placeholder: string][] = [
  ['name', 'Your name', 'Srey Leak'],
  ['school', 'School', 'Riverside High School'],
  ['email', 'School email', 'you@your-school.example'],
  ['check', 'Where it can be checked that you teach there', 'your school\'s staff page, say'],
];
const label = 'mb-[5px] text-[12px] font-semibold text-text-2';

/** I'm a teacher… (F-44): asking the author for teacher mode, and loading the licence that comes back. Every
 *  ExamMode starts as a lab computer's; a teacher asks from their own laptop. */
export function ImTeacher({ api }: { api: StudentApi }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TeacherRequestForm>({ name: '', school: '', email: '', check: '', note: '' });
  const [error, setError] = useState<string>();
  const [made, setMade] = useState<{ text: string; address: string; author: string }>();
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState<LicenceLoaded>();

  async function ask() {
    const answer = await api.teacherRequest(form);
    if ('error' in answer) return setError(answer.error);
    setError(undefined);
    setMade(answer);
  }
  async function copy() {
    if (!made) return;
    await api.copyText(made.text);
    setCopied(true);
  }
  async function load() {
    const answer = await api.loadLicence();
    if (answer) setLoaded(answer);
  }
  function opened(now: boolean) {
    setOpen(now);
    if (now) {
      setError(undefined);
      setMade(undefined);
      setCopied(false);
      setLoaded(undefined);
    }
  }
  const failed = loaded && !loaded.ok ? <Note tone="danger" icon={<WarningIcon />}>{WHY[loaded.why]}</Note> : null;
  const haveFile = <Button type="button" variant="ghost" className="mr-auto" onClick={() => void load()}><FileArrowUpIcon /> I have a licence file…</Button>;

  return (
    <Dialog open={open} onOpenChange={opened}>
      <DialogTrigger asChild><button type="button" className="mt-4 text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">I'm a teacher…</button></DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        {loaded?.ok ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><SealCheckIcon className="size-5 text-primary" /> Teacher mode is on</DialogTitle>
              <DialogDescription><b className="text-foreground">{loaded.name}</b> · {loaded.school} · licence {loaded.id}</DialogDescription>
            </DialogHeader>
            <p className="text-[13px] text-text-2">ExamMode starts again as yours: you can make exams, and your students' computers will find them and trust only this laptop while one runs.</p>
            <DialogFooter><Button type="button" onClick={() => void api.restart()}>Start again in teacher mode</Button></DialogFooter>
          </>
        ) : made ? (
          <>
            <DialogHeader>
              <DialogTitle>Send your request by email</DialogTitle>
              <DialogDescription>Send this text to {made.address ? <b className="text-foreground">{made.address}</b> : made.author}, from your school email if you can. {made.author} checks every teacher, then emails you a licence file.</DialogDescription>
            </DialogHeader>
            <pre aria-label="Your request" className="max-h-[220px] overflow-auto whitespace-pre-wrap break-all rounded-[10px] border border-border bg-muted/40 px-3.5 py-3 font-mono text-[11.5px] leading-relaxed">{made.text}</pre>
            <p className="text-[12px] text-muted-foreground">Only the public half of your key is in it — nothing that could unlock it. When your licence comes, open the file on <b>this</b> computer.</p>
            {failed}
            <DialogFooter>
              {haveFile}
              <Button type="button" variant="outline" onClick={() => void copy()}>{copied ? <CheckCircleIcon /> : <CopyIcon />} {copied ? 'Copied' : 'Copy'}</Button>
              {made.address && <Button type="button" variant="outline" onClick={() => void api.emailRequest(made.text)}><EnvelopeSimpleIcon /> Open in my email app</Button>}
              <Button type="button" onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="contents">
            <DialogHeader>
              <DialogTitle>Ask for teacher mode</DialogTitle>
              <DialogDescription>Teacher mode lets you run exams for your students. Every teacher is checked first; then a licence file is emailed to you.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              {FIELDS.map(([field, text, placeholder]) => (
                <div key={field} className={field === 'check' ? 'col-span-2' : ''}>
                  <Label htmlFor={`teacher-${field}`} className={label}>{text}</Label>
                  <Input id={`teacher-${field}`} value={form[field] ?? ''} onChange={(e) => setForm({ ...form, [field]: e.target.value })} placeholder={placeholder} className="h-9" />
                </div>
              ))}
              <div className="col-span-2">
                <Label htmlFor="teacher-note" className={label}>Note (optional)</Label>
                <Textarea id="teacher-note" value={form.note ?? ''} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="What you teach, and to whom" className="min-h-[56px]" />
              </div>
            </div>
            <Note tone="warn" icon={<WarningIcon />}><b>Use your own computer</b> — not one students use. Your teacher key is made here and stays here: a licence only works on the computer that asked.</Note>
            {error && <Note tone="danger" icon={<WarningIcon />}>{error}</Note>}
            {failed}
            <DialogFooter>
              {haveFile}
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit">Make my request</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
