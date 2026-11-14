/**
 * The exam profiles that come with ExamMode (requirements §1.7, architecture §2.10): the data files in profiles/,
 * checked once when ExamMode starts. To add one: a JSON file there, its line here, and a test that it matches the
 * app's recorded process (tests/fixtures/procs).
 */
import word from '../../../profiles/word.json';
import excel from '../../../profiles/excel.json';
import powerpoint from '../../../profiles/powerpoint.json';
import access from '../../../profiles/access.json';
import project from '../../../profiles/project.json';
import vscode from '../../../profiles/vscode.json';
import idle from '../../../profiles/idle.json';
import thonny from '../../../profiles/thonny.json';
import oneeditor from '../../../profiles/oneeditor.json';
import microlab from '../../../profiles/microlab.json';
import { appProfile, type AppProfile } from './schema';

/** In the order the teacher's screen lists them. */
export const BUILTIN: AppProfile[] = [word, excel, powerpoint, access, project, vscode, idle, thonny, oneeditor, microlab].map((json) => appProfile.parse(json));

export const builtin = (id: string): AppProfile | undefined => BUILTIN.find((p) => p.id === id);
