/**
 * The classroom protocol's HTTP side (architecture §2.7): its ports, its routes, what each answers and how an error
 * is told — one table, read by the teacher's server (its router) and by every client (the lab computers, the Guard).
 * The messages themselves are in messages.ts.
 */
import { z } from 'zod';
import { beacon, fileMeta, PROTOCOL_VERSION } from './messages';

/** Where the teacher's laptop listens: HTTP and WebSocket, and the beacon's UDP broadcast. */
export const PORTS = { classroom: 47800, beacon: 47801 } as const;

/** The attempt's token, for a file the teacher gives (F-33). */
export const TOKEN_HEADER = 'x-exammode-token';

/** The WebSocket: join or resume first, then the rest of the protocol. */
export const WS_PATH = '/ws';

/** Every error a request can be answered with, by name, and its HTTP status. Both ends read the name from the
 *  answer's body (`{ error }`): a status alone is ambiguous (404, 413). */
export const ERRORS = {
  invalid: 400,
  unknown: 401,
  notFound: 404,
  noSuchRun: 404,
  refused: 409,
  tooBig: 413,
  tooMuch: 413,
  mismatch: 422,
  failed: 500,
  diskFull: 507,
} as const;
export type HttpError = keyof typeof ERRORS;
export const httpError = z.object({ error: z.enum(Object.keys(ERRORS) as [HttpError, ...HttpError[]]) });

/** What a route answers when all went well and there is nothing more to say. */
export const okReply = z.object({ v: z.int(), ok: z.literal(true) });

/** A run's class list, to pick a name from (F-02). */
export const classList = z.object({
  v: z.int().optional(),
  students: z.array(z.object({ id: z.string().max(200), name: z.string().max(200), email: z.string().max(320).optional() })).max(1000),
});
export type ClassList = z.infer<typeof classList>;

/** The answer to an upload: a backup's `ok`, or a hand-in's receipt — with the teacher's signature on exactly
 *  these files when the teacher is licensed (F-44). Checked again by the caller: the signature and the receipt. */
export const uploadReply = z.looseObject({
  v: z.int(),
  ok: z.literal(true).optional(),
  type: z.literal('receipt').optional(),
  code: z.string().max(20).optional(),
  files: z.array(fileMeta).optional(),
  sig: z.string().max(200).optional(),
});
export type UploadReply = z.infer<typeof uploadReply>;

/** The routes, as `METHOD path`; `:name` is a part of the path, given to the route and percent-encoded. */
export const ROUTES = {
  /** the open runs, as the beacon announces them (F-01, for a typed-in computer name) */
  exams: { method: 'GET', path: '/exams', reply: z.array(beacon) },
  /** the class list to pick a name from (F-02) */
  students: { method: 'GET', path: '/runs/:run/students', reply: classList },
  /** a file the teacher gives every student, with the attempt's token in TOKEN_HEADER (F-33): its bytes */
  given: { method: 'GET', path: '/runs/:run/files/:name', reply: undefined },
  /** the Guard: ExamMode's process ended without unlocking (F-20) — messages.ts `stopped` */
  stopped: { method: 'POST', path: '/stopped', reply: okReply },
  /** a lab computer's installed apps, for Add an app (F-31a) — messages.ts `inventory` */
  inventory: { method: 'POST', path: '/inventory', reply: okReply },
  /** a backup or a hand-in, multipart: `meta` (messages.ts `upload`) first, then the files as f0, f1 … (F-16, F-22) */
  upload: { method: 'POST', path: '/upload', reply: uploadReply },
} as const;
export type RouteName = keyof typeof ROUTES;

/** The names of a path's parts: '/runs/:run/files/:name' → 'run' | 'name'. */
type PartsOf<P extends string> = P extends `${string}:${infer Part}/${infer Rest}` ? Part | PartsOf<`/${Rest}`> : P extends `${string}:${infer Part}` ? Part : never;
export type ParamsOf<R extends RouteName> = Record<PartsOf<(typeof ROUTES)[R]['path']>, string>;

/** A route's path, with its parts filled in. */
export function pathOf<R extends RouteName>(route: R, ...[params]: PartsOf<(typeof ROUTES)[R]['path']> extends never ? [] : [ParamsOf<R>]): string {
  const values = (params ?? {}) as Record<string, string>;
  return ROUTES[route].path.replace(/:([a-z]+)/g, (_, part: string) => encodeURIComponent(values[part] ?? ''));
}

/** A route's address on a computer: `http://host:port/path`. An IPv6 address is put in brackets. */
export function urlOf<R extends RouteName>(at: { host: string; port: number }, route: R, ...params: PartsOf<(typeof ROUTES)[R]['path']> extends never ? [] : [ParamsOf<R>]): string {
  return `${baseOf(at)}${pathOf(route, ...params)}`;
}

/** `http://host:port`; `ws://…` for the WebSocket. */
export function baseOf(at: { host: string; port: number }, scheme: 'http' | 'ws' = 'http'): string {
  const host = at.host.includes(':') && !at.host.startsWith('[') ? `[${at.host}]` : at.host;
  return `${scheme}://${host}:${at.port}`;
}

export type Matched = { [R in RouteName]: { route: R; params: ParamsOf<R> } }[RouteName];

/** Which route a request is for, with its parts decoded; nothing if none. */
export function matchRoute(method: string | undefined, pathname: string): Matched | undefined {
  for (const [route, { method: m, path }] of Object.entries(ROUTES) as [RouteName, (typeof ROUTES)[RouteName]][]) {
    if (m !== method) continue;
    const names: string[] = [];
    const pattern = new RegExp(`^${path.replace(/:([a-z]+)/g, (_, part: string) => (names.push(part), '([^/]+)'))}$`);
    const found = pattern.exec(pathname);
    if (!found) continue;
    try {
      const params = Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(found[i + 1]!)]));
      return { route, params } as Matched;
    } catch {
      // a part that isn't percent-encoded properly: no route
      return undefined;
    }
  }
  return undefined;
}

/** The error named in an answer's body, or what its status alone says. */
export function errorOf(status: number, body: unknown): HttpError | undefined {
  const named = httpError.safeParse(body);
  if (named.success) return named.data.error;
  return (Object.entries(ERRORS) as [HttpError, number][]).find(([, s]) => s === status)?.[0];
}

export { PROTOCOL_VERSION };
