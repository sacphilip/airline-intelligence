Implement the feature described in the user story: $ARGUMENTS

If $ARGUMENTS is empty or blank, list all files in `user-stories/` and stop — ask the user to pick one.

---

## Repository
- **Owner:** sacphilip
- **Repo:** airline-intelligence
- **Base branch for PRs:** develop

## Project architecture (read before implementing)

**Monorepo layout**
```
backend/        NestJS API — port 3100
frontend/       Next.js 15 — port 3000
user-stories/   Markdown feature specs
```

**Backend patterns**
- Each feature lives in `backend/src/<domain>/` with `<domain>.controller.ts`, `<domain>.module.ts`, and optionally `<domain>.service.ts`
- Simple DB queries go directly in `movement/movement.repository.ts` (TypeORM + raw SQL via `DataSource`)
- Controller is injected into the module; module is imported into `app.module.ts`
- Endpoints use `@Controller('api')` prefix — e.g. `GET /api/airline/profile`
- Validation: throw `BadRequestException` for missing/invalid params
- Cache via `@Inject(CACHE_MANAGER)` with TTL in milliseconds

**Frontend patterns**
- All API calls go through `frontend/src/lib/api.ts` → add new method to the `api` object using `apiFetch<T>()`
- Tab components live in `frontend/src/components/<tab>/`
- State management: React `useState` + `useEffect` — no Redux, no context
- Styling: Tailwind CSS utility classes; dark-mode tokens via `hsl(var(--primary))` etc.

**Database**
- Single `movements` table (PostgreSQL) — see `movement/movement.entity.ts` for columns
- All analytics queries live in `movement/movement.repository.ts`

---

## Steps

### 1. Read the user story
Resolve the story file:
- bare number `6` → `user-stories/US-006-*.md`
- story ID `US-006` → same
- full filename → use directly

Read the full file. Extract: story ID, title, acceptance criteria, backend endpoint paths, frontend component location.

---

### 2. Check prerequisites, then create the feature branch in its own worktree

**Prerequisite — GitHub CLI.** Run `gh auth status`. If `gh` is missing or not logged in, **stop**
and tell the user to run, once:
```
winget install --id GitHub.cli      # then open a new terminal
gh auth login                       # GitHub.com → HTTPS → log in with a browser
```
Don't start implementing without it: the run must end with a PR.

**Branch.** Name: `feature/<story-id-kebab>`, e.g. `feature/us-006-airline-profile`.

Work in a separate **git worktree**, never in the main checkout: other sessions use the main
folder, and switching its branch would disturb their uncommitted work.
```
git fetch origin develop
git worktree add -b feature/<story-id-kebab> ../flight-tracker-wt/<story-id-kebab> origin/develop
```
- If the branch already exists (a re-run), reuse it: `git worktree add ../flight-tracker-wt/<story-id-kebab> feature/<story-id-kebab>`
  (or use the existing worktree folder if `git worktree list` shows one).
- From here on, **every** read, edit and command happens inside `../flight-tracker-wt/<story-id-kebab>/`.
- Install dependencies there so type checks work: `npm ci --prefix backend` and `npm ci --prefix frontend`.

---

### 3. Survey existing code
Before writing anything, read the relevant existing files:
- The controller/module that owns this feature domain
- `movement/movement.repository.ts` if the story needs DB queries
- The frontend tab component that will show the new UI
- `frontend/src/lib/api.ts` to see existing API methods

Do NOT skip — prevents duplicate code and import errors.

---

### 4. Implement the backend
- Add SQL query / repository method in `movement.repository.ts` if needed
- Add or extend the controller endpoint in the appropriate `*.controller.ts`
- Wire the method to the right module if a new service is introduced
- Follow exactly the same patterns as surrounding code (same error handling, same cache TTL, same response shape)

---

### 5. Implement the frontend
- Add the API method to `frontend/src/lib/api.ts`
- Add or extend the React component in `frontend/src/components/<tab>/<Tab>.tsx`
- Use `useState` / `useEffect` — match the style of the existing tab
- Show a loading state and a graceful empty state when data is absent

---

### 6. Verify — fix all errors before pushing
```
cd backend  && npx tsc --noEmit
cd frontend && npx tsc --noEmit
```
Fix any type errors before moving to the next step.

---

### 7. Commit and push (inside the worktree)

Stage **by name** every file you created or modified — never `git add -A` or `git add .`:
```
git add backend/src/... frontend/src/...
git status --short          # confirm only your files are staged
git commit -F <message-file>
git push -u origin feature/<story-id-kebab>
```

Commit message:
```
feat(<story-id>): <story title in sentence case>

- <what was built: repository method, endpoint, component, API client method>
- <…>
```
End it with the co-author line your session's commit attribution instructions specify.

Rules:
- Include **every** file changed — backend, frontend, any new module wiring
- Never include: `.env`, `*.db`, `*.db-shm`, `*.db-wal`, `dist/`, `node_modules/`, `tsconfig.tsbuildinfo`, `reports/`, `test-results/`
- If a pre-commit hook fails, fix the cause and commit again — never `--no-verify`
- If the push is rejected because the remote branch moved, `git pull --rebase` and push again; never force-push

---

### 8. Open a Pull Request against `develop` — always the last step

Write the PR body (template below) to a temporary file, then:
```
gh pr create --repo sacphilip/airline-intelligence --base develop \
  --head feature/<story-id-kebab> \
  --title "feat(<story-id>): <story title>" --body-file <body-file>
```
- If a PR for this branch already exists (a re-run), don't create another: update it with
  `gh pr edit feature/<story-id-kebab> --body-file <body-file>` and report its URL from
  `gh pr view feature/<story-id-kebab> --json url -q .url`.
- The base is **always** `develop` — never `main`/`master`.
- If `gh pr create` fails, show the error and give the user the manual link
  `https://github.com/sacphilip/airline-intelligence/compare/develop...feature/<story-id-kebab>?expand=1`.
  Don't report the run as finished without either a PR URL or that link.

**PR body template:**
```markdown
## What this implements
<story title and one-sentence description>

## User story
**<story-id>** — `user-stories/<filename>.md`

## Acceptance criteria coverage
<list every acceptance criterion with ✅ or ⚠️ (if not yet implemented)>

## Changes — Backend
<for each file changed: what was added/modified and why>
<new endpoints: HTTP method, path, response shape>

## Changes — Frontend
<for each file changed: what component/method was added/modified>
<what the user now sees in the UI>

## Implementation notes
<non-obvious decisions: SQL approach, caching strategy, state management, etc.>

## How to test
- [ ] Start backend: `cd backend && npm run start:dev`
- [ ] Start frontend: `cd frontend && npm run dev`
- [ ] Open http://localhost:3000 and navigate to the relevant tab
- [ ] Run automated tests: `/qa-orchestrator-ui <story-id>`

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

### 9. Final report

Output:
- Feature branch name and worktree path (`../flight-tracker-wt/<story-id-kebab>`)
- PR URL (from `gh pr create` / `gh pr view`)
- Backend: endpoints added with HTTP method + path
- Frontend: components/methods added
- Files pushed (count)
- Next step: `/qa-orchestrator-ui <story-id>` to run automated API tests
