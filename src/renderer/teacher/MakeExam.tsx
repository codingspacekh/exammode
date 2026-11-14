import { useState } from 'react';
import { AppWindowIcon, CheckIcon, ExamIcon, FileIcon, FileTextIcon, FolderIcon, GlobeIcon, MinusIcon, PencilSimpleIcon, PlayIcon, PlusIcon, ShieldCheckIcon, TrashIcon, WarningIcon } from '@phosphor-icons/react';
import type { ExamForm, GivenFile, SavedExam, TeacherApi, TeacherState } from '@lib/app/state';
import { parseRoster } from '@lib/exam/roster';
import { BUILTIN } from '@lib/profiles/builtin';
import { appLabel, type ExamApp } from '@lib/profiles/exam-apps';
import { formatMinutes } from '@lib/session/time';
import { Note, size } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Section, TeacherBar, type Page } from './TeacherBar';

const NEW = 'new';
const STEP = 5;
const label = 'mb-[5px] text-[12px] font-semibold text-text-2';

/** What an exam always does, in this version: said, not switched (the prototype's switches come when a rule can
 *  really be turned off). */
const RULES: [string, string][] = [
  ['Leaving locks the student out', 'They can\'t join again unless you let them back in.'],
  ['ExamMode closed suddenly counts as leaving', 'A crash, a power cut, Task Manager — you decide who comes back.'],
  ['Hand in by itself when the time is up', 'Every student\'s work is collected at the end.'],
  ['A lost network is not leaving', 'The student keeps working, and the gap is reported when contact is back.'],
];

/** 11 · Make an exam (F-30, F-32, F-33, F-35): the title, the class, the time, where the questions are, the
 *  files to give, the apps (F-31). `exam`: the kept exam that is being changed. */
export function MakeExam({ state, api, exam, page, onPage, onClose, cancel = false }: { state: TeacherState; api: TeacherApi; exam?: SavedExam; page?: Page; onPage?: (page: Page) => void; /** back to the list: after Save, or by Cancel when there is a list to go back to */ onClose?: () => void; cancel?: boolean }) {
  const lastClass = exam?.classId ?? state.defaults.classId;
  const [teacher, setTeacher] = useState(exam?.teacher ?? state.defaults.teacher);
  const [title, setTitle] = useState(exam?.title ?? '');
  const [classId, setClassId] = useState(state.classes.some((c) => c.id === lastClass) ? lastClass! : NEW);
  const [className, setClassName] = useState('');
  const [studentNames, setStudentNames] = useState('');
  const [minutes, setMinutes] = useState(exam?.minutes ?? 90);
  const [where, setWhere] = useState<'paper' | 'website'>(exam && exam.websites.length > 0 ? 'website' : 'paper');
  const [websites, setWebsites] = useState(exam && exam.websites.length > 0 ? exam.websites : ['']);
  const [files, setFiles] = useState<GivenFile[]>(exam?.files ?? []);
  const [apps, setApps] = useState<ExamApp[]>(exam?.apps ?? []);
  const [program, setProgram] = useState('');
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState(false);

  const kept = state.classes.find((c) => c.id === classId);
  const students = kept ? kept.students : parseRoster(studentNames).students.length;
  const sites = where === 'website' ? websites.map((w) => w.trim()).filter(Boolean) : [];
  const site = (i: number, value: string) => setWebsites(websites.map((w, at) => (at === i ? value : w)));

  const form = (): ExamForm => ({ id: exam?.id, teacher, title, classId: kept?.id, className, studentNames, minutes, websites: sites, files, apps });
  async function send(how: 'open' | 'saveExam') {
    setOpening(true);
    const wrong = await api[how](form());
    setError(wrong);
    setOpening(false);
    if (!wrong && how === 'saveExam') onClose?.();
  }
  const has = (id: string) => apps.some((a) => 'profile' in a && a.profile === id);
  const toggle = (id: string) => setApps(has(id) ? apps.filter((a) => !('profile' in a && a.profile === id)) : [...apps, { profile: id }]);
  const others = apps.filter((a): a is Extract<ExamApp, { custom: unknown }> => 'custom' in a);
  /** An app without a profile: by where its program is on the lab computers. */
  function addProgram() {
    const image = program.trim();
    if (image === '' || others.some((a) => a.custom.image.toLowerCase() === image.toLowerCase())) return;
    setApps([...apps, { custom: { image } }]);
    setProgram('');
  }
  /** The files just chosen take the place of ones with the same name. */
  async function addFiles() {
    const chosen = await api.chooseFiles();
    setFiles([...files.filter((f) => !chosen.some((c) => c.name === f.name)), ...chosen].sort((a, b) => a.name.localeCompare(b.name)));
  }

  return (
    <div className="flex h-screen flex-col">
      <TeacherBar teacher={teacher.trim()} page={page} onPage={onPage}>
        {cancel && <Button variant="ghost" disabled={opening} onClick={onClose}>Cancel</Button>}
        <Button variant="outline" disabled={opening} onClick={() => void send('saveExam')}>Save</Button>
        <Button disabled={opening} onClick={() => void send('open')}><PlayIcon weight="fill" className="size-3" /> {opening ? 'Opening…' : 'Open for students…'}</Button>
      </TeacherBar>
      <div className="flex min-h-0 flex-1 gap-[22px] overflow-hidden px-[26px] py-[22px]">
        <div className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-auto">
          {error && <Note tone="danger" icon={<WarningIcon />}>{error}</Note>}
          <Section title={<><PencilSimpleIcon /> The exam</>} sub="Students see the title and your name.">
            <div className="grid grid-cols-2 gap-x-3.5 gap-y-3">
              <div className="col-span-2"><Label htmlFor="title" className={label}>Title</Label><Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Year 10 ICT — Term 1 practical exam" className="h-9" /></div>
              <div><Label htmlFor="teacher" className={label}>Your name</Label><Input id="teacher" value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder="Ms Srey Leak" className="h-9" /></div>
              <div>
                <Label id="time-label" className={label}>Time — counted from Start</Label>
                <div role="group" aria-labelledby="time-label" className="flex h-9 items-center rounded-lg border border-input bg-card">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Less time" disabled={minutes <= STEP} onClick={() => setMinutes(minutes - STEP)}><MinusIcon /></Button>
                  <b aria-live="polite" className="flex-1 text-center text-[13px]">{formatMinutes(minutes)}</b>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="More time" disabled={minutes >= 600} onClick={() => setMinutes(minutes + STEP)}><PlusIcon /></Button>
                </div>
              </div>
              <div className="col-span-2">
                <Label htmlFor="class" className={label}>Class</Label>
                <Select value={classId} onValueChange={setClassId}>
                  <SelectTrigger id="class" className="h-9 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {state.classes.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} · {c.students} students</SelectItem>)}
                    <SelectItem value={NEW}>A new class…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!kept && (
                <>
                  <div className="col-span-2"><Label htmlFor="class-name" className={label}>The class's name</Label><Input id="class-name" value={className} onChange={(e) => setClassName(e.target.value)} placeholder="Year 10 A" className="h-9" /></div>
                  <div className="col-span-2">
                    <Label htmlFor="students" className={label}>Students — one name on each line (or pasted from a spreadsheet)</Label>
                    <Textarea id="students" value={studentNames} onChange={(e) => setStudentNames(e.target.value)} rows={8} placeholder={'Sokha Chan\nDara Kim\nVannak Sok'} className="min-h-[150px] font-sans" />
                  </div>
                </>
              )}
            </div>
          </Section>
          <Section title={<><AppWindowIcon /> Apps students can use</>} sub="Chosen for each exam. Every other app is closed. An app with an exam profile also has its own ways out turned off.">
            <div role="group" aria-label="Apps with an exam profile" className="grid grid-cols-3 gap-2">
              {BUILTIN.map((p) => (
                <button key={p.id} type="button" role="checkbox" aria-checked={has(p.id)} onClick={() => toggle(p.id)}
                  className={`flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 ${has(p.id) ? 'border-primary bg-accent' : 'border-input'}`}>
                  <span className="grid size-7 flex-none place-items-center rounded-[7px] text-[11px] font-bold text-white" style={{ background: p.badge?.color }}>{p.badge?.text}</span>
                  <span className="min-w-0"><b className="block truncate text-[12.5px]">{p.name}</b><span className="block truncate text-[11.5px] text-muted-foreground">{p.publisher}</span></span>
                  <span className={`ml-auto grid size-[18px] flex-none place-items-center rounded-[5px] border-[1.5px] text-white ${has(p.id) ? 'border-primary bg-primary' : 'border-input bg-card'}`}>{has(p.id) && <CheckIcon weight="bold" className="size-3" />}</span>
                </button>
              ))}
            </div>
            {others.length > 0 && (
              <ul aria-label="Other apps" className="mt-2.5 overflow-hidden rounded-[10px] border border-border">
                {others.map((a, i) => (
                  <li key={a.custom.image} className={`flex items-center gap-2.5 px-3 py-[7px] text-[12.5px] ${i > 0 ? 'border-t border-border' : ''}`}>
                    <b className="flex-none">{appLabel(a)}</b><span className="truncate font-mono text-[11.5px] text-muted-foreground">{a.custom.image}</span>
                    <span className="ml-auto flex-none text-[11.5px] text-muted-foreground">only allowed to run</span>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Take ${appLabel(a)} off`} onClick={() => setApps(apps.filter((x) => x !== a))}><TrashIcon /></Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2.5 flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="program" className={label}>Another app — its program's place on the lab computers</Label>
                <Input id="program" value={program} onChange={(e) => setProgram(e.target.value)} placeholder="C:\\Program Files\\GIMP 2\\bin\\gimp-2.10.exe" className="h-9 font-mono text-[12.5px]" />
              </div>
              <Button type="button" variant="outline" disabled={program.trim() === ''} onClick={addProgram}><PlusIcon /> Add the app</Button>
            </div>
          </Section>
          <Section title={<><ExamIcon /> Questions</>} sub="On paper is the usual: students get no browser and no internet at all. On a website: the exam browser opens only these.">
            <ToggleGroup type="single" variant="outline" value={where} onValueChange={(v) => v && setWhere(v as 'paper' | 'website')} aria-label="Where the questions are" className="mb-3">
              <ToggleGroupItem value="paper" className="gap-1.5 px-3"><FileTextIcon /> On paper</ToggleGroupItem>
              <ToggleGroupItem value="website" className="gap-1.5 px-3"><GlobeIcon /> On a website</ToggleGroupItem>
            </ToggleGroup>
            {where === 'website' && (
              <div className="flex flex-col gap-2">
                {websites.map((w, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={w} onChange={(e) => site(i, e.target.value)} aria-label={i === 0 ? 'The question page' : `Another website ${i}`} placeholder={i === 0 ? 'school.example/exams/y10-term1' : 'docs.python.org/*'} className="h-9 font-mono text-[12.5px]" />
                    <span className="w-[190px] flex-none text-[11.5px] text-muted-foreground">{i === 0 ? 'The questions — opens first' : 'Also allowed'}</span>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Take this website off" disabled={websites.length === 1} onClick={() => setWebsites(websites.filter((_, at) => at !== i))}><TrashIcon /></Button>
                  </div>
                ))}
                <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setWebsites([...websites, ''])}><PlusIcon /> Add a website</Button>
                <p className="text-[12px] text-muted-foreground">One page: <code className="font-mono">school.example/exams/y10-term1</code>. A whole site: <code className="font-mono">docs.python.org/*</code>.</p>
              </div>
            )}
          </Section>
          <Section title={<><FolderIcon /> Files to give</>} sub="Copied into every student's Exam folder when the exam starts. A file a student doesn't change isn't handed in.">
            {files.length > 0 && (
              <ul aria-label="Files to give" className="mb-2 overflow-hidden rounded-[10px] border border-border">
                {files.map((f, i) => (
                  <li key={f.name} className={`flex items-center gap-2.5 px-3 py-[7px] text-[12.5px] ${i > 0 ? 'border-t border-border' : ''}`}>
                    <span className="grid size-[22px] flex-none place-items-center rounded-[5px] bg-lost text-white"><FileIcon className="size-3" /></span>
                    <span className="truncate">{f.name}</span>
                    <span className="ml-auto flex-none text-[11.5px] text-muted-foreground">{size(f.bytes)}</span>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Take ${f.name} off`} onClick={() => setFiles(files.filter((x) => x.name !== f.name))}><TrashIcon /></Button>
                  </li>
                ))}
              </ul>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => void addFiles()}><PlusIcon /> Add files</Button>
          </Section>
          <Section title={<><ShieldCheckIcon /> Rules</>} sub="The same for every exam in this version.">
            <ul aria-label="Rules">
              {RULES.map(([rule, why], i) => (
                <li key={rule} className={`flex items-start gap-3 py-2.5 ${i > 0 ? 'border-t border-border' : 'pt-0.5'}`}>
                  <CheckIcon className="mt-0.5 size-3.5 flex-none text-ok" />
                  <div><b className="block text-[13px]">{rule}</b><span className="text-[12px] text-muted-foreground">{why}</span></div>
                </li>
              ))}
            </ul>
          </Section>
        </div>
        <aside className="flex w-[clamp(300px,28%,400px)] flex-col gap-3.5">
          <Section title="Ready to open" className="p-4">
            <ul className="mt-2.5 flex flex-col gap-2 text-[12.5px]">
              {[
                [title.trim() !== '', title.trim() || 'A title'],
                [students > 0, students > 0 ? `${students} students${kept ? ` in ${kept.name}` : ''}` : 'A class with its students'],
                [true, formatMinutes(minutes)],
                [true, apps.length === 0 ? 'No apps: only the questions' : `${apps.length === 1 ? '1 app' : `${apps.length} apps`}: ${apps.map(appLabel).join(', ')}`],
                [where === 'paper' || sites.length > 0, where === 'paper' ? 'Questions on paper — no browser, no internet' : sites.length === 1 ? '1 website' : `${sites.length} websites`],
                [true, files.length === 0 ? 'No files to give' : `${files.length === 1 ? '1 file' : `${files.length} files`} to give · ${size(files.reduce((sum, f) => sum + f.bytes, 0))}`],
              ].map(([ok, text], i) => (
                <li key={i} className="flex items-start gap-2">
                  {ok ? <CheckIcon className="mt-px size-3.5 flex-none text-ok" /> : <span className="mt-[5px] size-1.5 flex-none rounded-full bg-input mx-1" />}
                  <span className={ok ? '' : 'text-muted-foreground'}>{text}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="What comes later" className="p-4">
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">The list of the apps that are installed on the lab computers, with how many computers have each, comes next. Until then an app without a profile is added by its program's place.</p>
          </Section>
        </aside>
      </div>
    </div>
  );
}
