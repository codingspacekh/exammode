import type { ReactNode } from 'react';
import { ListBulletsIcon } from '@phosphor-icons/react';
import { Brand, Pill } from '@/components/brand';

const initials = (name: string): string => name.replace(/^(Ms|Mr|Mrs|Miss|Dr)\.?\s+/i, '').split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();

/** The top of every teacher screen (.tbar): the name, teacher mode, and what this screen can do on the right. */
export function TeacherBar({ teacher, children }: { teacher: string; children?: ReactNode }) {
  return (
    <header className="flex h-14 flex-none items-center gap-3.5 border-b border-border bg-card px-[18px]">
      <Brand />
      <Pill tone="done">Teacher</Pill>
      <nav className="ml-2.5 flex gap-0.5">
        <span aria-current="page" className="inline-flex h-8 items-center gap-[7px] rounded-[7px] bg-accent px-3 font-medium text-accent-foreground"><ListBulletsIcon className="size-3.5" /> Exams</span>
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
