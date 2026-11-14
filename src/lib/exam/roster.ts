/**
 * A class list from what a teacher has (F-43): names typed one a line, rows pasted from a spreadsheet (tabs), or a
 * CSV file — with or without a heading row, with or without school emails and roll numbers. Pure.
 */

export interface RosterStudent { name: string; email?: string; number?: number }
export interface Roster { students: RosterStudent[]; /** rows that were left out, and why */ skipped: { row: number; why: 'noName' | 'sameEmail' | 'twice' }[] }

/** One line into cells: tabs (a spreadsheet's paste), else commas or semicolons, with "quoted, cells". */
export function cells(line: string): string[] {
  const by = line.includes('\t') ? '\t' : line.includes(';') && !line.includes(',') ? ';' : ',';
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && cell.trim() === '') quoted = true;
    else if (c === by) { out.push(cell); cell = ''; } else cell += c;
  }
  out.push(cell);
  return out.map((value) => value.replace(/\s+/g, ' ').trim());
}

const isEmail = (text: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
const isNumber = (text: string): boolean => /^\d{1,4}$/.test(text);
const HEADINGS = /^(#|no\.?|number|roll( ?no\.?)?|id|name|full ?name|student( name)?|first( ?name)?|given( ?name)?|last( ?name)?|family( ?name)?|surname|e-?mail( address)?|school e-?mail)$/i;

type Kind = 'first' | 'last' | 'name' | 'email' | 'number' | 'other';
function kindOf(heading: string): Kind {
  const h = heading.toLowerCase();
  if (/mail/.test(h)) return 'email';
  if (/^(#|no\.?|number|roll( ?no\.?)?|id)$/.test(h)) return 'number';
  if (/first|given/.test(h)) return 'first';
  if (/last|family|surname/.test(h)) return 'last';
  if (/name|student/.test(h)) return 'name';
  return 'other';
}

/** Reads a class list. A student with no name, a second student with the same email, and the same name twice
 *  without emails to tell them apart are left out and reported. */
export function parseRoster(text: string): Roster {
  // (a file from Excel may start with a mark that says it is UTF-8)
  const rows = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/).map(cells).map((r, i) => ({ r, row: i + 1 })).filter(({ r }) => r.some((c) => c !== ''));
  const first = rows[0]?.r ?? [];
  // a heading row: most of its cells are words like Name or Email (a column of something else may be among them)
  const filled = first.filter((c) => c !== '');
  const headed = filled.length > 0 && !filled.some(isEmail) && filled.filter((c) => HEADINGS.test(c)).length * 2 > filled.length;
  const kinds: Kind[] | undefined = headed ? first.map(kindOf) : undefined;
  const students: RosterStudent[] = [];
  const skipped: Roster['skipped'] = [];
  const emails = new Set<string>();
  const plain = new Set<string>();
  for (const { r, row } of headed ? rows.slice(1) : rows) {
    let name: string;
    let email: string | undefined;
    let number: number | undefined;
    if (kinds) {
      const of = (kind: Kind) => r.filter((_, i) => kinds[i] === kind).filter(Boolean).join(' ');
      name = of('name') || [of('first'), of('last')].filter(Boolean).join(' ');
      email = of('email') || undefined;
      number = isNumber(of('number')) ? Number(of('number')) : undefined;
    } else {
      // no headings: an email is known by its @, a short number in front is the roll number, the rest is the name
      email = r.find(isEmail);
      const rest = r.filter((c) => c !== '' && c !== email);
      if (rest.length > 1 && isNumber(rest[0]!)) number = Number(rest.shift());
      name = rest.join(' ');
    }
    email = email && isEmail(email) ? email.toLowerCase() : undefined;
    const key = name.toLowerCase();
    if (name === '') skipped.push({ row, why: 'noName' });
    else if (email && emails.has(email)) skipped.push({ row, why: 'sameEmail' });
    else if (!email && plain.has(key)) skipped.push({ row, why: 'twice' });
    else {
      if (email) emails.add(email); else plain.add(key);
      students.push({ name, ...(email ? { email } : {}), ...(number !== undefined ? { number } : {}) });
    }
  }
  return { students, skipped };
}

/** A class list as text again, for the box it is edited in: `Name<tab>email`, one student a line. */
export function rosterText(students: RosterStudent[]): string {
  return students.map((s) => (s.email ? `${s.name}\t${s.email}` : s.name)).join('\n');
}
