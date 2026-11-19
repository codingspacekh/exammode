/**
 * A folder only the system and administrators can touch (architecture §2.4): the Guard's journal says what to put
 * back, as the system — a student who could write it could have the system write anything. ProgramData lets every
 * user make files by default, so the Guard's folder is closed when it is made.
 */
import { run } from './run';

/** Takes away what the folder inherits and gives it to the system and the administrators alone. */
export async function onlySystem(folder: string): Promise<boolean> {
  // (by their well-known SIDs: the groups' names are in Windows' own language)
  const done = await run('icacls.exe', [folder, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F']);
  return done.ok;
}
