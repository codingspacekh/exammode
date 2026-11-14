import { useEffect, useState } from 'react';
import type { ExamModeApi } from '@lib/app/state';

declare global {
  interface Window { exammode: ExamModeApi }
}

/** The state of one side (student, teacher, the exam browser), kept by the main process: fetched once, then told. */
export function useRemote<S>(api: { get(): Promise<S>; onState(listener: (state: S) => void): () => void }): S | undefined {
  const [state, setState] = useState<S>();
  useEffect(() => {
    let live = true;
    const stop = api.onState((next) => live && setState(next));
    void api.get().then((first) => live && setState((now) => now ?? first));
    return () => {
      live = false;
      stop();
    };
  }, [api]);
  return state;
}

/** The time now, told again every `ms`: for clocks. */
export function useNow(ms = 250): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
