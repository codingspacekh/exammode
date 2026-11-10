# 2. Architecture

*Revision 5 (2026-11-10): CI on GitHub — `check` on macOS and `check:win` on `windows-latest` for every push; `check:quick` stays a local pre-commit hook (§2.14).*

*Revision 3 (2026-11-10): a review before M0. The Guard is its **own program** and ExamMode's Electron fuses are set, so ExamMode.exe can't be used to run other code through the firewall (D3, D10); after stopping suddenly the Guard **starts ExamMode again** to show 10 (§2.4); a **`resume`** message after a network gap, and a token on the Guard's `stopped` (§2.7); **before Start** a stop isn't leaving (§2.8); ExamMode only reaches the teacher, plus 80/443 when the exam has websites (§2.6); the Exam folder is deleted only after the teacher has confirmed the files (§2.9); extra time per student (§2.11); the teacher's side on Windows or macOS.*

*Revision 2 (2026-11-10): the exam browser is optional — it exists only when the exam has websites (Q14); classes carry school emails (Q12).*

*Revision 1 (2026-11-10): first design, for the teacher's comments. Requirement IDs (F-12, N-04, R1, Q5…) refer to [`01-analysis-and-requirements.md`](01-analysis-and-requirements.md); screen numbers refer to the [prototype](../design/screens/index.html).*

---

## Contents

1. [2.1 Decisions](#21-decisions)
2. [2.2 Processes and layers](#22-processes-and-layers)
3. [2.3 An exam from start to end](#23-an-exam-from-start-to-end)
4. [2.4 Locking a lab computer](#24-locking-a-lab-computer)
5. [2.5 The process guard](#25-the-process-guard)
6. [2.6 The network rules](#26-the-network-rules)
7. [2.7 The classroom protocol](#27-the-classroom-protocol)
8. [2.8 Left, stopped suddenly, or no contact](#28-left-stopped-suddenly-or-no-contact)
9. [2.9 Files: the Exam folder, backups, hand-in](#29-files-the-exam-folder-backups-hand-in)
10. [2.10 App profiles](#210-app-profiles)
11. [2.11 The teacher's data](#211-the-teachers-data)
12. [2.12 Trust: teacher licence and the teacher's key](#212-trust-teacher-licence-and-the-teachers-key)
13. [2.13 Project structure](#213-project-structure)
14. [2.14 Commands](#214-commands)
15. [2.15 Where to add things](#215-where-to-add-things)

---

## 2.1 Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **One Electron app** for students and teachers; teacher mode is switched on by a licence (F-44) | One install, one build, one update feed |
| D2 | **Every Windows call goes through one `WinApi` interface**: koffi in the app, a fake in tests | The rules are tested on any computer; only the thin adapter needs Windows (§2.13) |
| D3 | **A Windows service, ExamMode Guard**, does the admin-only jobs and **owns the journal**. It is its own program, `ExamModeGuard.exe` (TypeScript built as a Node single-executable application), run by WinSW | A normal app can't change the firewall or machine policies; the Guard still runs when ExamMode is killed (F-20, N-04) |
| D4 | **The rules live in pure TypeScript** (`src/lib`): the student state machine, the process decision, the stop classification, the protocol | The parts that decide right and wrong are the most tested and depend on nothing |
| D5 | **The teacher's laptop is the authority.** Students' computers report; the teacher's laptop decides who is in, who left and who may come back | A lab computer can be tampered with; the teacher's laptop is in the teacher's hands (R7) |
| D6 | **The exam bar is a Windows AppBar** (like the taskbar): it reserves the top of the screen, so maximised apps fill the space under it | Word and VS Code stay normal windows; nothing has to be drawn over them (F-09, F-11) |
| D7 | **Explorer is stopped during an exam** and started again afterwards | Removes the taskbar, Start, the desktop and most Win-key shortcuts in one step (F-07, F-14), as Safe Exam Browser does |
| D8 | **The firewall blocks all outbound traffic** except ExamMode itself, the teacher's laptop, DNS and DHCP; **the exam browser filters by website** | Firewall rules can't name websites; the browser can. Together: no app reaches the internet, and the browser reaches only the exam's sites (F-10, F-23) |
| D9 | **Every change is journaled before it is made**, and undone in reverse order | The computer always goes back to normal (N-04, R6) |
| D10 | **ExamMode can only be ExamMode.** It is installed for the whole computer in Program Files. Its Electron fuses are set: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments` off; `OnlyLoadAppFromAsar` and `EnableEmbeddedAsarIntegrityValidation` on. Only one copy runs at a time | The firewall lets ExamMode.exe through; without the fuses a student could run any script *as* ExamMode.exe and reach the internet |

## 2.2 Processes and layers

```
┌──────────────────────────────── a lab computer ─────────────────────────────────┐
│                                                                                 │
│  ExamMode.exe (the student's session)                                           │
│  ├─ main process ── src/main/student                                            │
│  │    ├─ session client   ── WebSocket to the teacher, heartbeat every 2 s      │
│  │    ├─ lockdown         ── asks the Guard; AppBar; clipboard; checks           │
│  │    ├─ process guard    ── src/lib/guard decides; WinApi closes (§2.5)        │
│  │    ├─ app launcher     ── profiles → start Word, VS Code… in the Exam folder │
│  │    ├─ exam browser     ── only if the exam has websites; URL filter (§2.6)   │
│  │    └─ files            ── Exam folder, backups, hand-in (§2.9)               │
│  ├─ hook worker ── koffi: low-level keyboard hook + window-event hook (R1)      │
│  └─ renderer (React + shadcn) ── join, checks, waiting, exam bar, dialogs        │
│             ▲ named pipe \\.\pipe\exammode-guard (authenticated, §2.4)          │
│  ExamModeGuard.exe (Windows service, LocalSystem) ── src/guard                  │
│       journal · firewall · machine & user policies · Explorer · watchdog         │
└──────────────────────────────────────┬──────────────────────────────────────────┘
          UDP broadcast :47801 (find)  │  HTTP + WebSocket :47800 (everything else)
┌──────────────────────────────────────▼──────────────────────────────────────────┐
│  the teacher's laptop (Windows or macOS) — ExamMode in teacher mode             │
│  ├─ main process ── src/main/teacher                                            │
│  │    ├─ classroom server ── runs, attempts, the rules of §2.8, hand-ins        │
│  │    ├─ beacon           ── announces open runs every 2 s                      │
│  │    └─ store            ── SQLite (Drizzle): classes, exams, runs, events     │
│  └─ renderer (React + shadcn) ── make an exam, lobby, live view, timeline, end  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Layers and their imports** (enforced by an ESLint boundary rule):

| Layer | May import | Never imports |
|---|---|---|
| `src/lib/**` | only `src/lib`, `zod` | `electron`, Node built-ins, `koffi`, React, the DOM |
| `src/main/**` | `src/lib`, Node, `electron`, `src/win` (by interface) | React |
| `src/win/**` | `koffi`, Node | `electron`, React |
| `src/guard/**` | `src/lib`, `src/win`, Node | `electron`, React |
| `src/renderer/**` | `src/lib`, React, shadcn (`src/renderer/components/ui`) | Node, `electron` (only the preload API) |

## 2.3 An exam from start to end

```
Teacher laptop                         Lab computer (ExamMode)                    Guard
──────────────                         ───────────────────────                    ─────
open run → beacon "Y10 ICT, Ms Leak"
                                        hears beacon → 01 lists it
                                        join(name, code) ───────────────►
◄── check name in class, not taken, code ok
attempt = checking ──────────────────►  token
                                        checks (§2.4 step 1) → 02 ── checks ──►
                                        "close Chrome, Discord, Notepad?" (student)
                                        lock(examPlan) ─────────────────────────► journal + apply
                                        AppBar, hooks, process guard on → 03
◄── ready
Start ──────────────────────────────►   started(endsAt) → 04; copy given files
                                        heartbeat every 2 s ─────────►
                                        events (app closed, page blocked) ────►
                                        backup every 2 min (changed files) ───►
                                        Hand in → files ───────────────►
◄── verify SHA-256 → receipt ─────────►  09b receipt
                                        Finish → unlock ────────────────────────► undo journal
                                        delete the Exam folder (after the receipt)
```

## 2.4 Locking a lab computer

### Step 1: checks (F-04, F-05), no changes yet

| Check | How |
|---|---|
| One screen | `screen.getAllDisplays().length === 1`; `display-added` is watched during the exam too (it becomes a warning) |
| No remote control | `GetSystemMetrics(SM_REMOTESESSION)`; processes on the remote-tools list (AnyDesk, TeamViewer, RustDesk, Quick Assist, Chrome Remote Desktop, VNC servers) |
| Not a virtual machine | the computer's maker and model and the BIOS (`Win32_ComputerSystem`, `Win32_BIOS`: VMware, VirtualBox, QEMU, Hyper-V *Virtual Machine*, Parallels) |
| Apps to close | the process guard's decision (§2.5) for every process with a visible window; unsaved hints from window titles (`*`, `•`) |

### Step 2: the plan

`src/lib/lockdown/plan.ts` turns the exam's rules and profiles into a **lockdown plan**, a list of reversible changes. It is pure, so it can be tested.

| Change | Done by | Undone by |
|---|---|---|
| Firewall: our rule group; outbound blocked except ExamMode, the teacher, DNS, DHCP (§2.6) | Guard | removing our group; restoring the saved default outbound action |
| User policies (HKU\\\<user SID\>): `DisableTaskMgr`, `DisableLockWorkstation`, `DisableChangePassword`, `NoLogoff`, `NoRun`, `NoWinKeys` | Guard | restoring the saved values (or deleting what we added) |
| Machine policies: `AllowClipboardHistory=0`, `AllowCrossDeviceClipboard=0`, `HideFastUserSwitching=1`, Copilot and Recall off | Guard | as above |
| Each app profile's policies (Office's connected experiences off, …) | Guard | as above |
| Explorer stopped | Guard | starting `explorer.exe` in the user's session (`WTSQueryUserToken` + `CreateProcessAsUser`) |
| ExamMode starts when Windows starts (`Run` key) during the exam (F-20) | Guard | replaced by a one-time `RunOnce … --resume` if the student stopped suddenly (below); otherwise deleted |
| AppBar registered; keyboard and window hooks; process guard; clipboard emptied | ExamMode | ExamMode (they end with the process anyway) |

### Step 3: the journal (D9, N-04)

`C:\ProgramData\ExamMode\journal.json`. The Guard writes each change *before* making it: `{ id, kind, target, before, after, at }`. Then:

- **unlock** (hand-in, leave, end, the teacher's *unlock*) → undo every entry in reverse order → delete the journal;
- **ExamMode's process ends without unlocking** (the Guard watches its process handle) → the Guard reports *stopped suddenly* to the teacher (§2.8), undoes the journal, then **starts ExamMode again** in the user's session with `--resume <run>`. ExamMode joins, is refused, and shows 10 (F-20);
- **at every boot**, the Guard undoes a journal that is still there; its `RunOnce … --resume` entry brings ExamMode back to 10 when Windows has started.

So a computer is never left locked with no ExamMode on it, and a student who stopped suddenly always sees why. If the teacher lets them back in (F-18), ExamMode simply locks again.

**The pipe:** the Guard listens on `\\.\pipe\exammode-guard`. It accepts a client only if the client process's image is the installed `ExamMode.exe` in Program Files, which only an administrator can change (and, in a signed build, its signature: R10). Messages are `lock(plan)`, `unlock`, `status`, `watch(pid, teacher, token)`; the token lets the Guard's `stopped` prove which attempt it is about.

## 2.5 The process guard

The question for every window that appears: **may it stay?** It is decided in `src/lib/guard/decide.ts`, a pure function.

```ts
decide(proc: ProcInfo, ctx: { allowed: AppProfile[]; ancestors: ProcInfo[]; always: SystemList }): Decision
// ProcInfo: { pid, image (full path), signer?, product?, hasWindow, parentPid }
// Decision: { allow: true, why } | { allow: false, why, kind: 'app' | 'remote' | 'browser' }
```

**Rules, in order:**
1. Windows' own processes on the **system list** (`dwm.exe`, `ctfmon.exe`, `TextInputHost.exe`, the IME…) are allowed. The list is data, matched by path in `%SystemRoot%` and signer *Microsoft Windows*, and made from the recordings in M0. Windows' own apps that are a way out (Search, Settings, Widgets) aren't on it.
2. **ExamMode** itself (the installed copy, D10) is allowed.
3. A process that **matches an allowed profile** (signer + file name + path pattern) is allowed.
4. A process whose **ancestor matches an allowed profile** is allowed if that profile allows its children (`python.exe` from VS Code), and it is never a browser or remote tool.
5. Anything else **with a visible window** is closed: `TerminateProcess` and an `appClosed` event. Background processes are closed only if they are on the **always-close list** (remote tools, local AI runners such as Ollama and LM Studio, screen recorders).

**How fast (N-02):** a `SetWinEventHook(EVENT_OBJECT_SHOW)` in the hook worker reports a new window within milliseconds. A sweep with `EnumWindows` every 500 ms catches anything missed. Signer checks are cached by path and file timestamp, so a decision takes well under 1 ms after the first.

**Keyboard (F-14):** a `WH_KEYBOARD_LL` hook in the hook worker swallows LWin/RWin, Ctrl+Esc, Alt+Esc and Alt+Space on the bar, and passes everything else through. Ctrl+Alt+Del can't be hooked, so the user policies in §2.4 empty its screen of Task Manager, Lock, Switch user and Sign out.

**Alt+Tab:** left alone. Every window it could reach is allowed (rule 5), so it moves only between the exam's windows.

## 2.6 The network rules

| Layer | What it allows | How |
|---|---|---|
| **Firewall** (Guard) | `ExamMode.exe` and `ExamModeGuard.exe` to the teacher's laptop; `ExamMode.exe` to the internet on ports 80 and 443 **only when the exam has websites**; DNS (through Windows' DNS Client service) and DHCP; nothing else | our own rule group `ExamMode`; the profile's default outbound action set to *block* for the exam and restored afterwards; the school's rules untouched (R8) |
| **Exam browser** (ExamMode) | only the exam's websites: a whole site (`docs.python.org/*`) or one page | `session.webRequest.onBeforeRequest` on the browser's own partition: the main frame, frames and fetches are checked against the list. A blocked main-frame navigation shows *This page isn't part of the exam* (07b) and sends a `pageBlocked` note. When the teacher adds a site, the teacher's laptop opens it once and records the other hosts it loads (fonts, its CDN): these are allowed for the site's files, never as pages |
| **ExamMode's own traffic** | the teacher's laptop | — |

The exam browser exists **only when the exam has websites** (Q14). With the questions on paper, the default, there is no browser window, no *Questions* button, and ExamMode reaches only the teacher's laptop.

The browser window has no address box, no DevTools, no downloads, no extensions, no pop-ups outside the list, and its own partition that is wiped at the end.

**The teacher's laptop** must accept connections on 47800: the first time teacher mode opens a run, ExamMode asks for the system's permission (the Windows Defender Firewall prompt, or macOS's *accept incoming connections*).

## 2.7 The classroom protocol

**Finding exams (F-01):** the teacher's laptop sends a UDP broadcast to port 47801 every 2 s: `{ v, runId, title, teacher, class, port, teacherKeyFp }`. A student's ExamMode listens and lists what it hears. If nothing arrives, the student can type the teacher's computer name.

**Everything else** goes over HTTP + WebSocket on port 47800. Messages are **zod schemas** in `src/lib/protocol`, shared by both sides. Every message carries `v` (the protocol version), and an old client is told to update.

| From student | Meaning |
|---|---|
| `join { runId, studentId, code, pc, instanceId, bootId }` | ask to join; `instanceId` is new for every ExamMode start, `bootId` for every Windows boot |
| `resume { token, instanceId, localLog }` | back after a network gap: the same ExamMode, with its record of the gap |
| `checks { results }` | the checks of 02 |
| `ready` | locked |
| `beat { seq, front }` | every 2 s: the app in front |
| `event { kind, details }` | `appClosed`, `pageBlocked`, `displayAdded`, `ruleChanged` … |
| `leave` | the student confirmed 08 |
| `backup` / `handIn` (HTTP, multipart) | files with their SHA-256 |

| From teacher | Meaning |
|---|---|
| `joined { token, attempt }` / `refused { reason }` | the reply to `join`; `reason` is `codeWrong`, `nameTaken`, `left` … |
| `start { endsAt }`, `time { endsAt }` | start; added time |
| `letBackIn`, `end`, `unlock` | the teacher's decisions |
| `receipt { code, files }` | the hand-in was checked |

**Guard → teacher:** a single `stopped { token, pc, instanceId, at }` sent over HTTP when ExamMode's process ends without unlocking; the token (from `watch`) proves which attempt it is about. It is what makes 13b's *stopped suddenly* certain, and not just *no contact*.

## 2.8 Left, stopped suddenly, or no contact

This is the rule behind F-15, F-18, F-19 and F-20, a pure function on the teacher's side: `src/lib/session/attempt.ts`.

| What the teacher's laptop sees | State | Why |
|---|---|---|
| `leave`, `stopped` or a lost connection **before Start** (*checking* or *ready*) | back to **not joined** | the exam hadn't started; they can join again (F-18) |
| `leave` | **left** (*pressed Leave*) | the student confirmed |
| the Guard's `stopped` | **left** (*stopped suddenly*) | ExamMode's process ended without unlocking (Q5) |
| no `beat` for 10 s | **no contact** | could be the network (Q6); nothing is decided yet |
| `resume` with the attempt's token and the **same** `instanceId` | **in the exam** + a *gap* in the log, with its `localLog` | ExamMode ran all along: not leaving |
| `join` with a **new** `instanceId` while the attempt was *in the exam* or *no contact* | **left** (*stopped suddenly*) + the join **refused** (*waiting for you*) | ExamMode was restarted, so it had stopped; a new `bootId` adds *the computer was restarted* |
| `join` on any computer when **left** | **refused**, the teacher told (*asks to come back*) | F-18 |
| the teacher's **Let back in** | the pending join is accepted → **in the exam**; the time out of the exam is logged | F-40 |

The **students' clocks aren't trusted.** `endsAt` comes from the teacher, and each client measures the offset to the teacher's clock when it joins.

## 2.9 Files: the Exam folder, backups, hand-in

- **Exam folder:** `C:\Users\<shared user>\Documents\ExamMode\<run>\<student>\`, made at Start and filled with the given files. Allowed apps open in it (profiles pass it as the working folder or argument). *Exam folder* in the bar opens a read-only list of it inside ExamMode, not File Explorer.
- **Backups (F-22):** every 2 minutes ExamMode sends the files that changed (by size + modified time, then SHA-256) to the teacher's laptop. The teacher keeps the latest copy per file.
- **Hand-in (F-16):** ExamMode asks each open allowed app to save (Office through its profile's save command; otherwise a prompt in 09). It sends every made or changed file. The teacher's laptop checks every SHA-256, stores the files in `Hand-ins\<exam>\<student>\`, and answers with a **receipt**: 6 characters from the hash of (run, student, file hashes), shown as `HX7-29Q`.
- **Leaving / stopped suddenly:** the latest backup *is* the hand-in, marked as such (14).
- **Afterwards (F-21):** ExamMode deletes the Exam folder only once the teacher has confirmed it has the files: a receipt, including the automatic hand-in at time up or *End the exam*. A folder left behind by a crash is deleted by the next ExamMode start, once the teacher confirms it has the files.

## 2.10 App profiles

Data files in `profiles/*.json`, checked by a zod schema in `src/lib/profiles`:

```json
{
  "id": "vscode",
  "name": "VS Code",
  "match": { "files": ["Code.exe"], "signer": "Microsoft Corporation", "paths": ["%LOCALAPPDATA%\\Programs\\Microsoft VS Code", "%ProgramFiles%\\Microsoft VS Code"] },
  "launch": { "args": ["--user-data-dir", "{examProfile}/data", "--extensions-dir", "{examProfile}/ext", "{examFolder}"] },
  "prepare": [{ "copyExtensions": ["ms-python.python"] }, { "settings": { "telemetry.telemetryLevel": "off", "extensions.autoUpdate": false, "chat.disableAIFeatures": true } }],
  "policies": [],
  "children": { "allow": ["python.exe", "py.exe", "conhost.exe", "powershell.exe", "cmd.exe"], "never": ["browser"] },
  "save": "none"
}
```

| Profile | What it turns off |
|---|---|
| Word, Excel, PowerPoint, Access, Project | connected experiences, Copilot, add-ins, online templates and pictures, sign-in, *Open from cloud* (Office policies under `HKU\<SID>\Software\Policies\Microsoft\Office\16.0`) |
| VS Code | its own profile folder (the JSON above), allowed extensions only, no Copilot, Settings Sync, Live Share or extension installs |
| Python IDLE, Thonny | Thonny's package installs; children: their Python |
| OneEditor, MicroLab | update checks; MicroLab's PyPI installs; later an `--exam` argument (Q10) |
| *no profile* | only allowed to run: matched by its .exe path and signer; no policies |

**The app inventory (F-31a):** each lab computer's ExamMode reports its installed apps (the uninstall registry keys and App Paths) when it starts. The teacher's laptop keeps the last report per computer, which gives *on 24 of 26 computers*.

## 2.11 The teacher's data

SQLite in the teacher's app data folder, through Drizzle:

| Table | Columns (main) |
|---|---|
| `classes` | id, name |
| `students` | id, classId, name, email? (unique in a class), number? |
| `exams` | id, title, classId, minutes, apps (json: profile ids + custom apps), websites (json), rules (json), updatedAt |
| `exam_files` | examId, name, bytes, sha256 |
| `runs` | id, examId, code, openedAt, startedAt, endsAt, endedAt |
| `attempts` | id, runId, studentId, state, pc, instanceId, bootId, joinedAt, leftAt, leftHow, extraMinutes, warnings, handedInAt, receipt |
| `events` | id, runId, studentId?, pc?, at, kind, details (json) — **append only** |
| `handin_files` | attemptId, name, bytes, sha256, kind (`handIn` · `timeUp` · `backup`), at |
| `inventory` | pc, apps (json), at |

## 2.12 Trust: teacher licence and the teacher's key

As in MicroLab (its Rev 16, §1.16), reusing its author key and `npm run licence` tool:

1. The **author's public key** is built into ExamMode. The private key stays on the author's computer.
2. *I'm a teacher…* makes a key pair on the teacher's laptop and sends a request. The author signs a **teacher licence** (`.emlicence`).
3. The teacher's laptop **signs its beacon and its replies**. A student's ExamMode checks the author's signature on the licence and the teacher's signature on the messages, and **pins the teacher's key for the run**, so another laptop can't take over a run halfway through (F-44).

This comes in a late milestone (M7). Until then, development builds accept an unsigned teacher behind a build flag.

## 2.13 Project structure

```
exammode/
├── design/                     # the approved prototype (build.py, src/, screens/)
├── docs/                       # 01 requirements, 02 architecture, MILESTONES, acceptance/
├── profiles/                   # app profiles (§2.10) — data
├── src/
│   ├── lib/                    # pure TypeScript — no Electron, Node or DOM (D4)
│   │   ├── session/            # attempt state machine, stop classification (§2.8), time
│   │   ├── guard/              # decide() (§2.5), system and always-close lists
│   │   ├── lockdown/           # the plan (§2.4), journal entries and their undo
│   │   ├── protocol/           # zod messages (§2.7), versions
│   │   ├── profiles/           # profile schema, matching, launch arguments
│   │   ├── files/              # changed files, receipt codes
│   │   └── exam/               # exam and class rules, CSV import and export
│   ├── win/                    # WinApi: koffi adapters (windows, processes, hooks, AppBar, registry, displays)
│   ├── main/
│   │   ├── student/            # session client, lockdown, process guard loop, launcher, exam browser, files
│   │   ├── teacher/            # server, beacon, store (Drizzle), hand-ins
│   │   └── shared/             # windows, updates, IPC
│   ├── guard/                  # ExamModeGuard.exe, the Windows service: pipe, journal, firewall, policies, Explorer, watchdog
│   ├── preload/
│   └── renderer/
│       ├── components/ui/      # shadcn/ui components (generated, themed)
│       ├── student/            # 01–10b
│       └── teacher/            # 11–14
├── tests/
│   ├── unit/                   # src/lib
│   ├── integration/            # server ↔ simulated students on localhost; Guard journal on a temp folder
│   ├── windows/                # real WinApi on Windows (CI windows-latest, a lab computer): windows, hooks, firewall, registry
│   ├── acceptance/             # whole stories with simulated students (§MILESTONES 3)
│   ├── component/              # React screens with Testing Library
│   └── e2e/                    # Playwright for Electron
├── spikes/                     # M0 only; never imported by src/
└── scripts/                    # packaging, licences, simulated classroom
```

## 2.14 Commands

| Command | Does |
|---|---|
| `npm run dev` | ExamMode in development (`--teacher` or `--student`; the student's lockdown is **off** unless `--lock`) |
| `npm run class -- --students 30` | a **simulated classroom**: 30 fake students joining, working, leaving, crashing, for the teacher side |
| `npm test` | unit tests |
| `npm run test:all` | unit · integration · acceptance · component (· windows on Windows) |
| `npm run e2e` | build, then Playwright |
| `npm run check:quick` | lint · type-check · unit — the `pre-commit` hook |
| `npm run check` | lint · type-check · `test:all` with coverage · build — must pass before every merge into `main` |
| `npm run check:win` | `check` + the `windows` tests — on GitHub's `windows-latest` (as admin), or any Windows computer |
| `npm run dist` | the installers: Windows (NSIS, for the whole computer: ExamMode + the Guard service, needs admin) and macOS (a signed `.dmg`, teacher side) |
| `npm run unlock` | **emergency**: run as admin on a lab computer to undo a journal by hand |

## 2.15 Where to add things

| To add | Change |
|---|---|
| An app profile | a JSON file in `profiles/` + a test that its `match` finds the app's recorded process info (`tests/fixtures/procs/`) |
| A shortcut to block | `src/lib/guard/keys.ts` + its test |
| A background app to always close | `src/lib/guard/lists.ts` + its test |
| A message | `src/lib/protocol` (bump `v` if old clients can't ignore it) + both handlers + an integration test |
| A lockdown change | `src/lib/lockdown/plan.ts` (with its undo) + `src/guard` executor + a windows test that applies and undoes it |
| A screen | prototype first, then `src/renderer/...` with shadcn components |
