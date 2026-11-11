/**
 * An app profile (architecture §2.10, requirements §1.7): how to recognise an app, how to start it in an exam, what
 * to turn off, and the child processes it may start. Profiles are data files in profiles/*.json, checked by this.
 */
import { z } from 'zod';

const text = z.string().min(1);

/** A registry value set for the exam and put back afterwards: under the user's hive (HKU\<SID>) or the machine's. */
export const policy = z.object({ hive: z.enum(['user', 'machine']), key: text, name: text, value: z.union([z.int(), z.string()]) });
export type Policy = z.infer<typeof policy>;

/** The folders a launch argument may name. */
export const PLACEHOLDERS = ['examFolder', 'examProfile'] as const;
const knownPlaceholders = (arg: string) => [...arg.matchAll(/\{(\w+)\}/g)].every((m) => (PLACEHOLDERS as readonly string[]).includes(m[1]!));

export const appProfile = z.object({
  id: text,
  name: text,
  /** signer + file name + install folder (with %Variables%) — never the name alone (F-12) */
  match: z.object({ files: z.array(text).min(1), signer: text.optional(), paths: z.array(text).min(1) }),
  launch: z.object({ args: z.array(z.string().refine(knownPlaceholders, 'only {examFolder} and {examProfile}')) }).default({ args: [] }),
  /** steps before the app starts (its own settings, extensions); each profile's are built in M5 */
  prepare: z.array(z.record(z.string(), z.unknown())).default([]),
  policies: z.array(policy).default([]),
  /** file names it may start; never a browser, whatever its name */
  children: z.object({ allow: z.array(text), never: z.array(z.enum(['browser'])) }).default({ allow: [], never: ['browser'] }),
  /** how its open files are saved before hand-in (F-16) */
  save: z.enum(['none', 'office']).default('none'),
});
export type AppProfile = z.infer<typeof appProfile>;
