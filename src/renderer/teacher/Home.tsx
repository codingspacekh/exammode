import { useState } from 'react';
import { CopyIcon, FileTextIcon, FolderIcon, GlobeIcon, PencilSimpleIcon, PlayIcon, PlusIcon, TrashIcon, UploadSimpleIcon, UsersIcon, WarningIcon } from '@phosphor-icons/react';
import type { ClassChoice, SavedExam, TeacherApi, TeacherState } from '@lib/app/state';
import { parseRoster, rosterText } from '@lib/exam/roster';
import { formatMinutes } from '@lib/session/time';
import { Note } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { MakeExam } from './MakeExam';
import { Section, TeacherBar, type Page } from './TeacherBar';

const day = (at: number): string => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** The exams that are kept (F-35): open one again, change it, copy it for another class. */
function Exams({ state, api, onEdit, onPage }: { state: TeacherState; api: TeacherApi; onEdit(exam?: SavedExam): void; onPage(page: Page): void }) {
  const [wrong, setWrong] = useState<string>();
  const teacher = state.exams[0]?.teacher ?? state.defaults.teacher;
  return (
    <div className="flex h-screen flex-col">
      <TeacherBar teacher={teacher} page="exams" onPage={onPage}>
        <Button onClick={() => onEdit()}><PlusIcon /> New exam</Button>
      </TeacherBar>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 px-[26px] py-[22px]">
        {wrong && <Note tone="danger" icon={<WarningIcon />}>{wrong}</Note>}
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2.5 border-b border-border px-[18px] py-3.5"><h2 className="text-[15px] font-semibold">Your exams</h2><span className="text-[12px] text-muted-foreground">{state.exams.length === 1 ? '1 exam' : `${state.exams.length} exams`}</span></div>
          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader><TableRow><TableHead className="pl-[18px]">Exam</TableHead><TableHead>Class</TableHead><TableHead>Time</TableHead><TableHead>Questions</TableHead><TableHead>Files to give</TableHead><TableHead>Changed</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {state.exams.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="pl-[18px] font-semibold">{e.title}</TableCell>
                    <TableCell>{e.className}</TableCell>
                    <TableCell>{formatMinutes(e.minutes)}</TableCell>
                    <TableCell className="text-text-2">{e.websites.length === 0 ? <span className="inline-flex items-center gap-1.5"><FileTextIcon className="size-3.5" /> On paper</span> : <span className="inline-flex items-center gap-1.5"><GlobeIcon className="size-3.5" /> {e.websites.length === 1 ? '1 website' : `${e.websites.length} websites`}</span>}</TableCell>
                    <TableCell className="text-text-2">{e.files.length === 0 ? '—' : <span className="inline-flex items-center gap-1.5"><FolderIcon className="size-3.5" /> {e.files.length}</span>}</TableCell>
                    <TableCell className="text-muted-foreground">{day(e.updatedAt)}{e.runs > 0 ? ` · run ${e.runs === 1 ? 'once' : `${e.runs} times`}` : ''}</TableCell>
                    <TableCell>
                      <span className="flex justify-end gap-1.5">
                        <Button size="sm" aria-label={`Open ${e.title} for students`} onClick={() => void api.openSaved(e.id).then(setWrong)}><PlayIcon weight="fill" className="size-3" /> Open for students…</Button>
                        <Button variant="outline" size="sm" aria-label={`Change ${e.title}`} onClick={() => onEdit(e)}><PencilSimpleIcon /> Change</Button>
                        <Button variant="ghost" size="sm" aria-label={`Copy ${e.title}`} onClick={() => void api.copyExam(e.id)}><CopyIcon /> Copy</Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Delete ${e.title}`} onClick={() => void api.deleteExam(e.id).then(setWrong)}><TrashIcon /></Button>
                      </span>
                    </TableCell>
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

const WHY = { noName: 'it has no name', sameEmail: 'another student has the same email', twice: 'the same name is on the list already' };

/** One class in the box it is changed in. */
function ClassEditor({ cls, api, onSaved }: { cls?: ClassChoice; api: TeacherApi; onSaved(name?: string): void }) {
  const [name, setName] = useState(cls?.name ?? '');
  const [list, setList] = useState(cls ? rosterText(cls.roster) : '');
  const [said, setSaid] = useState<{ text: string; ok: boolean }>();
  const read = parseRoster(list);
  const emails = read.students.filter((s) => s.email).length;
  async function save() {
    const answer = await api.saveClass({ id: cls?.id, name, list });
    // (an answer that starts with Saved is news, not something wrong)
    setSaid(answer ? { text: answer, ok: answer.startsWith('Saved') } : undefined);
    if (!answer || answer.startsWith('Saved')) onSaved(name.trim());
  }
  return (
    <Section title={cls ? cls.name : 'A new class'} sub="One student on each line: a name, or a name and a school email. Rows pasted from a spreadsheet work as they are." className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {said && <Note tone={said.ok ? 'info' : 'danger'} icon={<WarningIcon />}>{said.text}</Note>}
        <div><Label htmlFor="class-name" className="mb-[5px] text-[12px] font-semibold text-text-2">Name</Label><Input id="class-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Year 10 A" className="h-9" /></div>
        <div className="flex min-h-0 flex-1 flex-col">
          <Label htmlFor="class-list" className="mb-[5px] text-[12px] font-semibold text-text-2">Students</Label>
          <Textarea id="class-list" value={list} onChange={(e) => setList(e.target.value)} placeholder={'Sokha Chan\tsokha.chan@school.edu\nDara Kim\tdara.kim@school.edu'} className="min-h-[200px] flex-1 font-mono text-[12.5px]" />
        </div>
        <p role="status" className="text-[12.5px] text-text-2">
          {read.students.length === 1 ? '1 student' : `${read.students.length} students`}{emails > 0 ? ` · ${emails} with a school email` : ''}
          {read.skipped.map((s) => <span key={s.row} className="block text-warn-ink">Line {s.row} is left out: {WHY[s.why]}.</span>)}
        </p>
        <div className="flex items-center gap-2.5">
          <Button variant="outline" onClick={() => void api.readListFile().then((text) => text !== undefined && setList(text))}><UploadSimpleIcon /> Read a spreadsheet file…</Button>
          <span className="flex-1" />
          {cls && <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void api.deleteClass(cls.id).then((answer) => (answer ? setSaid({ text: answer, ok: false }) : onSaved()))}><TrashIcon /> Delete the class</Button>}
          <Button disabled={name.trim() === '' || read.students.length === 0} onClick={() => void save()}>Save the class</Button>
        </div>
      </div>
    </Section>
  );
}

/** Classes (F-43): each with its list, typed, pasted or read from a spreadsheet file. */
function Classes({ state, api, onPage }: { state: TeacherState; api: TeacherApi; onPage(page: Page): void }) {
  const [picked, setPicked] = useState<string | 'new'>(state.classes[0]?.id ?? 'new');
  // a class that was just saved is the one shown, once it is on the list
  const [saved, setSaved] = useState<string>();
  const chosen = state.classes.find((c) => c.name === saved)?.id ?? picked;
  const setChosen = (id: string | 'new') => {
    setSaved(undefined);
    setPicked(id);
  };
  const cls = state.classes.find((c) => c.id === chosen);
  return (
    <div className="flex h-screen flex-col">
      <TeacherBar teacher={state.exams[0]?.teacher ?? state.defaults.teacher} page="classes" onPage={onPage}>
        <Button onClick={() => setChosen('new')}><PlusIcon /> New class</Button>
      </TeacherBar>
      <div className="flex min-h-0 flex-1 gap-[22px] px-[26px] py-[22px]">
        <nav aria-label="Classes" className="flex w-[clamp(240px,24%,320px)] flex-col gap-1.5 overflow-auto">
          {state.classes.map((c) => (
            <button key={c.id} type="button" aria-current={c.id === chosen ? 'true' : undefined} onClick={() => setChosen(c.id)}
              className={cn('flex items-center gap-2.5 rounded-[10px] border border-border bg-card px-3.5 py-3 text-left', c.id === chosen && 'border-primary bg-accent')}>
              <UsersIcon className="size-4 text-text-2" /><b className="truncate text-[13.5px]">{c.name}</b><span className="ml-auto text-[12px] text-muted-foreground">{c.students}</span>
            </button>
          ))}
          {state.classes.length === 0 && <p className="text-[12.5px] text-muted-foreground">No class yet. Make the first one on the right.</p>}
        </nav>
        {/* a new box for each class, and after each save */}
        <ClassEditor key={`${chosen}:${cls?.students ?? 0}:${cls?.name ?? ''}`} cls={cls} api={api} onSaved={(name) => (name ? setSaved(name) : setChosen(state.classes.find((c) => c.id !== chosen)?.id ?? 'new'))} />
      </div>
    </div>
  );
}

/** Between exams (F-35, F-43): the exams that are kept, the classes, and the form that makes or changes an exam.
 *  With nothing kept yet, the form is the first thing a teacher sees: an exam from nothing in minutes (N-13). */
export function Home({ state, api }: { state: TeacherState; api: TeacherApi }) {
  const [page, setPage] = useState<Page>('exams');
  const [editing, setEditing] = useState<SavedExam | 'new' | undefined>(state.exams.length === 0 ? 'new' : undefined);
  const go = (to: Page) => {
    setPage(to);
    setEditing(undefined);
  };
  if (page === 'classes') return <Classes state={state} api={api} onPage={go} />;
  if (editing || state.exams.length === 0) {
    const exam = editing === 'new' ? undefined : editing;
    return <MakeExam key={exam?.id ?? `new:${state.classes.length}`} state={state} api={api} exam={exam} page="exams" onPage={go} onClose={() => setEditing(undefined)} cancel={state.exams.length > 0} />;
  }
  return <Exams state={state} api={api} onEdit={(exam) => setEditing(exam ?? 'new')} onPage={go} />;
}
