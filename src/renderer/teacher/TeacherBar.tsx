import type { ReactNode } from 'react';
import { ListBulletsIcon, UsersIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Brand, Pill } from '@/components/brand';

const initials = (name: string): string => name.replace(/^(Ms|Mr|Mrs|Miss|Dr)\.?\s+/i, '').split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();

/** The top of every teacher screen (.tbar): the name, teacher mode, and what this screen can do on the right. */
export type Page = 'exams' | 'classes';

/** `page` and `onPage`: between exams, the teacher moves between the exams and the classes. During a run the
 *  bar only says where they are. */
export function TeacherBar({ teacher, children, page = 'exams', onPage }: { teacher: string; children?: ReactNode; page?: Page; onPage?: (page: Page) => void }) {
  const tab = (on: boolean) => cn('inline-flex h-8 items-center gap-[7px] rounded-[7px] px-3 font-medium text-text-2', on && 'bg-accent text-accent-foreground');
  return (
    <header className="flex h-14 flex-none items-center gap-3.5 border-b border-border bg-card px-[18px]">
      <Brand />
      <Pill tone="done">Teacher</Pill>
      <nav className="ml-2.5 flex gap-0.5">
        {onPage ? (
          <>
            <button type="button" aria-current={page === 'exams' ? 'page' : undefined} className={tab(page === 'exams')} onClick={() => onPage('exams')}><ListBulletsIcon className="size-3.5" /> Exams</button>
            <button type="button" aria-current={page === 'classes' ? 'page' : undefined} className={tab(page === 'classes')} onClick={() => onPage('classes')}><UsersIcon className="size-3.5" /> Classes</button>
          </>
        ) : <span aria-current="page" className={tab(true)}><ListBulletsIcon className="size-3.5" /> Exams</span>}
      </nav>
      <span className="flex-1" />
      {children}
      {teacher !== '' && (
        <>
          <div className="h-[26px] w-px bg-border" />
          <div className="flex items-center gap-2 text-[12.5px] text-text-2">
            <span className="grid size-[30px] flex-none place-items-center rounded-full bg-accent text-[11.5px] font-bold text-accent-foreground">{initials(teacher)}</span>{teacher}
          </div>
        </>
      )}
    </header>
  );
}

/** The exam's title with a line under it (.exname). */
export function ExamName({ title, sub }: { title: string; sub: string }) {
  return <div className="flex min-w-0 flex-col leading-tight"><b className="truncate text-[14px]">{title}</b><span className="truncate text-[11.5px] text-muted-foreground">{sub}</span></div>;
}

export function Section({ title, sub, children, className }: { title: ReactNode; sub?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-card px-[18px] py-4 ${className ?? ''}`}>
      <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold [&>svg]:size-3.5">{title}</h2>
      {sub && <p className="mb-3 text-[12px] text-muted-foreground">{sub}</p>}
      {children}
    </section>
  );
}
