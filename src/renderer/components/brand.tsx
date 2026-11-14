import type { ComponentProps, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/utils';

/** The mark and the name (design/src/styles.css, .brand). On the exam bar the second word is lighter. */
export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <div className={cn('flex items-center gap-[9px] text-[15px] font-bold tracking-[-0.01em] whitespace-nowrap', dark && 'text-[14px] text-white')}>
      <Logo className="size-[26px] flex-none" />
      <b>Exam<span className={dark ? 'text-[#a5b4fc]' : 'text-primary'}>Mode</span></b>
    </div>
  );
}

const TONES = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn-ink',
  danger: 'bg-danger-soft text-danger-ink',
  lost: 'bg-lost-soft text-lost',
  done: 'bg-done-soft text-accent-foreground',
  wait: 'bg-secondary text-text-2',
} as const;
export type Tone = keyof typeof TONES;

/** A state in a few words (.pill): one colour for each of the five student states. */
export function Pill({ tone, className, ...props }: ComponentProps<typeof Badge> & { tone: Tone }) {
  return <Badge data-tone={tone} className={cn('h-[22px] gap-[5px] rounded-full border-0 px-[9px] text-[11.5px] font-semibold whitespace-nowrap [&>svg]:size-3', TONES[tone], className)} {...props} />;
}

/** A coloured box with a short note (.note-box). */
export function Note({ tone, icon, children, className }: { tone: 'info' | 'warn' | 'danger'; icon: ReactNode; children: ReactNode; className?: string }) {
  const tones = {
    info: 'border-[#c3cbf6] bg-accent text-accent-foreground',
    warn: 'border-warn-line bg-warn-soft text-warn-ink',
    danger: 'border-danger-line bg-danger-soft text-danger-ink',
  };
  return <div role={tone === 'info' ? 'note' : 'alert'} className={cn('flex gap-2.5 rounded-[9px] border px-3 py-2.5 text-left text-[12.5px] [&>svg]:mt-px [&>svg]:size-3.5 [&>svg]:flex-none', tones[tone], className)}>{icon}<span>{children}</span></div>;
}

/** A file size in words. */
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
