/**
 * The exam's websites (F-10, F-13, architecture §2.6). The teacher gives a whole site (`docs.python.org/*`) or one
 * page (`ict.school.local/exams/y10-term1`); the first is the questions. The exam browser asks `decide()` about
 * every request: pages and frames must be on the list; a page's own files (pictures, styles, scripts) may also come
 * from the hosts recorded when the teacher added the site. Pure, so it is tested without a browser.
 */

/** A website as the exam keeps it: what the teacher typed, and the other hosts its pages load files from. */
export interface Website { url: string; hosts: string[] }

export interface SiteRule {
  /** host, with the port if one was given; lower case, without a leading `www.` */
  host: string;
  /** the page's path, without a trailing slash; empty for a whole site */
  path: string;
  /** every page of the site, or only this one */
  whole: boolean;
  /** where the browser goes first */
  start: string;
}

const bare = (host: string): string => host.toLowerCase().replace(/^www\./, '');
const trimmed = (path: string): string => path.replace(/\/+$/, '');

/** Reads what the teacher typed. Nothing if it isn't a web address. */
export function parseSite(text: string): SiteRule | undefined {
  const typed = text.trim();
  if (typed === '' || /\s/.test(typed)) return undefined;
  const whole = /\/\*$/.test(typed);
  const withScheme = /^https?:\/\//i.test(typed) ? typed : `https://${typed}`;
  let url: URL;
  try {
    url = new URL(whole ? withScheme.slice(0, -1) : withScheme);
  } catch {
    return undefined;
  }
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return undefined;
  const path = trimmed(url.pathname);
  // a bare host is the whole site
  const all = whole || (path === '' && url.search === '');
  return { host: bare(url.host), path: all ? '' : path, whole: all, start: all ? `${url.origin}${path}/` : url.href };
}

function parts(address: string): URL | undefined {
  try {
    return new URL(address);
  } catch {
    return undefined;
  }
}

/** May this address be opened as a page? */
export function allowsPage(rule: SiteRule, address: string): boolean {
  const url = parts(address);
  if (!url || !/^https?:$/.test(url.protocol) || bare(url.host) !== rule.host) return false;
  return rule.whole || trimmed(url.pathname) === rule.path;
}

export interface ExamSite { rule: SiteRule; hosts: string[] }

/** The exam's websites, ready for `decide()`. What can't be read is left out. */
export function examSites(websites: Website[]): ExamSite[] {
  return websites.flatMap((w) => {
    const rule = parseSite(w.url);
    return rule ? [{ rule, hosts: w.hosts.map(bare) }] : [];
  });
}

/** `mainFrame` and `subFrame` are pages; everything else is a page's file or a fetch. */
export function decide(request: { url: string; type: string }, sites: ExamSite[]): 'allow' | 'block' {
  const url = parts(request.url);
  if (!url) return 'block';
  // made by the page itself, nothing is fetched
  if (['data:', 'blob:', 'about:'].includes(url.protocol)) return 'allow';
  if (!/^(https?|wss?):$/.test(url.protocol)) return 'block';
  if (request.type === 'mainFrame' || request.type === 'subFrame') return sites.some((s) => allowsPage(s.rule, request.url)) ? 'allow' : 'block';
  const host = bare(url.host);
  return sites.some((s) => s.rule.host === host || s.hosts.includes(host)) ? 'allow' : 'block';
}

/** The host of an address, for *This page isn't part of the exam*. */
export const hostOf = (address: string): string => parts(address)?.host ?? address;
