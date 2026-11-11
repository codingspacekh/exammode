# ExamMode

Keeps a student's lab computer inside the exam's own apps and websites until they hand in. Leaving locks them out of the exam, and only the teacher can let them back in. The teacher runs the exam live from their own laptop over the classroom network.

- [System analysis & requirements](docs/01-analysis-and-requirements.md)
- [Architecture](docs/02-architecture.md)
- [Milestones & TDD workflow](docs/MILESTONES.md): build plan, gates, progress
- [UI prototype](design/screens/index.html): `python3 -m http.server 8000 --directory design/screens`, or open the file

Status: M1, the rules, is built and waiting for the teacher's reading ([acceptance](docs/acceptance/M1.md)). M0's lab run is still to do ([acceptance](docs/acceptance/M0.md)).

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
