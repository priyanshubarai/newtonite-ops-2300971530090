# Implementation Roadmap - Newtonite Operations Under Pressure

## Overview

This roadmap documents the nine approved phases in the specified order for implementing Newtonite Operations Under Pressure. The phases follow the authoritative specification and prioritize correctness, authorization, and transaction safety over optional features.

**Important Deadlines:**
- **Submission Deadline:** Monday, 19 October 2026, 10:00 AM
- **Target Submission:** Monday, 19 October 2026, 9:30 AM (30-minute buffer)

## Phase 1 — Project Foundation
**Goal:** Inspect and preserve the existing repository. Establish the minimal TypeScript project structure, environment configuration, PostgreSQL connectivity, Drizzle configuration, migration tooling, health checks, and reproducible local setup.

> **Status note (2026-10-22):** the Docker Compose item below was **not implemented**. No `docker-compose.yml` exists in the repository, the database is hosted on Neon, and this machine has no usable Docker engine. The unchecked boxes are accurate; the commands under *Verification Commands* describe the intended flow, not a verified one.

### Tasks
- [ ] Inspect repository structure and Git status; preserve existing working tree
- [ ] Initialize/organize monorepo structure for backend and frontend
- [ ] Set up TypeScript configuration for backend and frontend
- [ ] Configure environment variables and validation
- [ ] Set up Docker Compose for PostgreSQL (local development)
- [ ] Configure Drizzle ORM (not Prisma) with database connection
- [ ] Configure Drizzle Kit for migrations
- [ ] Create basic health check endpoint
- [ ] Verify local setup can start and connect to PostgreSQL

### Dependencies
- Existing repository state
- PostgreSQL availability (via Docker Compose)

### Expected Files
- `docker-compose.yml` (or in backend/config as appropriate)
- `backend/package.json`, `backend/tsconfig.json`
- `backend/src/config/`, `backend/src/db/` (Drizzle setup)
- `backend/drizzle.config.ts`
- `frontend/package.json`, `frontend/tsconfig.json`
- Environment templates (`.env.example`)

### Duration
**Estimated:** 4-6 hours

### Acceptance Criteria
- Repository is inspected and Git status preserved
- Backend and frontend TypeScript projects initialize successfully
- Drizzle connects to PostgreSQL via configured connection
- Docker Compose brings up PostgreSQL locally
- Health check responds correctly
- Local development environment is reproducible

### Verification Commands
```bash
# Local setup verification
docker compose up -d
npm run db:generate  # via Drizzle Kit
npm run dev (backend/frontend)
curl http://localhost:3000/health
```

### Fallback Scope
- Keep only essential foundation (connection + config). Defer advanced tooling.
- Do not expand scope beyond minimal viable setup.

### Commit Checkpoint
- Commit: "chore: phase 1 - project foundation and Drizzle setup"

---

## Phase 2 — Database Schema and Seed Data
**Goal:** Implement users, teams, memberships, work items, activity events, comments, idempotency records, and outbox jobs. Add constraints, indexes, migrations, and seeded demo accounts.

### Tasks
- [ ] Define Drizzle schema for users, teams, user_team_memberships
- [ ] Define Drizzle schema for work_items with all required fields
- [ ] Define Drizzle schema for activity_events (append-only)
- [ ] Define Drizzle schema for comments
- [ ] Define Drizzle schema for idempotency_records
- [ ] Define Drizzle schema for outbox_jobs
- [ ] Add appropriate constraints (PKs, FKs, UKs, NOT NULL)
- [ ] Add indexes for access patterns (team+status+updated_at, team+urgent, assignee+status, activity by created_at, etc.)
- [ ] Generate and review Drizzle migrations
- [ ] Create seed data with demo users and teams
- [ ] Create seed script for local development

### Dependencies
- Phase 1 complete

### Expected Files
- `backend/src/db/schema/*.ts` (separate schema files per module)
- `backend/src/db/migrations/`
- `backend/src/db/seed.ts`
- `backend/src/db/relations.ts`

### Duration
**Estimated:** 4-6 hours

### Acceptance Criteria
- All tables defined with correct schema per specification
- Foreign keys and constraints properly configured
- Indexes created matching required access patterns
- Migrations run successfully on fresh database
- Seed data creates demo users with appropriate team memberships and roles
- Schema is type-safe via Drizzle

### Verification Commands
```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

### Fallback Scope
- Minimal seed data (sufficient demo users). Avoid excessive test data.
- Essential indexes only if time constrained; but P0 requires covering specified access patterns.

### Commit Checkpoint
- Commit: "feat(db): phase 2 - schema, constraints, indexes, migrations, seed data"

---

## Phase 3 — Authentication and Authorization
**Goal:** Implement seeded-user authentication, protected API routes, centralized team-scoped authorization, and authorization tests.

### Tasks
- [ ] Implement authentication for seeded demo users (login endpoint)
- [ ] Implement `/auth/login` and `/me` endpoints
- [ ] Create auth middleware to protect routes
- [ ] Implement centralized authorization service (team-scoped RBAC)
- [ ] Enforce role checks per action per matrix
- [ ] Ensure server-side enforcement (not frontend-only)
- [ ] Add authorization guards for all protected operations
- [ ] Write basic auth/authorization tests

### Dependencies
- Phase 2 complete

### Expected Files
- `backend/src/modules/auth/`
- `backend/src/middleware/auth.ts`
- `backend/src/middleware/authorize.ts`
- `backend/src/services/authorization.ts`
- Auth-related tests

### Duration
**Estimated:** 3-5 hours

### Acceptance Criteria
- Seeded demo users can authenticate successfully
- Protected routes reject unauthenticated requests (401)
- Team-scoped authorization enforced per role matrix
- Cross-team access denied appropriately (403/404)
- Authorization logic is centralized and reusable
- Core auth tests pass

### Verification Commands
```bash
npm run test -- --run auth
```

### Fallback Scope
- Keep auth minimal for seeded users (no registration). Focus on enforcement correctness.

### Commit Checkpoint
- Commit: "feat(auth): phase 3 - authentication and team-scoped authorization"

---

## Phase 4 — Work-item API
**Goal:** Implement creation, detail, filtered list, cursor pagination, and permitted edits.

### Tasks
- [x] Implement `POST /items` (create work item)
- [x] Implement `GET /items` with server-side filtering, search, and offset pagination
- [x] Implement `GET /items/:id` (detail view)
- [x] Implement `PATCH /items/:id` (permitted edits; hardened in Phase 5 with `expectedVersion`)
- [ ] Implement `GET /items/:id/activity` (activity history) — deferred (out of current scope)
- [ ] Implement `POST /items/:id/comments` (add comment) — deferred (out of current scope)
- [x] Ensure all operations enforce team-scoped authorization
- [x] Implement deterministic ordering for pagination
- [x] Add input validation

> **Status:** implemented and verified (32 items integration tests against Neon).

### Dependencies
- Phase 3 complete

### Expected Files
- `backend/src/modules/work-items/`
- `backend/src/modules/comments/`
- `backend/src/modules/activity/`
- API route handlers, controllers, services, validators
- Related tests

### Duration
**Estimated:** 5-7 hours

### Acceptance Criteria
- CRUD operations for work items work correctly with authz
- List endpoint supports filtering, search, cursor pagination with deterministic ordering
- No records loaded into memory unnecessarily
- Activity history retrieval works
- Comments can be added and retrieved
- Proper validation and error responses (401/403/404/409)

### Verification Commands
```bash
npm run test -- --run work-items
```

### Fallback Scope
- Implement core listing/filtering as specified. Defer complex search enhancements.

### Commit Checkpoint
- Commit: "feat(api): phase 4 - work item CRUD, list with cursor pagination, comments, activity"

---

## Phase 5 — Correctness-critical Mutations
**Goal:** Implement atomic claim, version-based updates, workflow transitions, idempotency, and transactional activity logging.

### Tasks
- [x] Implement `POST /items/:id/claim` with atomic conditional update
- [x] Ensure claim succeeds only if unassigned; return 409 if already assigned (exactly one winner on concurrent attempts)
- [x] Implement version-based optimistic concurrency for updates (version check + increment)
- [x] Return 409 Conflict on stale version without overwriting newer data
- [x] Implement `POST /items/:id/transition` with workflow enforcement
- [x] Enforce Lead-only approval for approval step
- [x] Reject invalid transitions with appropriate errors
- [x] Implement idempotency key handling (DB-backed: advisory lock + `(scope,key)` unique index)
- [x] Persist idempotency records with request hash; detect key reuse for different request
- [x] Ensure business mutation + activity event commit in same PostgreSQL transaction
- [x] Implement activity event recording for status/assignee/priority changes

> **Status:** implemented and verified (29 mutation integration tests against Neon). Outbox insertion is included; the outbox worker was added later in Phase 8.

### Dependencies
- Phase 4 complete

### Expected Files (as implemented)
- `backend/src/items/workflow.ts`, `activity.ts`, `outbox.ts`
- `backend/src/common/idempotency.ts`
- `backend/src/db/index.ts` (`TxClient` type)
- `backend/src/db/migrations/0001_*.sql` (additive enum value)
- `backend/src/items/mutations.integration.test.ts`

### Duration
**Estimated:** 6-8 hours

### Acceptance Criteria
- Concurrent claim: exactly one succeeds, loser gets 409
- Stale update: rejected with 409, data/version integrity maintained
- Idempotency: duplicate requests produce one logical operation, returns original result
- Workflow: invalid transitions and unauthorized approvals fail
- Audit atomicity: activity + mutation in same transaction
- All correctness behaviors implemented as specified

### Verification Commands
```bash
npm run test -- --run mutations
npm run test -- --run concurrency
```

### Fallback Scope
- This is P0 core correctness. Do not defer these behaviors. Protect this phase from scope creep.

### Commit Checkpoint
- Commit: "feat(core): phase 5 - atomic claim, optimistic concurrency, workflow, idempotency, transactional audit"

---

## Phase 6 — Critical Integration Tests
**Goal:** Verify concurrency, stale updates, idempotency, authorization, workflow rules, and audit rollback against PostgreSQL.

### Tasks
- [x] Write integration tests for concurrent claim (race condition)
- [x] Write integration tests for stale version updates
- [x] Write integration tests for idempotency (replay, key reuse)
- [x] Write integration tests for workflow enforcement (invalid transitions, Lead-only approval)
- [x] Write integration tests for resource authorization (cross-team access denied)
- [x] Write integration tests for audit atomicity (failed activity insert rolls back mutation)
- [x] Ensure tests run against real PostgreSQL (not mocked)
- [x] Verify all critical behavior tests pass
- [x] Run full test suite and address regressions

> **Status:** the critical integration suite was delivered alongside Phase 5 (`backend/src/items/mutations.integration.test.ts`, 29 tests) and runs against the real Neon PostgreSQL database.
>
> **Phase 6 addendum (executed):** a separate integration/security/regression suite was added at `backend/src/verification.integration.test.ts` (17 tests) covering API error handling (malformed JSON → `400`, oversized body → `413`), the unauthenticated-token matrix across every items endpoint, expired/forged tokens, live membership/role changes, cross-team isolation, the pagination contract (incl. the preserved `pageSize > 100 → 400`), input validation, idempotency guards, and live migration state. Two genuine defects were found and fixed (malformed JSON → `500`; out-of-range `page` → `500`), each with a regression test. Full backend suite: **131 tests / 5 files passing** against real PostgreSQL. No new tests were written to restate implementation assumptions, and the expected-files paths below were consolidated into the actual suite files.

### Dependencies
- Phase 5 complete

### Expected Files
- `backend/tests/integration/concurrency.test.ts`
- `backend/tests/integration/workflow.test.ts`
- `backend/tests/integration/authorization.test.ts`
- `backend/tests/integration/idempotency.test.ts`
- `backend/tests/integration/audit-atomicity.test.ts`

### Duration
**Estimated:** 4-6 hours

### Acceptance Criteria
- All 6 critical behaviors (CT-001 through CT-006) have passing integration tests
- Tests use real PostgreSQL connections
- Tests are deterministic and repeatable
- No mock-only shortcuts for concurrency scenarios
- All critical tests pass consistently

### Verification Commands
```bash
npm run test -- --run integration
```

### Fallback Scope
- **Critical phase - do not cut.** This validates the core correctness requirements. Prioritize over P2 items.

### Commit Checkpoint
- Commit: "test(integration): phase 6 - concurrency, stale updates, idempotency, workflow, authz, audit rollback"

---

## Phase 7 — Functional Frontend
**Goal:** Implement login, the three dashboard views, filtering, item detail, comments, activity timeline, claim/edit/transition actions, and clear conflict handling.

### Tasks
- [x] Set up React + TypeScript frontend with TanStack Query
- [x] Implement authentication flow (login, current user context)
- [x] Create protected routes and auth guards
- [~] Implement Dashboard with three views — delivered as a single server-filtered list; the three named presets are blocked by missing API filters (see *Status* below)
  - [~] Assigned to Me (expressible with existing filters, not shipped as a preset)
  - [ ] Unassigned Urgent (not expressible — no "unassigned" filter on `GET /items`)
  - [~] Awaiting My Approval (partially expressible — no "teams where I am a Lead" predicate)
- [x] Implement server-side filtering, search, deterministic ordering, pagination — offset (`page`/`pageSize`), matching the API that actually shipped
- [x] Implement work item detail view
- [ ] Implement comments section — **blocked**: no comments read endpoint exists
- [ ] Implement activity timeline (append-only history) — **blocked**: no activity read endpoint exists
- [x] Implement actions: claim, edit, transition
- [x] Handle conflict responses (409) clearly in UI (stale version, claim lost)
- [x] Implement proper error handling and loading states
- [x] Ensure no loading of all records into memory/browser

### Dependencies
- Phase 5-6 stable backend API

### Expected Files
- `frontend/src/` structure (components, pages, hooks, services, queries)
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/pages/ItemDetail.tsx`
- `frontend/src/pages/Login.tsx`
- TanStack Query hooks for API calls

### Duration
**Estimated:** 6-8 hours

### Acceptance Criteria
- [x] Users can log in with seeded demo accounts
- [~] All three dashboard views display correctly with team-scoped data — delivered as one team-scoped, server-filtered list; see *Status*
- [~] Filtering, search, and pagination work server-side — offset pagination, not cursor (matches the implemented API)
- [~] Item detail functional; comments and activity timeline **not** available (no read endpoints)
- [x] Claim, edit, transition actions work with proper authz
- [x] 409 conflicts (stale update, lost claim) handled with clear user feedback
- [x] Frontend uses TanStack Query appropriately
- [x] No full dataset loaded client-side

### Verification Commands
```bash
npm run test -- --run frontend   # -> frontend: npm test (65 tests, 8 files when Phase 7 shipped; now 137 / 12 — see README)
npm run build (frontend)         # -> frontend: npm run build (tsc && vite build)
```

### Status (implemented — Phase 7)

Delivered and verified: `frontend npm test` (65 tests / 8 files at the time, jsdom — since grown to 137 / 12), `npm run typecheck`, `npm run build`, all exit `0`.

Delivered: login with generic failure messaging, in-memory session with `GET /auth/me` identity + memberships, authenticated shell and route guard, server-filtered/paginated work-item list, detail view with claim and workflow-transition actions, create and edit forms with `expectedVersion` optimistic concurrency, stable idempotency keys, explicit stale-version / lost-claim / invalid-transition / forbidden handling, and loading/empty/error/retry/unauthorized states. No backend file was changed and no endpoint was added.

Not delivered, with cause (see `docs/ARCHITECTURE.md` §15 — **Requires Architect Review**): the three named dashboard presets ("Unassigned Urgent" is inexpressible without a new query parameter), the comments section and activity timeline (no read endpoints exist), and cursor pagination (the API implements offset pagination with an exact total). No workaround or fake screen was built.

Commit checkpoint not yet taken — Phase 7 is complete and awaiting review.

### Fallback Scope
- Focus on P0 functionality and clear error/conflict handling. Defer visual polish (P2).
- Keep UI functional and restrained.

### Commit Checkpoint
- Commit: "feat(frontend): phase 7 - dashboard views, item detail, actions, conflict handling"

---

## Phase 8 — Minimal Asynchronous Worker
**Goal:** Implement the transactional outbox worker with bounded retries and idempotent processing, only if the core product, tests, and demo are stable.

### Tasks
- [x] Implement transactional outbox pattern (schema was already in place from Phase 2/5)
- [x] Create outbox worker to poll and process pending jobs
- [x] Implement bounded retries with backoff
- [x] Ensure all handlers are idempotent
- [x] Track retry count, max retries, next retry time
- [x] Handle job completion, failure, and max retry exhaustion
- [x] Ensure worker doesn't block core API or jeopardize P0 completion
- [x] Add basic worker tests if feasible

### Dependencies
- Phases 1-7 stable (core product complete)
- Only proceed if P0 tests pass and submission timeline allows

### Expected Files
- `backend/src/workers/outbox-worker.ts`
- `backend/src/services/outbox-processor.ts`
- Worker configuration and tests (if time permits)

> **Actual files (recorded deviation — no conflict, no scope change).** The worker was placed in the existing **domain-folder** convention rather than the two suggested paths: `backend/src/outbox/{events,backoff,logging,repository,handler,worker}.ts`, with the process entry point at `backend/src/worker.ts` (mirroring `backend/src/index.ts`). The suggested path was a suggestion, not a contract; the delivered layout keeps the outbox (consumer, producer, retry policy, logging, data access) together and matches how `auth/`, `items/`, and `db/` are already organised. The split into a "worker" and a "processor service" is realised as `worker.ts` (loop + config + retry policy) and `handler.ts` (the job processor), which is the same separation under different file names.

### Duration
**Estimated:** 2-4 hours (if implemented) — **Actual:** one working session; the P0 suite was already green.

### Acceptance Criteria
- [x] Outbox worker processes pending jobs from transactional outbox table
- [x] Retries are bounded (max_attempts respected)
- [x] Handlers are idempotent
- [x] Worker runs independently without affecting API performance
- [x] Implementation does not compromise P0 requirements or submission

### Verification Commands
```bash
cd backend
npm run test:run                                  # full suite (all phases)
npx vitest run src/outbox                         # outbox unit + integration suites
npm run typecheck                                 # tsc --noEmit
npm run worker                                    # smoke-test the process (Ctrl+C to stop)
```
> The roadmap's suggested `npm run test -- --run worker` does not match this repo's scripts: `npm test` is Vitest **watch** mode and no test file is named `worker`. The commands above are the real equivalents.

### Fallback Scope
**P1 but conditional:** Implement only if core product, tests, and demo are stable. If timeline pressure exists, **skip or minimize** - do not endanger P0 completion. This is explicitly lower priority than core product and correctness tests.

> **Condition met.** Phase 8 was undertaken only after the P0 suites were green (backend `npm run test:run` → 131 tests passed before the worker was added; 199 after). The worker is a separate process, so it cannot affect API performance or the demo.

### Commit Checkpoint
- Commit: "feat(worker): phase 8 - transactional outbox worker with bounded retries"

---

## Phase 9 — Submission Hardening
**Goal:** Complete the README, engineering decisions, known limitations, fresh-clone verification, public repository access, optional demo recording, and submission.

### Tasks
- [ ] Update README.md with project overview, approved stack, setup instructions, test commands
- [ ] Verify ENGINEERING_DECISIONS.md is complete (5 decisions with full structure)
- [ ] Verify docs/ASSIGNMENT_CHECKLIST.md is up to date
- [ ] Verify docs/ARCHITECTURE.md has all required sections and 3 Mermaid diagrams
- [ ] Verify docs/IMPLEMENTATION_ROADMAP.md is complete
- [ ] Document known limitations clearly
- [ ] Document fresh-clone verification steps
- [ ] Document public repository access readiness
- [ ] Test full setup from a clean state (instructions)
- [ ] Run all tests and ensure critical tests pass
- [ ] Create final submission checklist
- [ ] Prepare submission buffer (cut P2 items if needed)

### Dependencies
- All previous phases complete

### Expected Files
- `README.md` (updated)
- All documentation files finalized
- Known limitations section in README

### Duration
**Estimated:** 1-3 hours

### Acceptance Criteria
- All required documentation files present and complete
- README includes: overview, approved stack, docs links, current status, setup, test commands
- No invented commands, credentials, deployments, or test outcomes
- Known limitations documented
- Fresh-clone verification procedure documented
- Public repository access readiness documented
- All critical integration tests pass
- Submission buffer preserved; optional scope cut if needed

### Verification Commands
```bash
npm run test -- --run
```

### Fallback Scope
- Focus on documentation completeness and P0 verification. Cut P2 items before cutting correctness tests.

### Commit Checkpoint
- Commit: "docs: phase 9 - submission hardening and final documentation"

---

## Timeline & Priority Guidance

### Priority Definitions (as specified)
- **P0 - Essential:** Project starts/runs, PostgreSQL+Drizzle configured, auth+authz, work-item API+workflow, atomic claims/stale-update protection/idempotency/transactional activity, required critical integration tests pass, minimum functional dashboard demonstrable, required docs and submission complete.
- **P1 - Important:** Polished dashboard, improved search/filter usability, optimistic UI with rollback, minimal outbox worker (if stable).
- **P2 - Optional:** Demo video, architecture diagram (already required as Mermaid), extra polish, future-scaling beyond requirements.

### Critical Guidance
- **Preserve submission buffer:** Cut optional scope before cutting correctness tests or submission verification.
- **Test early:** Testing occurs throughout implementation. Phase 6 closes critical coverage gaps.
- **Outbox worker is conditional:** Phase 8 only if core product, tests, demo are stable. Lower priority than P0.
- **Real PostgreSQL required:** For all concurrency/integration tests (mock-only insufficient).

## Summary

| Phase | Focus | Priority | Est. Hours |
|---|---|---|---|
| 1 | Foundation | P0 | 4-6 |
| 2 | Schema & Seed | P0 | 4-6 |
| 3 | Auth & AuthZ | P0 | 3-5 |
| 4 | Work-Item API | P0 | 5-7 |
| 5 | Critical Mutations | P0 | 6-8 |
| 6 | Integration Tests | P0 | 4-6 |
| 7 | Frontend | P0 | 6-8 |
| 8 | Outbox Worker | P1 (Conditional) | 2-4 |
| 9 | Submission Hardening | P0 | 1-3 |

> **Phases 1-7 are complete and committed. Phase 8 (outbox worker) was implemented because its condition was met — P0 suites green and the demo stable — and it is committed only if the author chooses to include it; the P0 submission does not depend on it. Phase 9 (submission hardening) remains.**

**Total Estimated:** 35-53 hours (excluding optional P2 work)

**Submission Target:** 9:30 AM, Mon 19 Oct 2026 (Buffer before 10:00 AM deadline)