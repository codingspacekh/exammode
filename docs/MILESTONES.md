# ExamMode — Milestones & TDD Workflow

How ExamMode is built, **in what order**, and **how each part is proven to work** before the next one starts.

- Requirements (F-12, N-04, Q5…): [`01-analysis-and-requirements.md`](01-analysis-and-requirements.md)
- System design (processes, lockdown, protocol, profiles): [`02-architecture.md`](02-architecture.md)
- UI prototype: [`../design/screens/index.html`](../design/screens/index.html) — approved 2026-11-10

*Revision 7 (2026-11-11): **M1 was started while M0's gate is still open** (the teacher chose *Start M1 now*): M1 is pure TypeScript and needs nothing from the lab run, which is still to do and still closes M0. M1's slices were built with profiles before the guard, because `decide()` needs their matching.*

*Revision 6 (2026-11-10): **CI on GitHub after all** (the teacher: *"let's create the GitHub repo and run CI on GitHub then"*) — no Windows virtual machine needed: every push to `dev` or `main` runs `check` on macOS and `check:win` on GitHub's `windows-latest`; the quick check stays as a local `pre-commit` hook (§4.3).*

*Revision 5 (2026-11-10): **checks run locally** to go faster (the teacher: *"can we run CI locally and GitHub only when we prepare for pilot"*): a git hook on every commit, `npm run check` on the Mac before merging, `npm run check:win` in a Windows virtual machine on the Mac. GitHub Actions stays dormant (run by hand only) until the pilot, in M8 (§4.3).*

*Revision 4 (2026-11-10): the teacher's laptop is a Mac (Q19): e2e runs a teacher on macOS with students on Windows from M3; M8 ships the teacher's side as a signed macOS `.dmg`, as MicroLab's. No Windows certificate (Q18).*

*Revision 3 (2026-11-10): a review before M0, in step with the documents' Rev 3: the Guard as its own program and ExamMode's Electron fuses (M0, M4); ExamMode comes back to screen 10 after stopping suddenly (M2, M4); a stop before Start isn't leaving (M1, M2); the teacher's side on macOS as well (M8).*

*Revision 2 (2026-11-10): the teacher's answers to Q12–Q15 — the repository is **public** from M0; the exam browser is optional (questions on paper by default); M0 checks whether the lab account is an administrator; N-13 (no configuration files) is in M6's gate.*

*Revision 1 (2026-11-10): first plan, for the teacher's comments. No code is written before it is agreed.*

---

## Contents

1. [Principles](#1-principles)
2. [The TDD workflow](#2-the-tdd-workflow)
3. [Testing strategy per layer](#3-testing-strategy-per-layer)
4. [Definition of Done and milestone gates](#4-definition-of-done-and-milestone-gates)
5. [Milestone overview](#5-milestone-overview)
6. [Milestones in detail](#6-milestones-in-detail)
7. [Requirement → milestone map](#7-requirement--milestone-map)
8. [Progress tracker](#8-progress-tracker)

---

## 1. Principles

1. **The riskiest thing first.** Windows hooks and the AppBar through koffi, stopping Explorer and starting it again, and the firewall from the Guard service (R1) are proven in a throw-away spike in M0, before anything is built on them.
2. **Build from the inside out.** First the rules, as pure TypeScript (M1). Then the classroom network with simulated students (M2). Then the screens (M3). Only then the locking (M4). Each layer rests on one that is already tested.
3. **The teacher's laptop decides (D5).** Who is in, who left, and who may come back is decided by tested pure functions on the teacher's side, never by a lab computer.
4. **A thin end-to-end slice early.** By M3 a teacher can open an exam, students can join, work and hand in, without locking yet. Later milestones *add* to a working app.
5. **The simulated classroom is the acceptance suite.** `npm run class` drives 30–40 fake students (join, work, leave, crash, lose the network, hand in) against the real teacher side. Every story in §6 is a scripted classroom.
6. **Always put the computer back (N-04).** Every lockdown change has its undo, tested in the same commit, and a windows test that applies it and undoes it.
7. **One gate per milestone.** A milestone is finished only when its **exit gate** passes (§4). The next one does not start before that.
8. **Design before UI.** A screen is built only from its approved prototype screen. A screen that isn't in the prototype is drawn and approved first.
9. **Small, always green.** Slices of an hour or two. `main` always passes `npm run check`.
10. **A Mac for most of it, Windows for the truth.** The rules, the network and the screens are developed and tested on the Mac. The `windows` tests run on **GitHub Actions' `windows-latest`** for every push and, at the gates, on a real lab computer. A Windows virtual machine is optional for development: ExamMode refuses virtual machines (F-04) unless it is a development build started with `--allow-vm`.

## 2. The TDD workflow

### 2.1 The cycle

```
        ┌──────────────┐
        │ 1. RED       │  Write ONE small test for the next behaviour. Run it. It must fail
        │              │  (and fail for the right reason).
        └──────┬───────┘
               ▼
        ┌──────────────┐
        │ 2. GREEN     │  Write the simplest code that makes it pass. Run ALL tests.
        └──────┬───────┘
               ▼
        ┌──────────────┐
        │ 3. REFACTOR  │  Clean up names, duplication, structure. Tests stay green.
        └──────┬───────┘  Commit.
               └──────────► next test
```

### 2.2 Double-loop TDD (feature level)

```
OUTER LOOP — acceptance test (slow, few)
  "F-18: a student whose ExamMode is killed is shown as left (stopped suddenly); joining again from
   another computer is refused and the teacher is told; after Let back in, the join is accepted and
   the time out of the exam is logged"
  ── written FIRST as a simulated-classroom script, fails until the whole feature works ──
        │
        ▼
  INNER LOOP — unit / integration tests (fast, many), red → green → refactor
    • attempt: in the exam + Guard 'stopped' → left (stoppedSuddenly)            (src/lib/session)
    • attempt: left + join (new instanceId) → refused('left'), event 'asksBack'
    • attempt: left + letBackIn → the pending join accepted, event with minutes out
    • server: 'stopped' over HTTP is accepted only with that attempt's token     (integration)
        │
        ▼
  outer test passes → feature done
```

### 2.3 Rules

| # | Rule |
|---|---|
| T1 | **No production code without a failing test first**, for `src/lib`, `src/main`, `src/guard` and `src/win`'s logic. |
| T2 | UI *behaviour* is test-driven (*Leave* stays disabled until the box is ticked). UI *looks* are checked against the prototype screen, not unit-tested. |
| T3 | Write a short **test list** before starting a feature: behaviours, edge cases and requirement IDs. Tick them off one by one. |
| T4 | **Every bug starts with a failing regression test** that reproduces it. |
| T5 | Test names carry the requirement ID: `describe('F-12 closing apps')`, `it('N-02 a new window is closed within 1 s')`. |
| T6 | **Every lockdown change ships with its undo** and a test that applies and undoes it, leaving the system as it was (N-04). |
| T7 | Windows behaviour is tested against **real Windows** (the `windows` project), never only against the fake `WinApi`. The fake must behave like the recordings in `tests/fixtures/`. |
| T8 | Keep the unit suite **under 10 seconds**. Sockets and files are `integration`; real Windows is `windows`; browser tests are `e2e`. |
| T9 | Commit on green. Small commits, the message starting with the milestone or ID: `M2 F-18: refuse a join after leaving`. |
| T10 | Spikes only in `spikes/`, never imported by `src/`, rewritten test-first. |

### 2.4 Worked example (F-20, a restart counts as leaving)

```ts
// 1. RED — tests/unit/session/attempt.test.ts
describe('F-20 stopped suddenly', () => {
  it('a join with a new instanceId while in the exam means ExamMode had stopped', () => {
    const a = attempt({ state: 'inExam', instanceId: 'i-1', bootId: 'b-1' });
    const r = onJoin(a, { instanceId: 'i-2', bootId: 'b-1', pc: 'PC-07' }, at('09:59'));
    expect(r.attempt.state).toBe('left');
    expect(r.attempt.leftHow).toBe('stoppedSuddenly');
    expect(r.reply).toEqual({ type: 'refused', reason: 'left' });
    expect(r.events.map(e => e.kind)).toEqual(['stoppedSuddenly', 'asksBack']);
  });
  it('a resume with the same instanceId after a gap is not leaving (Q6)', () => {
    const a = attempt({ state: 'noContact', instanceId: 'i-1' });
    expect(onResume(a, { instanceId: 'i-1', localLog: [] }, at('09:58')).attempt.state).toBe('inExam');
  });
});
// 2. GREEN — onJoin / onResume in src/lib/session/attempt.ts
// 3. REFACTOR — one transition table for every message; commit "M1 F-20: a restart counts as leaving"
```

## 3. Testing strategy per layer

| Layer | What is tested | Tools | How / target |
|---|---|---|---|
| `src/lib/session` | Attempt states, stop classification, time and extra time, late joiners | Vitest `unit` | Every row of §2.8 of the architecture is a test. **≥ 95 %** line + branch |
| `src/lib/guard` | `decide()`, keys to swallow, lists | Vitest `unit` | Recorded process lists from real lab computers (`tests/fixtures/procs/*.json`): Office, VS Code with Python, a renamed exe, remote tools. ≥ 95 % |
| `src/lib/lockdown` | The plan and the undo of every entry | Vitest `unit` | plan(exam) → entries; undo(apply(state)) = state. ≥ 95 % |
| `src/lib/protocol`, `profiles`, `files`, `exam` | Schemas, versions, profile matching and arguments, changed files, receipts, CSV | Vitest `unit` | ≥ 90 % |
| Server ↔ client | Join, beats, gaps, leave, stopped, hand-in, backups, discovery | Vitest `integration` | The real teacher server and real student session clients on localhost; files in temp folders |
| Guard (logic) | The journal: write, undo, undo at boot, a half-written entry | Vitest `integration` | A fake system (registry, firewall, processes) on a temp folder |
| `src/win` + Guard (real) | Windows, hooks, AppBar, processes, registry, firewall, Explorer | Vitest `windows` | **Only on Windows**: GitHub Actions' `windows-latest` (runs as admin, `npm run check:win`) and a lab computer at the gates. Every test leaves the machine as it found it |
| `src/renderer` | Behaviour of each screen | Vitest `component` + Testing Library | jsdom; the preload API faked |
| Stories | Whole classroom stories | Vitest `acceptance` | The simulated classroom (`scripts/class`) against the real teacher side |
| Whole app | A few key journeys | Playwright for Electron `e2e` | The built app; a teacher and two students on one machine (lockdown off), on the Mac and on CI; at the gates also a teacher on the Mac with students on a lab computer |
| Real lab | Locking, apps, the network, 26 computers | Manual, recorded in `docs/acceptance/M<n>.md` | M0 (spike numbers), M4, M5, M8 (classroom trial) |

### 3.1 Fixtures

| Fixture | Made from | Used for |
|---|---|---|
| `tests/fixtures/procs/*.json` | `npm run record:procs` on a lab computer: every process with path, signer, parent and window — idle, with Office open, VS Code running Python, Chrome, AnyDesk | `decide()` (M1), the fake `WinApi` (T7) |
| `tests/fixtures/inventory/*.json` | the installed apps reported by a lab computer and the teacher's laptop | Profile matching, Add an app (M5) |
| `tests/fixtures/classes/*.csv` | the gradebook's class export; a pasted list with odd spacing | Class import (M6) |
| `scripts/class/stories/*.ts` | one script per story in §6 | Acceptance (from M2) |
| The prototype's names and exam (`design/src`) | *Year 10 ICT — Term 1 practical exam*, the 26 students | The same data in e2e tests, so the app matches the approved screens |

## 4. Definition of Done and milestone gates

### 4.1 Definition of Done (every feature)

- [ ] Test list written; every item has a test that went red → green.
- [ ] Requirement ID in test names and the commit message.
- [ ] `npm run check` passes on the Mac (lint, type-check, unit, integration, acceptance, component, build); CI is green on GitHub (macOS `check`, Windows `check:win`).
- [ ] Coverage thresholds for the touched layer still met.
- [ ] Every lockdown change has its undo and its windows test (T6).
- [ ] Matches the prototype screen (if it has UI); fills the window at 1280, 1440 and 1920 wide (N-06).
- [ ] Uses only shadcn/ui components from `src/renderer/components/ui/` (N-07).
- [ ] No `TODO` left in the code.

### 4.2 Milestone exit gate (all must pass)

1. ✅ All Definition-of-Done items for every feature in the milestone.
2. ✅ The milestone's **automated acceptance tests** pass (and `npm run e2e` from M3 on).
3. ✅ The milestone's **manual checks** done by the teacher, with results noted in `docs/acceptance/M<n>.md`.
4. ✅ No open bugs marked *blocker*.
5. ✅ `dev` merged into `main`, tagged `v0.<n>.0`.

If a gate fails, fix forward inside the same milestone. **Do not start the next one.**

### 4.3 Branches

| Branch | Purpose |
|---|---|
| `dev` | Day-to-day work; every commit is green locally. |
| `main` | Only gate-passed milestones, merged from `dev` with `--no-ff` and tagged. |

| When | What | Where |
|---|---|---|
| every commit | `npm run check:quick`: lint, type-check, unit (≈ 20 s), by a git `pre-commit` hook | the Mac |
| every push to `dev` or `main` | `npm run check` on `macos-latest`; `npm run check:win` (`check` + the `windows` project) on `windows-latest` | GitHub Actions (`.github/workflows/ci.yml`) |
| the gates of M0, M4, M5, M8 | the manual checks | a real lab computer |

The repository is **public** on GitHub (`codingspacekh/exammode`, Q15), so the Actions minutes cost nothing. Releases are built by a separate workflow from M8.

## 5. Milestone overview

```
M0 Foundations + Windows spike ─► M1 The rules (pure) ─► M2 The classroom network (simulated students)
        ┌──────────────────────────────────────────────────────────────────────────┘
        ▼
M3 Walking skeleton (screens, exam browser, hand-in — no locking) ─► M4 Locking a lab computer
        ┌──────────────────────────────────────────────────────────────────────────┘
        ▼
M5 The apps (profiles, launcher, Add an app) ─► M6 The teacher's whole exam ─► M7 Teacher licence & trust
        ─► M8 Hardening & v1.0 (classroom trial)
        └─► later: a temporary Windows account per exam · hand-ins to the hand-in site · an online server
```

| # | Milestone | Main requirements | Size | Rough part-time weeks* |
|---|---|---|---|---|
| M0 | Foundations + Windows spike | tooling, test layers, Electron + React + shadcn shell, R1 | S | 1 |
| M1 | The rules | §2.8 (F-15, F-18–F-20), `decide()` (F-12), the lockdown plan (N-04), protocol, receipts | M | 1.5 |
| M2 | The classroom network | F-01–F-03, F-08, F-16 (transport), F-18–F-20, F-22, N-03 | M | 2 |
| M3 | Walking skeleton | F-09, F-10, F-13, F-16, F-17, F-36, F-37, F-38 (basic) — screens 01, 03, 04, 07b, 09, 09b, 12, 13 | M | 2.5 |
| M4 | Locking a lab computer | F-04–F-07, F-12, F-14, F-21, F-23, N-02, N-04 — screens 02, 07 | L | 3 |
| M5 | The apps | F-11, F-31, F-31a, §1.7 profiles, R4, R9 — screens 05, 06, 11b | L | 2.5 |
| M6 | The teacher's whole exam | F-15, F-18–F-20 (UI), F-30–F-43 — screens 08, 10, 10b, 11, 12–14 | L | 3 |
| M7 | Teacher licence & trust | F-44, §2.12 | S | 1 |
| M8 | Hardening & v1.0 | N-01, N-03, N-05, N-10, N-12, installer, updates, classroom trial | M | 1.5 |

\* *Very rough, for one maintainer working part-time: about 18 weeks in all. Re-estimate after M1.*

## 6. Milestones in detail

Each milestone lists: **goal · build order (TDD slices) · tests written first · exit gate.**

---

### M0 — Foundations + Windows spike

**Goal:** an empty but fully tested Electron project with React and shadcn/ui, and measured answers to R1. Can ExamMode, from Node, hook the keyboard and window events, reserve the top of the screen, stop and start Explorer, and change the firewall from a service, all reliably, and all undone afterwards?

**Build order**
1. `git init`, branches `dev` / `main`; a **public** GitHub repository (Q15); electron-vite with main · preload · renderer bundles; React; Tailwind v4; `shadcn init` (new-york, neutral, Phosphor icons, `cssVariables`), themed with the prototype's tokens (as the gradebook's `globals.css`); a placeholder window titled **ExamMode**.
2. Vitest projects `unit`, `integration`, `windows` (skipped off Windows), `acceptance`, `component`; coverage thresholds.
3. ESLint boundary rules (§2.2 of the architecture): `src/lib/**` imports nothing from `electron`, Node built-ins, `koffi`, React or the DOM.
4. Playwright for Electron with a smoke test; `npm run check:quick`, `npm run check`, `npm run check:win`, `npm run e2e`; the `pre-commit` hook; **CI on GitHub** (§4.3): `check` on macOS, `check:win` on Windows.
5. **Spike** in `spikes/windows/` (not test-first, T10), on a Windows 10 computer and a Windows 11 computer, measuring:
   - a `WH_KEYBOARD_LL` hook in a koffi **worker thread** with its own message loop swallows the Windows key and Ctrl+Esc; it survives 30 minutes of typing and isn't dropped by Windows' hook timeout;
   - `SetWinEventHook(EVENT_OBJECT_SHOW)` reports Notepad's window in **< 100 ms**; `TerminateProcess` closes it within 0.5 s in all;
   - an Electron window registered as an **AppBar** at the top: a maximised Word fills the space under it;
   - Explorer stopped and started again in the user's session by a service: the taskbar comes back each time;
   - the Guard as its own program (a Node single-executable application run by WinSW) sets the firewall's default outbound action to *block* with an allow rule for one program, and restores it; the same after a forced reboot;
   - the Guard starts a program in the user's session (`CreateProcessAsUser`): Explorer, and ExamMode with `--resume`;
   - with ExamMode's Electron fuses set (D10), `ELECTRON_RUN_AS_NODE=1 ExamMode.exe script.js` runs no script;
   - which user policies take effect immediately (`DisableTaskMgr`, `NoWinKeys` …) and which need a sign-out;
   - Windows Defender's reaction to all of the above.
6. Record a first set of process lists and installed apps from a lab computer (`tests/fixtures/procs`, `inventory`), and whether the shared account is an administrator (`whoami /groups`, Q12).

**Tests written first:** the smoke tests (the window opens and is titled ExamMode; a shadcn `Button` renders with the theme's accent); the boundary rule fails on a planted bad import.

**Exit gate:** CI green on GitHub (macOS and Windows) · the spike's numbers in `docs/acceptance/M0.md`, with **a decision on R1** (koffi in a worker, or a native helper for the hooks) · the lab account's rights recorded, and R2's plan chosen to match (Q12).

---

### M1 — The rules (pure TypeScript)

**Goal:** everything that decides right and wrong, headless and fully tested: the student's states, the stop classification, `decide()`, the lockdown plan with its undo, the protocol, receipts.

**Build order (slices)**
1. `src/lib/session`: the attempt state machine; every row of the architecture's §2.8; time, extra time, late joiners, the clock offset.
2. `src/lib/protocol`: zod schemas for every message; versions; a refusal for an old client.
3. `src/lib/guard`: `decide()` with the five rules of the architecture's §2.5, using the recorded process lists; the system and always-close lists; the keys to swallow.
4. `src/lib/lockdown`: plan(exam, profiles) → journal entries; undo of each entry kind; undo in reverse order; a half-written journal.
5. `src/lib/files`: changed files (size + time, then hash); the receipt code; the hand-in list (made · changed · given and unchanged).
6. `src/lib/profiles` (schema and matching only): match a recorded process to a profile; launch arguments with `{examFolder}`.

**Tests written first:** `F-20 a join with a new instanceId while in the exam means ExamMode had stopped` · `Q6 the same instanceId after a gap is not leaving` · `F-18 a join after leaving is refused and the teacher told` · `F-18 a stop before Start only takes the student off the list` · `F-12 a renamed cheat.exe doesn't match Word's profile` · `F-12 python.exe started by VS Code is allowed; chrome.exe started by VS Code is not` · `N-04 undo(apply(plan)) leaves every registry value as it was` · `F-16 the receipt is the same for the same files and different for one changed byte`.

**Exit gate:** `npm run check` green · ≥ 95 % coverage in `session`, `guard` and `lockdown` · the teacher reads the §2.8 table as tests (`docs/acceptance/M1.md`) and agrees it is right.

---

### M2 — The classroom network (simulated students)

**Goal:** the teacher's server and the student's session client, talking for real over the network, with no screens yet, proven by a simulated classroom of 40.

**Build order (slices)**
1. The teacher's **store** (SQLite + Drizzle): classes, exams, runs, attempts, events, hand-in files.
2. The **server**: HTTP + WebSocket on :47800; `join` with code, name from the class and *name taken*; `beat`; the §2.8 rules from M1 wired to messages; `start`, `time`, `end`, `letBackIn`; the Guard's `stopped`.
3. The **beacon** (UDP :47801) and the client's listener; the typed-in computer name as a fallback.
4. The **session client** (student side, `src/main/student`): join, beats, reconnecting with the same `instanceId`, the local record of a gap.
5. **Files**: backups every 2 minutes; hand-in with SHA-256 checks and the receipt; a backup becoming the hand-in on leaving.
6. **`npm run class`**: the simulated classroom (n students; scripted stories; random network drops).

**Tests written first (acceptance stories):** *30 students join, start, hand in → 30 receipts, 30 folders, the log complete* · *a student kills ExamMode → left (stopped suddenly); joins from another PC → refused; let back in → accepted* · *the network drops for 45 s → no contact, then in the exam with a gap; nothing lost* · *time up → every student handed in, marked time up* · *a wrong code and a name already taken are refused* · *ExamMode crashes in the lobby before Start → the student joins again normally*.

**Exit gate:** all M2 stories green · 40 simulated students on the teacher's laptop with every change seen within 2 s (N-03) · **on the real lab network**: a lab computer hears the beacon and joins (R3) — `docs/acceptance/M2.md`.

---

### M3 — Walking skeleton (screens, exam browser, hand-in; no locking)

**Goal:** the first usable app. A teacher opens an exam; students join, answer on the question page in the exam browser, and hand in. The computer isn't locked yet.

**Build order (slices)**
1. Student screens from the prototype: **01** Join, **03** Waiting (unlocked), **09** Hand in, **09b** Handed in.
2. The **exam bar** (04) as an ordinary always-on-top window for now, with the clock from the teacher.
3. The **exam browser** (04, 07b), only when the exam has websites: its own window and partition, tabs, no address box, the website filter, *This page isn't part of the exam*, the `pageBlocked` note.
4. Teacher screens: a minimal *open an exam* (title, class, questions on paper or websites), **12** Lobby with the code, **13** Live with cards and the feed.
5. End of the exam: hand in automatically at time up; the receipt on both sides.

**Tests written first:** component tests per screen (*Join is disabled until a name and 4 digits*; *Hand in lists made, changed, and given-unchanged files*) · e2e: *a teacher and two students on one machine: join, start, a blocked page, hand in, receipts match*.

**Exit gate:** e2e green · the screens match 01, 03, 04, 07b, 09, 09b, 12, 13 at 1280–1920 · the teacher runs a 10-minute trial with a few students on real lab computers (no locking) — `docs/acceptance/M3.md`.

---

### M4 — Locking a lab computer

**Goal:** the lock. The Guard service with its journal; checks; Explorer stopped; the exam bar as a real AppBar; the keyboard; the process guard; the firewall; and the computer always put back.

**Build order (slices)**
1. **The Guard**: `ExamModeGuard.exe` as a Windows service; the authenticated pipe; the journal (write before change, undo in reverse, undo at boot); `npm run unlock`.
2. **Executors**, one per journal entry kind, each with its windows test (T6): user and machine policies, the firewall group and default action, Explorer, the `Run` key.
3. **Checks** (02): one screen, remote control, virtual machine, the apps to close with unsaved hints.
4. **The exam bar as an AppBar**; the full-screen kiosk window for 01–03; the clipboard emptied (F-06).
5. **The hook worker**: the keyboard hook and the window-event hook (as decided in M0); the 500 ms sweep; the **process guard loop** calling `decide()`; the toast (07) and the `appClosed` event.
6. **The watchdog**: the Guard sees ExamMode's process end without unlock → `stopped` to the teacher → undo → ExamMode started again with `--resume` (screen 10).

**Tests written first:** `N-04 the Guard undoes a journal left by a killed ExamMode` · `N-04 the Guard undoes a journal at boot` · `F-12 Notepad started during the exam is closed within 1 s` (windows) · `F-14 the Windows key does nothing while locked` (windows) · `F-23 a program other than ExamMode can't reach the internet; the teacher's laptop is still reachable` (windows) · `F-21 after unlock, the firewall, policies and Explorer are as before`.

**Exit gate:** CI green on GitHub, the `windows` tests included · **on a real lab computer** (`docs/acceptance/M4.md`): the teacher tries every way out in the requirements' §1.6 (left column) and each one is stopped; ExamMode killed from an admin prompt → the teacher sees *stopped suddenly*, the computer is back to normal and ExamMode is back on screen 10; the power cord pulled during an exam → normal after boot, ExamMode on screen 10; `ELECTRON_RUN_AS_NODE` and `--inspect` do nothing with the installed ExamMode.exe (D10); Windows Defender quiet (R5); the school's firewall rules unchanged (R8).

---

### M5 — The apps

**Goal:** allowed apps that work in the exam and can't be used to get out: the profiles, the launcher, the Exam folder, and *Add an app*.

**Build order (slices)**
1. The **launcher**: start a profile's app in the Exam folder, maximised under the bar; the bar's tabs (bring to front, the dot when open) (05, 06).
2. **Profiles**, one slice each, every one with its policies and its undo: Word · Excel · PowerPoint · Access · Project · VS Code (its own profile, allowed extensions) · IDLE · Thonny · OneEditor · MicroLab.
3. **Children**: VS Code's Python and terminal; Office's helper processes; browsers never.
4. **Save before hand-in**: each profile's save command, or the 09 prompt.
5. The **app inventory** from each lab computer; **11b** Add an app (with or without a profile; *Choose a program file…*).

**Tests written first:** per profile, `match` on recorded process info and `launch` arguments (unit) · `F-11 Word opens Report.docx from the Exam folder, maximised under the bar` (windows, where Office is installed) · `F-12 a link in Word doesn't open a browser` · `F-31a an app on 24 of 26 computers says so`.

**Exit gate:** **the app matrix on a lab computer** (`docs/acceptance/M5.md`): for each profile, the app opens in the Exam folder, saves there, and each of its known ways out is tried and stopped (Office: Copilot, online pictures, Open from cloud, a hyperlink; VS Code: Copilot, an extension install, `start chrome` in the terminal; MicroLab: PyPI install); Office still opens with the internet blocked (R9).

---

### M6 — The teacher's whole exam

**Goal:** everything the teacher does, as in the prototype, and the student's remaining screens.

**Build order (slices)**
1. **Classes** (F-43): paste or import a spreadsheet; the gradebook's export.
2. **11** Make an exam in full: apps, websites (site or page), files to give, rules, the preview and its checks; save, copy, reopen.
3. **12** Lobby in full: check states and *can't start* reasons; *Show the code full screen*; late joiners.
4. **13** Live in full: counts that filter, list view, search, sound; **13b** the timeline with Let back in / Keep out and a reason; **Add time** (all or one); **End the exam**.
5. Student: **08** Leave, **10** Can't join again (opens by itself when let back in), **10b** No contact.
6. **14** After the exam: per-student folders, how and when, warnings, *Export the log (CSV)*.

**Tests written first:** component tests per screen · acceptance: *the teacher's whole exam with 26 simulated students, following the prototype's story (Dara's two warnings, Vannak's crash and return, Mealea's network gap, Rithy and Kosal early)*, ending in 14 with the same counts as the prototype.

**Exit gate:** acceptance and e2e green · every screen matches the prototype at 1280–1920 · **N-13**: the teacher makes a new exam from nothing in under 5 minutes, with no file edited by hand · the teacher makes and runs a real exam with one class (`docs/acceptance/M6.md`).

---

### M7 — Teacher licence & trust

**Goal:** only a verified teacher can run an exam, and a run can't be taken over (F-44, architecture §2.12).

**Build order:** *I'm a teacher…* and the request (as in MicroLab); the `.emlicence` and `npm run licence` (the author's tool, shared with MicroLab); signed beacons and replies; the student pins the teacher's key; development builds' unsigned mode removed from release builds.

**Tests written first:** `F-44 a beacon signed by an unlicensed key isn't listed` · `F-44 after joining, a message signed by another teacher's key is ignored` · `F-44 a licence for another computer's key is refused`.

**Exit gate:** tests green · the teacher requests a licence and runs an exam with it (`docs/acceptance/M7.md`).

---

### M8 — Hardening & v1.0

**Goal:** ready for every exam: fast on the slowest lab computer, installable by IT, updatable, tried in a real exam.

**Build order:** the **release workflow** on GitHub Actions (installers built and published there); performance on the i5 with 4 GB (N-02, N-10) and 40 students on the teacher's laptop (N-03); the **installers** (Windows NSIS: ExamMode + the Guard service, with a silent install for IT; a signed macOS `.dmg` for the teacher's Mac, with the same certificate as MicroLab's, N-01, Q19); updates, About ExamMode, What's new and the app icon, as in the other apps (N-12); a user guide and a one-page *if something goes wrong* (`npm run unlock`, let back in); the **classroom trial**.

**Exit gate:** budgets met on the i5 · installed on every lab computer by the silent installer · **a real exam run with ExamMode**, the teacher's notes in `docs/acceptance/M8.md` · tagged `v1.0.0`.

## 7. Requirement → milestone map

| Requirement | M |
|---|---|
| F-01 find exams · F-02 name from the class · F-03 code | M2 (logic) · M3 (screen) |
| F-04 checks · F-05 apps to close · F-06 clipboard · F-07 locked | M4 |
| F-08 start together, late joiners | M2 · M3 |
| F-09 exam bar | M3 (window) · M4 (AppBar) · M5 (app tabs) |
| F-10 exam browser · F-13 blocked page | M3 |
| F-11 apps in the Exam folder | M5 |
| F-12 apps closed | M1 (`decide`) · M4 (loop) · M5 (profiles) |
| F-14 shortcuts out | M4 |
| F-15 leave · F-18 can't rejoin · F-19 no contact · F-20 stopped suddenly | M1 (rules) · M2 (network) · M4 (watchdog) · M6 (screens) |
| F-16 hand in · F-17 time up | M2 (transport) · M3 (screens) |
| F-21 back to normal | M4 |
| F-22 backups | M2 |
| F-23 no internet | M4 |
| F-30–F-35 make an exam · F-31a Add an app | M3 (minimal) · M5 (apps) · M6 (full) |
| F-36–F-41 lobby, live, timeline, time, end | M3 (basic) · M6 (full) |
| F-42 after the exam · F-43 classes | M6 |
| F-44 teacher licence | M7 |
| N-01 platform · N-10 speed · N-12 updates | M8 |
| N-02 closing within 1 s | M4 |
| N-03 40 students | M2 · M8 |
| N-04 always restored | M1 (plan) · M4 (Guard) |
| N-05 no work lost | M2 · M8 |
| N-06 layout · N-07 shadcn/ui | every UI milestone |
| N-08 offline · N-09 privacy · N-11 plain English | every milestone |

## 8. Progress tracker

| Milestone | Status | Tag | Notes |
|---|---|---|---|
| Prototype | ✅ approved 2026-11-10 | — | 21 screens (*"all good"*) |
| Requirements, architecture, milestones | ✅ agreed 2026-11-10 | — | every question answered; reviewed before M0 |
| M0 Foundations + Windows spike | 🔨 in progress | | Steps 1–4 done; the spike passes all 9 probes on GitHub's Windows Server 2022 and 2025 (`docs/acceptance/M0.md`); **waiting: the 30-minute run on a Windows 10 and a Windows 11 lab computer** |
| M1 The rules | 🔨 built; waiting for the teacher | | All six slices, test first: 206 unit tests, 100 % coverage of `src/lib` (`docs/acceptance/M1.md`); **waiting: the teacher reads the §2.8 table as tests** (M1.md §2, rows 9–16 need a yes or no) |
| M2 The classroom network | | | |
| M3 Walking skeleton | | | |
| M4 Locking a lab computer | | | |
| M5 The apps | | | |
| M6 The teacher's whole exam | | | |
| M7 Teacher licence & trust | | | |
| M8 Hardening & v1.0 | | | |
