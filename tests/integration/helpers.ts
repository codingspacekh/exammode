import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { Store } from '../../src/main/teacher/store/store';

const cleanups: (() => Promise<void> | void)[] = [];
/** Runs after the test, last first: close what was opened, delete what was made. */
export const later = (cleanup: () => Promise<void> | void): void => void cleanups.push(cleanup);
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A folder of the test's own, deleted afterwards. */
export async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'exammode-'));
  later(() => rm(folder, { recursive: true, force: true, maxRetries: 5 }));
  return folder;
}

export function openStore(path = ':memory:'): Store {
  const store = new Store(path);
  later(() => store.close());
  return store;
}

/** A time on the exam's day, as the teacher's clock in ms: at('09:59') or at('09:59:30'). */
export function at(clock: string): number {
  const [h = 0, m = 0, s = 0] = clock.split(':').map(Number);
  return Date.UTC(2026, 10, 12, h, m, s);
}

/** The prototype's exam with a few of its students (MILESTONES §3.1). */
export async function year10(store: Store, names = ['Sokha Chan', 'Dara Kim', 'Vannak Sok', 'Mealea Heng']) {
  const cls = await store.addClass('Year 10 A', names.map((name, i) => ({ name, email: `${name.toLowerCase().replace(' ', '.')}@school.edu`, number: i + 1 })));
  const exam = await store.addExam({ title: 'Year 10 ICT — Term 1 practical exam', teacher: 'Ms Srey Leak', classId: cls.id, minutes: 90 }, at('08:50'));
  const byName = (name: string) => cls.students.find((s) => s.name === name)!;
  return { cls, exam, byName };
}

/** Waits until `check` stops throwing (for things that arrive over a socket). */
export async function eventually<T>(check: () => T | Promise<T>, ms = 3000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() > until) throw error;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}
