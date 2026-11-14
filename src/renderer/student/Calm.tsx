import type { ReactNode } from 'react';
import { Brand } from '@/components/brand';
import { cn } from '@/lib/utils';

/** The plain screens before and after the exam (.calm): a card in the middle, the name and who is here on top. */
export function Calm({ who, tag, children }: { who: ReactNode; tag?: ReactNode; children: ReactNode }) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-auto bg-[radial-gradient(1200px_600px_at_50%_0%,#e7ebfb_0%,var(--background)_60%)] py-20">
      <div className="absolute inset-x-0 top-0 flex items-center gap-3 px-7 py-[18px]">
        <Brand />
        {tag}
        <span className="flex-1" />
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground [&>svg]:size-3.5">{who}</span>
      </div>
      {children}
    </main>
  );
}

export function Card({ className, children, ...props }: { className?: string; children: ReactNode } & React.ComponentProps<'div'>) {
  return <div className={cn('rounded-[14px] border border-border bg-card shadow-[0_6px_18px_rgba(16,24,40,.12)]', className)} {...props}>{children}</div>;
}

/** The lines of a receipt (.receipt): a label and its value. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="mt-[22px] mb-1.5 rounded-[10px] bg-background px-4 py-1 text-left">
      {rows.map(([label, value], i) => (
        <div key={label} className={cn('flex justify-between gap-6 py-[9px] text-[13px]', i > 0 && 'border-t border-border')}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
