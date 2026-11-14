import { useState } from 'react';
import { ArrowClockwiseIcon, ArrowLeftIcon, CaretLeftIcon, CaretRightIcon, ExamIcon, GlobeIcon, LockIcon, ShieldCheckIcon, XCircleIcon, XIcon } from '@phosphor-icons/react';
import type { BrowserApi, BrowserState } from '@lib/app/state';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** A web address in two parts, as the bar shows it: the host, then the rest in grey. */
function parts(url: string): [string, string] {
  try {
    const u = new URL(url);
    return [u.host, `${u.pathname === '/' ? '' : u.pathname}${u.search}`];
  } catch {
    return [url, ''];
  }
}

/** 04 · The exam's own browser (F-10): tabs, back and forward, and no address box — the address is only shown.
 *  07b · A page that isn't part of the exam (F-13) takes the page's place. The pages themselves are drawn by the
 *  main process under this strip. */
export function BrowserShell({ state, api }: { state: BrowserState; api: BrowserApi }) {
  const [listing, setListing] = useState(false);
  const tab = state.tabs.find((t) => t.id === state.active);
  const [host, rest] = parts(tab?.url ?? '');
  const nav = 'size-7 rounded-md text-text-2';
  return (
    <div className="flex h-screen flex-col bg-card">
      <div role="tablist" className="flex h-[30px] flex-none items-end gap-0.5 bg-[#e4e8ed] px-2">
        {state.tabs.map((t, i) => {
          const on = t.id === state.active;
          return (
            <div key={t.id} className={cn('flex h-[26px] max-w-60 items-center gap-[7px] rounded-t-[7px] px-3 text-[12px] text-text-2', on && 'bg-secondary font-medium text-foreground')}>
              <button type="button" role="tab" aria-selected={on} onClick={() => void api.select(t.id)} className="flex min-w-0 items-center gap-[7px]">
                {i === 0 ? <ExamIcon className="size-3 flex-none" /> : <GlobeIcon className="size-3 flex-none" />}
                <span className="truncate">{t.blocked ? 'Not part of the exam' : t.title || 'Loading…'}</span>
              </button>
              {i > 0 && <button type="button" aria-label={`Close ${t.title}`} onClick={() => void api.close(t.id)} className="text-muted-foreground hover:text-foreground"><XIcon className="size-3" /></button>}
            </div>
          );
        })}
      </div>
      <div className="flex h-10 flex-none items-center gap-1.5 border-b border-border bg-secondary px-2.5">
        <Button variant="ghost" size="icon-sm" className={nav} aria-label="Back" disabled={!tab?.canGoBack} onClick={() => void api.back()}><CaretLeftIcon /></Button>
        <Button variant="ghost" size="icon-sm" className={nav} aria-label="Forward" disabled={!tab?.canGoForward} onClick={() => void api.forward()}><CaretRightIcon /></Button>
        <Button variant="ghost" size="icon-sm" className={nav} aria-label="Load the page again" disabled={!tab} onClick={() => void api.reload()}><ArrowClockwiseIcon /></Button>
        <div aria-label="This page's address" className={cn('flex h-7 max-w-[760px] flex-1 items-center gap-[7px] truncate rounded-full border border-border bg-card px-3 text-[12.5px] text-text-2', tab?.blocked && 'text-danger-ink')}>
          {tab?.blocked ? <XCircleIcon className="size-3 flex-none" /> : <LockIcon className="size-3 flex-none text-ok" />}
          <span className="truncate">{tab?.blocked ?? host}{!tab?.blocked && <em className="text-muted-foreground not-italic">{rest}</em>}</span>
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-[11.5px] whitespace-nowrap text-muted-foreground"><ShieldCheckIcon className="size-3.5" /> Only the exam's websites open here</span>
      </div>
      {tab?.blocked && (
        <div className="flex flex-1 overflow-auto bg-white">
          <div className="m-auto max-w-[480px] p-10 text-center">
            <div className="mx-auto mb-4 grid size-[60px] place-items-center rounded-2xl bg-danger-soft text-destructive"><GlobeIcon className="size-8" /></div>
            <h2 className="mb-2 text-[19px] font-semibold">This page isn't part of the exam</h2>
            <p className="mb-1.5 text-[13.5px] text-text-2">The exam browser only opens the exam's own pages and the sites your teacher allowed.</p>
            <div className="mt-1.5 mb-[18px] inline-block rounded-md bg-secondary px-[9px] py-[3px] font-mono text-[12px]">{tab.blocked}</div>
            <div className="flex justify-center gap-2.5">
              <Button onClick={() => void api.toQuestions()}><ArrowLeftIcon /> Back to the questions</Button>
              <Button variant="outline" aria-expanded={listing} onClick={() => setListing(!listing)}>Allowed sites</Button>
            </div>
            {listing && <ul aria-label="Allowed sites" className="mt-4 space-y-1 font-mono text-[12px] text-text-2">{state.sites.map((s) => <li key={s}>{s}</li>)}</ul>}
          </div>
        </div>
      )}
    </div>
  );
}
