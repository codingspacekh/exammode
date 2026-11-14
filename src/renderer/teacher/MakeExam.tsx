import { useState } from 'react';
import { CheckIcon, ExamIcon, FileTextIcon, GlobeIcon, MinusIcon, PencilSimpleIcon, PlayIcon, PlusIcon, TrashIcon, WarningIcon } from '@phosphor-icons/react';
import type { ExamForm, TeacherApi, TeacherState } from '@lib/app/state';
import { formatMinutes } from '@lib/session/time';
import { Note } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Section, TeacherBar } from './TeacherBar';

const NEW = 'new';
const STEP = 5;
const label = 'mb-[5px] text-[12px] font-semibold text-text-2';

/** 11 · Make an exam — the minimal form of M3 (F-30, F-32): the title, the class, the time, and where the
 *  questions are. Apps, files to give and the rules come with M5 and M6. */
export function MakeExam({ state, api }: { state: TeacherState; api: TeacherApi }) {
  const [teacher, setTeacher] = useState(state.defaults.teacher);
  const [title, setTitle] = useState('');
  const [classId, setClassId] = useState(state.classes.some((c) => c.id === state.defaults.classId) ? state.defaults.classId! : NEW);
  const [className, setClassName] = useState('');
  const [studentNames, setStudentNames] = useState('');
  const [minutes, setMinutes] = useState(90);
  const [where, setWhere] = useState<'paper' | 'website'>('paper');
  const [websites, setWebsites] = useState(['']);
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState(false);

  const kept = state.classes.find((c) => c.id === classId);
  const students = kept ? kept.students : new Set(studentNames.split('\n').map((n) => n.trim()).filter(Boolean)).size;
  const sites = where === 'website' ? websites.map((w) => w.trim()).filter(Boolean) : [];
  const site = (i: number, value: string) => setWebsites(websites.map((w, at) => (at === i ? value : w)));

  async function open() {
    const form: ExamForm = { teacher, title, classId: kept?.id, className, studentNames, minutes, websites: sites };
    setOpening(true);
    setError(await api.open(form));
    setOpening(false);
  }

  return (
    <div className="flex h-screen flex-col">
      <TeacherBar teacher={teacher.trim()}>
        <Button disabled={opening} onClick={() => void open()}><PlayIcon weight="fill" className="size-3" /> {opening ? 'Opening…' : 'Open for students…'}</Button>
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
                    <Label htmlFor="students" className={label}>Students — one name on each line</Label>
                    <Textarea id="students" value={studentNames} onChange={(e) => setStudentNames(e.target.value)} rows={8} placeholder={'Sokha Chan\nDara Kim\nVannak Sok'} className="min-h-[150px] font-sans" />
                  </div>
                </>
              )}
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
        </div>
        <aside className="flex w-[clamp(300px,28%,400px)] flex-col gap-3.5">
          <Section title="Ready to open" className="p-4">
            <ul className="mt-2.5 flex flex-col gap-2 text-[12.5px]">
              {[
                [title.trim() !== '', title.trim() || 'A title'],
                [students > 0, students > 0 ? `${students} students${kept ? ` in ${kept.name}` : ''}` : 'A class with its students'],
                [true, formatMinutes(minutes)],
                [where === 'paper' || sites.length > 0, where === 'paper' ? 'Questions on paper — no browser, no internet' : sites.length === 1 ? '1 website' : `${sites.length} websites`],
              ].map(([ok, text], i) => (
                <li key={i} className="flex items-start gap-2">
                  {ok ? <CheckIcon className="mt-px size-3.5 flex-none text-ok" /> : <span className="mt-[5px] size-1.5 flex-none rounded-full bg-input mx-1" />}
                  <span className={ok ? '' : 'text-muted-foreground'}>{text}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="What comes later" className="p-4">
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">This first version doesn't lock the lab computers yet. Choosing the exam's apps, giving out files and the rules come in the next versions.</p>
          </Section>
        </aside>
      </div>
    </div>
  );
}
