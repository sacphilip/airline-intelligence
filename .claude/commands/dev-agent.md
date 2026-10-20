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

### 2. Create the feature branch via GitHub MCP

Call `mcp__github__create_branch` with:
```json
{
  "owner": "sacphilip",
  "repo": "airline-intelligence",
  "branch": "feature/<story-id-kebab>",
  "from_branch": "develop"
}
```
Example branch name: `feature/us-006-airline-profile`

Do NOT run any `git` commands for branching — GitHub MCP owns this step.

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

### 7. Push all changes via GitHub MCP

Call `mcp__github__push_files` with **every file you created or modified**:

```json
{
  "owner": "sacphilip",
  "repo": "airline-intelligence",
  "branch": "feature/<story-id-kebab>",
  "message": "feat(<story-id>): <story title in sentence case>\n\n- <bullet 1>\n- <bullet 2>\n- <bullet 3>\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>",
  "files": [
    { "path": "backend/src/...", "content": "<base64-encoded file content>" },
    { "path": "frontend/src/...", "content": "<base64-encoded file content>" }
  ]
}
```

Rules:
- Include **every** file changed — backend, frontend, any new module wiring
- Encode each file's full content as base64
- Never include: `.env`, `*.db`, `*.db-shm`, `dist/`, `node_modules/`, `tsconfig.tsbuildinfo`, `reports/`, `test-results/`
- Commit message bullets: what was built (repository method, endpoint, component, API client method)

---

### 8. Open a Pull Request via GitHub MCP

Call `mcp__github__create_pull_request` with:

```json
{
  "owner": "sacphilip",
  "repo": "airline-intelligence",
  "title": "feat(<story-id>): <story title>",
  "body": "<PR body — see template below>",
  "head": "feature/<story-id-kebab>",
  "base": "develop"
}
```

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
- Feature branch name
- PR URL (from MCP response)
- Backend: endpoints added with HTTP method + path
- Frontend: components/methods added
- Files pushed (count)
- Next step: `/qa-orchestrator-ui <story-id>` to run automated API tests
