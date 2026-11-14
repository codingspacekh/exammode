# ExamMode

Keeps a student's lab computer inside the exam's own apps and websites until they hand in. Leaving locks them out of the exam, and only the teacher can let them back in. The teacher runs the exam live from their own laptop over the classroom network.

- [System analysis & requirements](docs/01-analysis-and-requirements.md)
- [Architecture](docs/02-architecture.md)
- [Milestones & TDD workflow](docs/MILESTONES.md): build plan, gates, progress
- [UI prototype](design/screens/index.html): `python3 -m http.server 8000 --directory design/screens`, or open the file

Status: a teacher can run a whole exam ([M3](docs/acceptance/M3.md), [M6](docs/acceptance/M6.md)), and a Windows computer is locked for it and put back — proven on GitHub's Windows computers, not yet tried by hand on a lab computer ([M4](docs/acceptance/M4.md)). Next: the exam's apps (M5). The gates of M0–M4 and M6 wait for the teacher's answers and a day in the lab ([M0](docs/acceptance/M0.md), [M1](docs/acceptance/M1.md), [M2](docs/acceptance/M2.md)).

## Develop

You need [Node.js](https://nodejs.org) 24 or newer.

```bash
npm install          # also sets up the pre-commit hook (lint, type-check, unit tests)
npm run dev          # ExamMode in development
npm run check        # lint · type-check · tests with coverage · build
npm run e2e          # build, then the end-to-end tests
npm run ui:add -- dialog select   # add shadcn/ui components
```

GitHub Actions runs `npm run check` on macOS and `npm run check:win` (with the Windows tests) on Windows for every push to `dev` or `main`.
