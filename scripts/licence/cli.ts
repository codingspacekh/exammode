/**
 * `npm run licence` — the author's tool for teacher licences (F-44).
 *
 *   npm run licence -- init                 make the author's key (once), and put its public half into ExamMode
 *   npm run licence -- <request.txt>        sign a licence for the request in that file (the email's text)
 *   npm run licence -- -                    … for a request pasted in, ended with Ctrl+D
 *   npm run licence -- list                 the licences given so far
 *
 *   --out <folder>    where the .emlicence is written (default: here)
 *   --home <folder>   where the author's key is (default: ~/.codingspacekh, or EXAMMODE_AUTHOR_HOME)
 *   --yes             don't ask "is this teacher checked?"
 *
 * The passphrase is asked for, unseen (or read from EXAMMODE_AUTHOR_PASSPHRASE, for a script).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { fingerprint } from '../../src/trust/keys';
import { fileName, give, init, issued, MIN_PASSPHRASE, read } from './author';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const home = flag('--home') ?? process.env.EXAMMODE_AUTHOR_HOME ?? join(homedir(), '.codingspacekh');
const out = flag('--out') ?? '.';
const yes = args.includes('--yes') && args.splice(args.indexOf('--yes'), 1).length > 0;
const SETTINGS = fileURLToPath(new URL('../../src/lib/trust/author.json', import.meta.url));

/** Asks a question; `unseen`: what is typed isn't shown. */
function ask(question: string, unseen = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (unseen) (rl as unknown as { _writeToOutput(text: string): void })._writeToOutput = (text) => void (text.includes(question) && process.stdout.write(question));
  return new Promise((done) => rl.question(question, (answer) => {
    rl.close();
    if (unseen) process.stdout.write('\n');
    done(answer);
  }));
}
const passphrase = async (again = false): Promise<string> => {
  if (process.env.EXAMMODE_AUTHOR_PASSPHRASE) return process.env.EXAMMODE_AUTHOR_PASSPHRASE;
  const first = await ask('Passphrase of the author key: ', true);
  if (again && first !== await ask('Once more: ', true)) throw new Error('The two weren\'t the same.');
  return first;
};
const stdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};
const day = (at: number): string => new Date(at).toISOString().slice(0, 10);

async function main(): Promise<void> {
  const [what] = args;
  if (!what) throw new Error('Say what to do: init, list, or a request file. See the top of scripts/licence/cli.ts.');
  if (what === 'init') {
    console.log(`The author's key is made in ${home}, locked with a passphrase of at least ${MIN_PASSPHRASE} characters.\nKeep a copy of that folder somewhere safe: without the key no new licence can be made; with it and the passphrase, anyone can make one.`);
    const key = await init(home, await passphrase(true));
    const settings = JSON.parse(await readFile(SETTINGS, 'utf8')) as { keys: string[] };
    if (!settings.keys.includes(key)) settings.keys.push(key);
    await writeFile(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
    console.log(`Made. Its public half is now in src/lib/trust/author.json (${fingerprint(key)}): commit that file — every ExamMode built from here on believes this key's licences.`);
    return;
  }
  if (what === 'list') {
    const all = await issued(home);
    for (const l of all) console.log(`${l.id}  ${day(l.at)}  ${l.name} · ${l.school} · ${l.email}  ${fingerprint(l.key)}`);
    console.log(all.length === 1 ? '1 licence.' : `${all.length} licences.`);
    return;
  }
  const request = read(what === '-' ? await stdin() : await readFile(what, 'utf8'));
  console.log(`\n  Name    ${request.name}\n  School  ${request.school}\n  Email   ${request.email}\n  Check   ${request.check}${request.note ? `\n  Note    ${request.note}` : ''}\n  Key     ${fingerprint(request.key)}\n`);
  if (!yes && what !== '-' && !/^y(es)?$/i.test((await ask('Have you checked that this is a teacher at that school? (yes/no) ')).trim())) return console.log('No licence made.');
  if (!yes && what === '-') throw new Error('With a pasted request, say --yes once you have checked the teacher.');
  const { licence, again } = await give(home, await passphrase(), request, Date.now());
  for (const b of again) console.log(`(licence ${b.id} was given on ${day(b.at)} to ${b.name}, ${b.email} — ${b.key === request.key ? 'the same key' : 'the same address, another key'})`);
  const file = resolve(out, fileName(request.name));
  await writeFile(file, `${JSON.stringify(licence, null, 2)}\n`);
  console.log(`Licence ${licence.id} for ${licence.name}: ${file}\nEmail it to ${request.email}. It only works on the computer that asked.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
