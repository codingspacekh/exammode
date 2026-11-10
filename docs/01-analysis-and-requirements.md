# 1. System Analysis & Requirements

*Revision 1 (2026-11-10): first analysis, written after the prototype was approved (the teacher: *"all good"*). This app was designed in a different order from the gradebook, OneEditor and MicroLab: **prototype first**, then this document (the teacher: *"create the design prototype to see how it would turn out first, then create the system architecture and requirement, set up the milestone"*). Q1–Q11 are the defaults shown on the prototype's index page, now agreed. Still-open questions are in §1.9.*

*Revision 2 (2026-11-10): the teacher's answers. **Q13**, why not Safe Exam Browser: *"it needs too many configurations, the workflow however didn't suit mine"* → ExamMode needs **no configuration files**; an exam is set up in its own screens in a few minutes (N-13). **Q12**: *"open use computer only, no account required, but each student has their own school email"* → a class list may carry each student's **school email**, which identifies them (F-02, F-43); signing in to Office or OneDrive with it stays off in an exam (§1.7). Whether the shared account is an administrator is checked on a lab computer in M0. **Q14**: *"exam questions generally on paper but their work is on computer … ICT, including code and office, design app"* → the **question website is optional** and off by default: with no websites there is no exam browser (F-10, F-32). **Q15**: the repository is **public** now.*

*Revision 3 (2026-11-10): a review of all three documents before M0. Fixes: ExamMode starts again by itself after stopping suddenly (F-20 had said only *at the next sign-in*, and the computers have no sign-in); leaving or stopping **before Start** doesn't lock a student out (F-18); the apps used last time are listed first, as the prototype shows (F-31); no app reaches the internet unless the exam has websites (F-23); the **teacher's side runs on Windows or macOS** in v1 (N-01) — it has no Windows-only parts; the Guard is its own program, so ExamMode can't be used to run other code through the firewall (§1.10, architecture D3); a new risk about installing without a Windows code-signing certificate (R10, Q18).*

*Revision 4 (2026-11-10): **Q19** — the teacher's laptop is a **Mac**: the teacher's side is built and tested on macOS first (Windows still works). **Q18** — no Windows code-signing certificate: R10's plan (installed in Program Files; SmartScreen warns once at install). **Q17** — *"OneEditor is the only one"*: the only design app in exams is OneEditor, which has a profile. Every question is now answered.*

Name: **ExamMode**. UI prototype: [`../design/screens/index.html`](../design/screens/index.html).

---

## Contents

1. [1.1 Problem](#11-problem)
2. [1.2 Stakeholders & scope](#12-stakeholders--scope)
3. [1.3 Domain analysis](#13-domain-analysis)
4. [1.4 Functional requirements](#14-functional-requirements)
5. [1.5 Non-functional requirements](#15-non-functional-requirements)
6. [1.6 What ExamMode can and can't stop](#16-what-exammode-can-and-cant-stop)
7. [1.7 Apps and exam profiles](#17-apps-and-exam-profiles)
8. [1.8 Risks](#18-risks)
9. [1.9 Decisions & open questions](#19-decisions--open-questions)
10. [1.10 Proposed way to build it](#110-proposed-way-to-build-it)

---

## 1.1 Problem

Practical ICT exams happen on the school's lab computers. During an exam a student can open a browser, a chat app, a file left on the computer, or an AI tool, and copy what they find. The teacher can't watch 26 screens at once.

The teacher tried **Safe Exam Browser** first: *"it needs too many configurations, the workflow however didn't suit mine"* (Q13). Their requirements are:

- During an exam, students can use **only the apps the exam needs**. Today that means Office (Word, Excel, PowerPoint, Access, Project), an IDE (VS Code), the school's own apps (OneEditor, MicroLab), and, when the questions are online, a browser limited to the exam's pages. Next term it may be a different set.
- Every other app **can't be opened** until the student leaves the exam.
- A student who **leaves can't join again**.
- **Little to set up.** An exam is made in a few minutes in ExamMode's own screens: no configuration files, no keys to copy, nothing to set on each lab computer after the one install.

The questions are usually **on paper**; the work is done **on the computer**, in the subject's apps (ICT: code, Office, design) (Q14).

## 1.2 Stakeholders & scope

| Who | Needs |
|---|---|
| **Student** (Years 7–12, a lab computer) | A plain way into the exam; the apps and files it needs; clear warnings; work that is never lost; a receipt when they hand in |
| **Teacher** (their own laptop, in the room) | Make an exam once and reuse it; see every student live; decide who comes back after a crash; collect every hand-in, with a log |
| **School IT** (or the teacher) | Install it once on each lab computer; the computers always go back to normal afterwards |
| **Author** (CodingSpaceKH) | Verifies teachers (Q8), as for MicroLab |

**In scope (v1):** Windows lab computers; one teacher's laptop running the exam over the classroom network; the allowed apps chosen for each exam; hand-ins to the teacher's laptop.

**Not in scope (v1):** webcam or screen recording (Q9); stopping phones or other devices (§1.6); writing or marking the questions, which are on paper or on a website the teacher already uses (Q3, Q14); macOS students; running exams from a server on the internet (Q4).

## 1.3 Domain analysis

### The lab

From MicroLab's requirements (Rev 14–15): the school's computers run **Windows 10 (22H2) or 11, 64-bit**. They are **open-use computers**: one shared Windows account, no sign-in. Every student has their own **school email** (Q12). The weakest has an **Intel Core i5 with 4 GB of RAM**, and every one has a **24-inch 1920 × 1080 screen**. Anyone using a computer can see every file on it. The teacher is in the room with their own laptop, on the same network.

### Two computers, three parts

| Part | Runs on | Job |
|---|---|---|
| **ExamMode, student side** | each lab computer | Join, run the checks, lock the computer, show the exam bar, open the allowed apps, hand in |
| **ExamMode Guard** (a Windows service) | each lab computer, installed once with admin rights | The jobs a normal app isn't allowed to do: firewall rules, Windows policies, starting and stopping Explorer, putting the computer back afterwards, reporting if ExamMode is killed |
| **ExamMode, teacher side** | the teacher's laptop | Make exams and classes, run the exam over the network, the live view, collect hand-ins, keep the log |

It is one app. Teacher mode is switched on by a teacher licence (Q8, F-44).

### Entities

| Entity | Key fields |
|---|---|
| **Class** | name, students (name, school email (optional, unique), optional student number) |
| **Exam** | title, class, time, allowed apps (profiles, or apps added by their .exe), websites (optional: none when the questions are on paper), files to give, rules |
| **Run** | one sitting of an exam: code, opened, started, ends, ended, extra time |
| **Attempt** | a student in a run: state, computer, joined, warnings, left, how they left, let back in (who, when, why), handed in, receipt |
| **Event** | append-only: time, student, computer, kind, details — the log (F-39, F-42) |
| **App profile** | how to recognise an app (publisher, file name, install path), how to start it in an exam, what to turn off, the child processes it may start (§1.7) |
| **Hand-in** | an attempt's files, their sizes and SHA-256, how they arrived (button, time up, left) |

### A student's states (the five colours in the prototype)

```
 not joined ──Join──► checking ──checks pass──► ready ──Start──► in the exam ──Hand in / time up──► handed in
                       │  ▲                                         │
                       └──┘ a check fails: it says why;              ├── no beats ──► no contact ── beats again ──► in the exam
                            the student fixes it and checks again    │                               (a gap in the log)
                                                                     ├── Leave (confirmed) ─────────► left
                                                                     └── ExamMode stopped suddenly ─► left ── Let back in ──► in the exam

 Before Start, leaving or stopping only takes the student off the list: they can join again (F-18).
```

**Warning** isn't a state. It is a count on a student who is *in the exam*, shown amber.

## 1.4 Functional requirements

MoSCoW: **M** must · **S** should · **C** could. Screens refer to the prototype.

### Joining (student)

| ID | Requirement | Pri | Screen |
|---|---|---|---|
| F-01 | ExamMode finds the exams open on the **classroom network** by itself. If none are found, the teacher's computer name can be typed in | M | 01 |
| F-02 | The student picks **their name from the class list**; two students with the same name are told apart by their school email. A name already in this run on another computer can't be picked | M | 01 |
| F-03 | The student types the **exam code** the teacher shows. A wrong code is refused | M | 01 |
| F-04 | **Computer checks** before the exam can start: one screen only, no remote-control apps running, not inside a virtual machine. A failed check says how to fix it and is shown to the teacher | M | 02, 12 |
| F-05 | Apps that aren't allowed are **listed before they are closed**, with any unsaved file marked, so the student can save first | M | 02 |
| F-06 | The clipboard is **emptied** at the start and at the end. Clipboard history (Win+V) is off during the exam | M | 02 |
| F-07 | After the checks the computer is **locked**: ExamMode fills the screen, and the Windows taskbar, Start menu and desktop are gone | M | 03 |
| F-08 | The exam starts on every computer at once when the teacher presses **Start**. The time is counted from Start. A student who joins late gets the time that is left | M | 03, 12 |

### In the exam (student)

| ID | Requirement | Pri | Screen |
|---|---|---|---|
| F-09 | The **exam bar** is always across the top of the screen and can't be covered. It shows EXAM, the exam's title, the student's name and computer, a button per allowed app (with a dot when it is open), the connection, the time left, *Exam folder*, *Hand in…* and ⋯ | M | 04, 05 |
| F-10 | **If the exam has websites**, the **exam browser** opens the first of them. It has tabs but no address box, and opens only the exam's websites, each either a whole site or a single page. With no websites (questions on paper, the default) there is no browser and no Questions button | M | 04, 07b |
| F-11 | Allowed apps open **in the space under the bar**, maximised, working in the student's **Exam folder**, which holds the teacher's files | M | 05, 06 |
| F-12 | An app that isn't allowed is **closed within 1 second** (N-02). The student is told and the teacher sees it. An app is recognised by its publisher and install path, not its name | M | 07 |
| F-13 | A page that isn't allowed doesn't open. The browser says why, and the page is a **note** in the teacher's log, not a warning | M | 07b |
| F-14 | **Shortcuts out** do nothing: the Windows key, Win+R, Win+E, Ctrl+Esc, Alt+Esc, Task Manager, Lock, Switch user, Sign out. Alt+Tab moves only between the exam's own windows | M | 05 |
| F-15 | **Leave the exam** (⋯ menu) explains that the student can't come back, and asks them to tick to confirm. Their work so far is handed in as it is | M | 08 |
| F-16 | **Hand in** lists the files that will go (made or changed in the Exam folder, with given-but-unchanged files listed separately) and saves open files first. The files are sent to the teacher and checked by SHA-256. The student gets a **receipt** with a short code that also appears on the teacher's list | M | 09, 09b |
| F-17 | When the time is up, every student's work is **handed in automatically** | M | 09b, 14 |
| F-18 | A student who left **after Start** **can't join this run again** on any computer (before Start, leaving or stopping only takes them off the list). The teacher is told when they try. If the teacher lets them back in, the exam **opens on that computer by itself** with their files | M | 10, 13b |
| F-19 | **Losing the network is not leaving**: the computer stays locked, the clock keeps going, work is saved locally, and ExamMode keeps its own record of the gap, which it sends when contact returns | M | 10b |
| F-20 | ExamMode **stopping suddenly** (killed, crashed, the computer switched off) counts as leaving. ExamMode then **starts again by itself** (at once after a kill or a crash; when Windows starts again after a power cut), says so (10), and asks the teacher | M | 10, 13b |
| F-21 | Afterwards the computer goes **back to normal**: taskbar, settings, firewall and policies all restored. The Exam folder is removed from the lab computer once the teacher has the work | M | 09b |
| F-22 | The Exam folder's changed files are **copied to the teacher every 2 minutes**, so a crash or a kill never loses more than 2 minutes of work | S | 13b |
| F-23 | **No app reaches the internet** during the exam. The one exception is the exam browser, and only when the exam has websites, and only to them. ExamMode stays in touch with the teacher's computer | M | 11 |

### Running exams (teacher)

| ID | Requirement | Pri | Screen |
|---|---|---|---|
| F-30 | **Make an exam**: title, class, time. Saved, and can be opened again and copied | M | 11 |
| F-31 | **The apps for this exam** are chosen each time, never built in. The apps used last time are listed first, then the other apps with an exam profile; *Add an app* for the rest (§1.7) | M | 11 |
| F-31a | **Add an app** lists the apps installed on the lab computers and how many computers have each, or adds a program by its .exe. An app without a profile is *only allowed to run* | S | 11b |
| F-32 | **Questions**: *on paper* (the default: no websites, no browser) or *on a website*. Websites: the first opens first; each is a whole site or one page | M | 11 |
| F-33 | **Files to give**, copied into every Exam folder at Start | M | 11 |
| F-34 | **Rules**, all on by default: leaving locks the student out · stopping suddenly counts as leaving · hand in automatically at the end · copy and paste only inside the exam | M | 11 |
| F-35 | *What students see*: a preview of the exam bar, and a check that each app is installed on the lab computers | S | 11 |
| F-36 | **Open for students**: a 4-digit code big enough for the projector, and the students as they join, each with their computer and check state | M | 12 |
| F-37 | **Start the exam** for everyone | M | 12 |
| F-38 | **The exam, live**: a card per student by state, with the app in front and the warning count; counts that filter; a list view; search | M | 13 |
| F-39 | **What's happening**, newest first, with actions (*Look*); a sound for events that need the teacher | M | 13 |
| F-40 | A student's **timeline**, with **Let back in** or **Keep out** and a reason, both written to the log | M | 13b |
| F-41 | **Add time** for everyone or one student; **End the exam** (asks first) collects everyone's work | M | 13 |
| F-42 | **After the exam**: one folder per student, how and when they handed in, receipts, warnings; **export the log** to a spreadsheet (CSV) | M | 14 |
| F-43 | **Classes**: paste names or import a spreadsheet (the gradebook's class export works), with each student's **school email** if the sheet has it | M | — |
| F-44 | **Teacher mode needs a teacher licence**, as in MicroLab. Student copies join only exams from a licensed teacher and then trust only that teacher's computer | S | — |

## 1.5 Non-functional requirements

| ID | Requirement |
|---|---|
| N-01 | **Platform**: lab computers run Windows 10 22H2 or Windows 11, 64-bit; the teacher's laptop is a **Mac** (macOS; Windows 10/11 works too — the teacher's side uses nothing Windows-only) |
| N-02 | **Speed of closing**: a window that isn't allowed is closed within 1 s, aiming for 0.5 s, on the i5 with 4 GB |
| N-03 | **Scale**: 40 students per run on one teacher laptop; the live view reflects any change within 2 s |
| N-04 | **Always restored**: whatever happens (hand-in, leave, crash, kill, power cut) the computer is back to normal within seconds, or as soon as Windows has started again after a power cut. Every change is journaled before it is made |
| N-05 | **No work lost**: hand-ins are verified by SHA-256; backups every 2 minutes (F-22); a run's data survives the teacher's laptop restarting |
| N-06 | **Layout**: every screen fills the window from 1280 to 1920 wide, with nothing cut off (as in the prototype) |
| N-07 | **Controls**: shadcn/ui components only (new-york style, Tailwind v4, Phosphor icons), themed with the prototype's tokens; never the browser's default look |
| N-08 | **Offline**: runs on the classroom network alone; the internet is needed only for the exam's websites |
| N-09 | **Privacy**: no screenshots, recording or webcam; the log holds only exam events; everything stays on the teacher's laptop |
| N-10 | **Ready quickly**: ExamMode opens in ≤ 5 s on the i5 with 4 GB; locking the computer takes ≤ 3 s |
| N-11 | **Plain English**, short sentences, for students from Year 7 |
| N-12 | **Updates** as in the gradebook, OneEditor and MicroLab: a GitHub release feed, About ExamMode, and *What's new* |
| N-13 | **No configuration files** (Q13): an exam is made in ExamMode's own screens in under 5 minutes; a lab computer needs nothing after the one install; the defaults are the safe ones |

## 1.6 What ExamMode can and can't stop

Said once, plainly, so nobody expects more than it does.

| Stops (on a lab computer, during an exam) | Can't stop |
|---|---|
| Opening any app that isn't allowed (closed within a second, reported) | A phone, a smartwatch, notes on paper (the teacher in the room) |
| Websites that aren't allowed, in the exam browser and in every other app (the firewall) | Looking at a neighbour's screen |
| The Windows key, the taskbar, Start, Task Manager, Win+R and the other shortcuts out | A student with **administrator rights** (if the shared account is an administrator, or they know the admin password), who could stop the Guard (R2, Q12) |
| A second screen, remote-control apps, running inside a virtual machine | A copy of ExamMode rebuilt from its source to skip the rules (R7) |
| Pasting something copied before the exam | Files reachable through an allowed app's own Open dialog: the shared account's other folders (R4) |
| Leaving and joining again | A capture device on the screen's cable |

## 1.7 Apps and exam profiles

The allowed apps are **chosen for each exam**, never built in (the teacher: *"there might be more than just office app and browser, it also might include some of our app that we build here like OneEditor and MicroLab"*; *"microsoft access, project also should be included"*).

An **exam profile** is a small data file shipped with ExamMode. It describes an app it knows:

1. **How to recognise it**: publisher (Authenticode signer), file name, usual install paths. A renamed `cheat.exe` doesn't match.
2. **How to start it in the exam**: arguments and folder. VS Code, for example, gets its own `--user-data-dir` and `--extensions-dir` with only the allowed extensions, opened on the Exam folder.
3. **Its own ways out, turned off** for the exam: Office's connected experiences and Copilot, add-ins, online templates and pictures, signing in (with the student's school email, or any account) and OneDrive; VS Code's Copilot, Settings Sync, Live Share and extension installs; MicroLab's update check and library downloads.
4. **The child processes it may start**: VS Code may start `python.exe` and its terminal; no app may start a browser.

**Profiles in v1:** Word, Excel, PowerPoint, Access, Project, VS Code, Python IDLE, Thonny, OneEditor and MicroLab.

**An app without a profile** (Scratch, GIMP, a teacher's choice) is *only allowed to run*. It is recognised by its .exe, it can't reach the internet (F-23), and anything it starts that isn't allowed is closed.

**Our own apps** (OneEditor, MicroLab) could also take an `--exam` argument to turn off their own links and downloads from the inside. That change goes in those apps, later (Q10).

## 1.8 Risks

| ID | Risk | Likelihood · Impact | What we do |
|---|---|---|---|
| R1 | Windows hooks (keyboard, window events) don't run reliably from Node through **koffi** in a worker thread | M · H | The **M0 spike** measures it first. Fallback: a small native helper (Rust) for the hooks alone |
| R2 | The lab account is an **administrator**, so a student could stop the Guard or undo a policy | M · H | Checked on a lab computer in M0 (Q12). The Guard checks its own rules every few seconds and reports changes; if ExamMode stops, the student counts as having left. Advise a standard account for lab users |
| R3 | The network **blocks broadcasts** (discovery) or **isolates computers** from each other (some Wi-Fi) | M · M | F-01's fallback (type the teacher's computer name); a network check in M2's acceptance on the real lab |
| R4 | An allowed app's own features reach things they shouldn't: Open dialogs on the shared account's files, help links, add-ins | H · M | Profiles (§1.7); the firewall (F-23); the process guard. Later: a temporary Windows account per exam (§1.9, *later*) |
| R5 | **Antivirus** flags the keyboard hook or the process killing | M · M | The hook installed only while an exam runs; test with Windows Defender on a lab computer (M4); if needed, IT adds an exclusion for the install folder |
| R6 | A crash or power cut leaves a computer **locked** | L · H | The journal (N-04): the Guard undoes everything when ExamMode stops and at every boot |
| R7 | ExamMode is open source, so someone could build a client that pretends to obey | L · M | Accepted, as in MicroLab (its R18). The teacher's laptop is the authority; the teacher is in the room |
| R8 | The school's own **group policy** owns the firewall | L · M | Use our own firewall rules group, never change the school's; test on a lab computer (M4) |
| R9 | **Office's licence check** fails with the internet blocked | L · M | Microsoft 365 / Office 2021 work offline; checked in M5 |
| R10 | **No Windows code-signing certificate**: Windows SmartScreen warns when installing, and ExamMode can't prove its own files by signature | M · L | ExamMode is installed for the whole computer in Program Files, which only an administrator can change; the Guard trusts the program at that path. A certificate can be added later (Q18) |

## 1.9 Decisions & open questions

### Decided (2026-11-10)

| # | Decision |
|---|---|
| Q1 | **Windows lab computers** (10/11, 64-bit, one shared account, 1920 × 1080), set up once by the teacher or IT with an administrator account |
| Q12 | **Open-use computers**, one shared account, no sign-in; every student has a school email (F-02, F-43). *Whether the account is an administrator is checked in M0* |
| Q2 | **The allowed apps are chosen for each exam.** Profiles in v1 are listed in §1.7; any other app can be added and is only allowed to run |
| Q3 | **The question page, if any, is any website** the teacher gives; ExamMode doesn't make questions |
| Q4 | **The teacher's laptop runs the exam** over the classroom network: no account, no internet service. Hosting online could come later |
| Q5 | **Stopping suddenly counts as leaving.** A crash looks the same as Task Manager; the teacher decides who comes back |
| Q6 | **A lost network is not leaving**: still locked, keep working, the gap reported later |
| Q7 | **Hand-ins go to the teacher's laptop**, one folder per student. Sending them on to the hand-in site could come later |
| Q8 | **Teacher mode needs a teacher licence**, as in MicroLab |
| Q9 | **No webcam or screen recording** |
| Q10 | **MicroLab inside an exam** opens normally under the exam bar; its own `.mlexam` full-screen mode isn't needed there |
| Q11 | **The look**: shadcn/ui (new-york, Tailwind v4, Phosphor icons), themed with the prototype's tokens, as the gradebook is; React in Electron |
| Q13 | **Why not Safe Exam Browser**: too much configuration, and its workflow didn't suit the teacher's → N-13 |
| Q14 | **Questions are usually on paper**; the work is on the computer: code, Office, design apps. The question website is optional, off by default (F-10, F-32) |
| Q15 | **The repository is public** on GitHub from M0, as MicroLab's (all rights reserved, no licence, unless the teacher chooses one) |
| Q16 | **Electron + TypeScript**, as the other edutools apps (the teacher has no C# background) |
| Q18 | **No Windows code-signing certificate**: R10's plan — installed in Program Files, the Guard trusts that path; SmartScreen warns once at install. A certificate can be added later |
| Q17 | **OneEditor is the only design app** used in exams (it has a profile, §1.7). Browser-only design apps (Canva, Figma on the web) aren't needed |
| Q19 | **The teacher's laptop is a Mac**: the teacher's side is built and tested on macOS first; it works on Windows too (N-01) |

### Still open (sensible defaults are used in the design)

| # | Question | Default until answered |
|---|---|---|
| — | *None: every question is answered.* | — |

### Later (not v1)

- A **temporary Windows account** per exam, so the shared account's own files aren't reachable (R4).
- Sending hand-ins on to the **ICT hand-in site** (Q7).
- Running exams from a **server on the internet** instead of the teacher's laptop (Q4).
- An `--exam` argument in **OneEditor and MicroLab** (§1.7).

## 1.10 Proposed way to build it

### Steps (the edutools workflow)

1. **HTML prototype** in `design/`: ✅ approved 2026-11-10 (*"all good"*). 21 screens; rebuild with `python3 design/build.py`.
2. **This analysis**, plus `02-architecture.md` and `MILESTONES.md`: 📝 Rev 1, 2026-11-10; Rev 2 with the teacher's answers to Q12–Q15.
3. **Coding**, milestone by milestone, test first. Each milestone's gate passes before the next one starts.

### Suggested technology

| Part | Choice | Why |
|---|---|---|
| Desktop | **Electron** + electron-vite + TypeScript | As MicroLab; one app for students and teachers |
| UI | **React** + **shadcn/ui** (new-york, Tailwind v4, Phosphor) | Q11; as the gradebook |
| Windows calls | **koffi** (FFI) from Node, behind one `WinApi` interface | No C++ to compile; replaceable by fakes in tests; R1 |
| Guard | TypeScript built into its **own program** (a Node single-executable application, `ExamModeGuard.exe`), run as a **Windows service** with WinSW | Same language; admin-only jobs; survives ExamMode being killed. Not Electron's `ELECTRON_RUN_AS_NODE`: that switch is turned off in ExamMode, or anyone could run their own code as ExamMode.exe, which the firewall lets through (architecture D3) |
| Network | HTTP + WebSocket (`ws`) on the teacher's laptop; UDP broadcast for finding exams | LAN only; no extra service to install |
| Teacher's data | **SQLite** (better-sqlite3 + Drizzle) | As the gradebook; one file |
| Messages | **zod** schemas shared by both sides | One definition, checked at both ends |
| Tests | **Vitest** (unit, integration, windows, acceptance, component) + **Playwright** for Electron | As the other apps |

The milestones are in [`MILESTONES.md`](MILESTONES.md).
