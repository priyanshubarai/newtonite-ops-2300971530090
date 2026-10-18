# Newtonite Operations Under Pressure - Assignment Checklist

> This checklist documents every product, architectural, correctness, testing, repository, and submission requirement from the authoritative specification. Documentation completion does not imply application implementation is complete. Use `Not Started` for initial status.

## 1. Operating Mode & Boundaries

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| OB-001 | Documentation executor only - no independent architectural decisions | P0 | All documents faithfully record the specification as written without redesign, reinterpretation, or optimization | Manual review of created files against spec | Not Started |
| OB-002 | Conflict handling procedure documented | P0 | If conflicts exist, document in "Requires Architect Review" section without making conflicting decisions | Check for conflict handling section if needed | Not Started |
| OB-003 | No implementation of features, scaffolding, dependencies, or stack changes | P0 | Files created only as specified; no code implementation artifacts outside docs | Repository inspection after creation | Not Started |
| OB-004 | Preserve existing Git working tree and uncommitted changes | P0 | Git status checked and preserved | Run git status check | Not Started |

## 2. Project Definition

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| PD-001 | Application name: "Newtonite Operations Under Pressure" | P0 | Documented consistently across all files | Review all documents | Not Started |
| PD-002 | Internal operational work-management application replacing fragmented coordination | P0 | Purpose and scope documented in README/Architecture | Document review | Not Started |
| PD-003 | Users can create, assign, track, discuss, approve, resolve, and close operational work | P0 | Core capabilities documented | Document review | Not Started |
| PD-004 | Work-item types: Incident, Customer issue, Payment investigation, Compliance request, Task | P0 | All five types listed and defined | ARCHITECTURE.md review | Not Started |

## 3. Approved Technology Stack

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| TS-001 | Frontend: React + TypeScript | P0 | Documented exactly as specified | ARCHITECTURE.md | Not Started |
| TS-002 | Frontend server-state: TanStack Query | P0 | Documented exactly as specified | ARCHITECTURE.md | Not Started |
| TS-003 | Backend: Node.js + Express + TypeScript | P0 | Documented exactly as specified | ARCHITECTURE.md | Not Started |
| TS-004 | Database: PostgreSQL | P0 | Documented exactly as specified | ARCHITECTURE.md | Not Started |
| TS-005 | ORM: Drizzle ORM | P0 | Documented exactly as specified | ARCHITECTURE.md | Not Started |
| TS-006 | Migration tooling: Drizzle Kit | P0 | Documented exactly as specified | ARCHITECTURE.md | Not Started |
| TS-007 | Testing: Vitest + Supertest | P0 | Documented exactly as specified | ARCHITECTURE.md | Not Started |
| TS-008 | Local dev: Docker Compose | P0 | Documented exactly as specified | ARCHITECTURE.md | Not Started |
| TS-009 | Prisma is prohibited | P0 | Explicitly stated as prohibited | ARCHITECTURE.md | Not Started |
| TS-010 | Architecture: modular monolith | P0 | Documented as modular monolith | ARCHITECTURE.md | Not Started |

## 4. Users, Teams, and Roles

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| UR-001 | Users can belong to multiple teams | P0 | Users table + memberships with multi-team rows verified | DB check (4 multi-team users seeded) | Verified (schema + seed) |
| UR-002 | Each user-team membership has its own role | P0 | role column on membership; no global role on users | DB schema + seed | Verified (schema + seed) |
| UR-003 | Roles: Viewer, Member, Lead, Admin | P0 | team_role enum has all four values | DB enum verified in Neon | Verified (schema) |
| UR-004 | Roles are scoped to teams (not globally) | P0 | role lives on membership only | DB schema | Verified (schema) |
| UR-005 | Seeded demo users sufficient; user registration out of scope | P0 | 10 demo users seeded, hashed passwords | `npm run seed` verified | Verified (seed) |

## 5. Work Items Model

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| WI-001 | Required fields: id, title, description, type, priority, status, team_id, assignee_id, created_by, due_at, version, created_at, updated_at | P0 | All 13 columns present in work_items table | DB schema verified in Neon | Verified (schema) |
| WI-002 | due_at and assignee_id may be nullable | P0 | Both columns nullable; verified by insert with nulls | DB schema verified in Neon | Verified (schema) |
| WI-003 | Use PostgreSQL UUID identifiers unless existing constraint requires review | P0 | All PKs are uuid default gen_random_uuid() | DB schema verified in Neon | Verified (schema) |

## 6. Workflow

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| WF-001 | State machine: Open → In Progress → Awaiting Approval → Resolved → Closed | P0 | Exact states implemented in `workflow.ts` `WORKFLOW_NEXT` | workflow.ts + mutations.integration.test.ts | Verified (implemented + tested) |
| WF-002 | Server enforces allowed transitions | P0 | Single conditional UPDATE with a status guard; invalid edge → `409 INVALID_TRANSITION` | workflow.ts, service.ts, mutations.integration.test.ts | Verified (implemented + tested) |
| WF-003 | Only Lead authorized for the item's team may perform approval action | P0 | Approval edge requires `approve_transition` (LEAD/ADMIN of the item's real team) | policy.ts + mutations.integration.test.ts | Verified (implemented + tested) |
| WF-004 | Clients must not bypass by submitting arbitrary status values | P0 | PATCH rejects `status` via a strict schema; status only moves through `/transition` | validation.ts + items.integration.test.ts | Verified (implemented + tested) |
| WF-005 | Reopening Closed items is out of scope | P0 | `CLOSED` has no outgoing edge; reopening → `409 INVALID_TRANSITION` | workflow.ts + mutations.integration.test.ts | Verified (implemented + tested) |

## 7. Dashboard Views

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| DB-001 | Three views: Assigned to Me, Unassigned Urgent, Awaiting My Approval | P0 | Documented in ARCHITECTURE.md §9 | ARCHITECTURE.md §9, §15 | Partially implemented — delivered as one server-filtered list; the three presets are blocked (no "unassigned"/role filter). **Requires Architect Review** (ARCHITECTURE.md §15) |
| DB-002 | Server-side search, filtering, deterministic ordering, cursor pagination | P0 | Filtering/search/ordering server-side; pagination is offset (`page`/`pageSize`), matching the implemented API | frontend/src/pages/ItemsPage.tsx + ItemsPage.test.tsx | Verified (implemented + tested; offset, not cursor) |
| DB-003 | Do not load all records into memory/browser | P0 | Only one page is fetched; no client-side accumulation | frontend/src/pages/ItemsPage.tsx + api/items.ts | Verified (implemented + tested) |
| DB-004 | Login form with generic failure messaging; no account enumeration | P0 | Required-field validation; identical failure message for all rejection causes | LoginPage.test.tsx (5 tests) | Verified (implemented + tested) |
| DB-005 | Session from `GET /auth/me` (user + memberships); invalid/expired auth returns to login | P0 | 401 on a token-carrying request clears session + cache; `/login` for unauthenticated routes | session.test.tsx (5 tests) | Verified (implemented + tested) |
| DB-006 | Detail view with claim and workflow-transition actions; approval gated to LEAD/ADMIN of the item's team | P0 | Single next workflow step offered; no reopen; approval hidden from MEMBER, shown to LEAD | ItemDetailPage.test.tsx (13 tests) | Verified (implemented + tested) |
| DB-007 | Create and edit forms; `expectedVersion` from server, never user-settable; no status editing | P0 | PATCH sends fetched version; no `status`/`teamId`/`version` in payload | itemForm.test.ts + ItemEditPage.test.tsx | Verified (implemented + tested) |
| DB-008 | 409 handling: stale version, lost claim, replayed idempotency key | P0 | Explain + reload (edits preserved); no silent retry/overwrite; distinct messages | ItemEditPage.test.tsx + ItemDetailPage.test.tsx | Verified (implemented + tested) |
| DB-009 | Loading, empty, error, retry, unauthorized, and not-found states | P0 | All states rendered with accessible messaging and retry where recoverable | StateViews + page tests | Verified (implemented + tested) |
| DB-010 | Accessibility: semantic structure, labelled controls, keyboard operable, non-colour status | P0 | Landmarks/`h1`, label association, `aria-invalid`/`aria-describedby`, `Enter` submits, text-based status | component + page tests | Verified (implemented + tested) |

## 8. Collaboration & History

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| CH-001 | Support comments and append-only activity history | P0 | comments + activity_events tables created | DB schema verified in Neon | Verified (schema) |
| CH-002 | Record: status changes, assignee changes, priority changes (minimum) | P0 | Writes `STATUS_CHANGED`, `ASSIGNEE_CHANGED`, `PRIORITY_CHANGED` (+ `ITEM_CREATED`, `ITEM_UPDATED`) | activity.ts + mutations.integration.test.ts | Verified (implemented + tested) |
| CH-003 | Each event includes actor, work item, event type, timestamp, before/after | P0 | Writer sets actor_id, work_item_id, event_type, metadata(before/after); created_at by DB | activity.ts + mutations.integration.test.ts | Verified (implemented + tested) |
| CH-004 | Business mutation and activity event in same PostgreSQL transaction | P0 | Mutation + version + event + outbox written on one `TxClient`; rollback test proves atomicity | mutations.integration.test.ts (case 26) | Verified (implemented + tested) |
| CH-005 | Transactional outbox consumed with bounded retries and idempotent handlers | P1 | Separate worker claims via `FOR UPDATE SKIP LOCKED`, backoff + max attempts, permanent/transient split, lease recovery; at-least-once with idempotent handler | `src/outbox/*` unit + integration suites | Verified (implemented + tested) |

## 9. Role & Permission Matrix

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| RP-001 | Matrix as specified without additions/removals | P0 | Exact matrix implemented in policy.ts and covered by tests | policy.test.ts (32 cases, table-driven) | Verified (code + tests) |
| RP-002 | All permissions team-scoped | P0 | roleCan always resolves role for one concrete team; no global bypass | policy.ts + authorize.ts; cross-team test asserts 404 | Verified (code + tests) |
| RP-003 | Backend enforces auth, membership, resource access, action permissions | P0 | requireAuth + requireTeamPermission middleware enforce server-side | auth.integration.test.ts against Neon | Verified (code + tests) |
| RP-004 | Hiding frontend controls is not an authorization mechanism | P0 | Enforcement is entirely server-side; frontend not yet built | ARCHITECTURE.md + backend policy | Verified (server-side enforcement) |

## 10. Engineering Decisions (Final)

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| ED-001 | Decision 1: Modular monolith with clear boundaries | P0 | Documented in ENGINEERING_DECISIONS.md with full structure | Review document | Not Started |
| ED-002 | Decision 2: PostgreSQL + Drizzle ORM + Drizzle Kit | P0 | Documented with rationale | Review document | Not Started |
| ED-003 | Decision 3: Atomic claim + optimistic concurrency (versioning) | P0 | Documented with 409 Conflict behavior; implemented in Phase 5 | Review document + code | Verified (documented + implemented) |
| ED-004 | Decision 4: Team-scoped auth + workflow enforcement (server-side) | P0 | Documented | Review document | Not Started |
| ED-005 | Decision 5: Idempotency + transactional outbox + audit in same transaction | P0 | Documented with all aspects; implemented in Phase 5 (insertion) and Phase 8 (worker consumer) | Review document + code | Verified (documented + implemented) |

## 11. Critical Behaviors & Tests

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| CT-001 | Concurrent claim: exactly one succeeds | P0 | Overlapping requests; exactly one 200, loser `409 ALREADY_ASSIGNED` | mutations.integration.test.ts (case 4) | Verified (test) |
| CT-002 | Stale update: rejected, newer data intact | P0 | Stale `expectedVersion` → `409 STALE_VERSION`; row/audit/outbox unchanged | mutations.integration.test.ts (cases 7–8) | Verified (test) |
| CT-003 | Idempotency: duplicate requests produce one logical operation | P0 | Replay + concurrent duplicate yields one item/event/outbox; key reuse → 409 | mutations.integration.test.ts (cases 20–23) | Verified (test) |
| CT-004 | Workflow enforcement: invalid transitions & unauthorized approval fail | P0 | Skip/reopen → `409 INVALID_TRANSITION`; member/viewer approve → 403 | mutations.integration.test.ts (cases 12–19) | Verified (test) |
| CT-005 | Resource authorization: cross-team access denied | P0 | Cross-team test asserts 404 for non-member team | auth.integration.test.ts + mutations.integration.test.ts | Verified (test) |
| CT-006 | Audit atomicity: failed activity insert rolls back mutation | P0 | Forced event-insert failure rolls back item + outbox in one transaction | mutations.integration.test.ts (case 26) | Verified (test) |
| CT-007 | Real PostgreSQL for concurrency integration tests | P0 | Suites run against the configured Neon database; concurrency uses overlapping requests | mutations.integration.test.ts | Verified (implemented) |
| CT-008 | Vitest + Supertest | P0 | Used by all suites | package.json + *.integration.test.ts | Verified (implemented) |
| CT-009 | Tests runnable via documented command | P0 | `cd backend && npm run test:run` (199 tests pass, 9 files) | README.md | Verified (documented + run) |
| CT-010 | Outbox claiming is concurrency-safe (no double-claim) | P1 | Concurrent claims return disjoint batches; `FOR UPDATE SKIP LOCKED` proven against a second open transaction | `src/outbox/outbox.integration.test.ts` against Neon | Verified (test, real PostgreSQL) |
| CT-011 | Outbox retries are bounded; permanent errors never loop | P1 | Transient → backoff reschedule (never early); permanent → immediate `FAILED`; exhausted attempts → `FAILED`; malformed payload safe | `src/outbox/outbox.integration.test.ts` + `src/outbox/backoff.test.ts` | Verified (test) |
| CT-012 | Worker logs/persisted errors contain no credentials or payloads | P1 | `logEvent` emits primitives only; `redactSecrets` strips connection strings/tokens/keys; `last_error` bounded | `src/outbox/logging.test.ts` + integration suite | Verified (test) |

## 12. API Inventory

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| API-001 | POST /auth/login | P0 | Implemented; generic 401 on all failures, tested | auth.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-002 | GET /me | P0 | Implemented in Phase 3; returns user + memberships, no password hash | auth.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-003 | GET /items | P0 | Implemented with filtering/search/sorting/offset pagination; team-scoped, exact totals | items.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-004 | POST /items | P0 | Implemented; server-owned fields, strict body, same-team assignee; writes activity + outbox | items.integration.test.ts + mutations.integration.test.ts | Verified (endpoint + tests) |
| API-005 | GET /items/:id | P0 | Implemented; 404 for non-member team / malformed id | items.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-006 | PATCH /items/:id | P0 | Implemented; allowlisted editable fields, protected fields rejected, `expectedVersion` required, version increments | items.integration.test.ts + mutations.integration.test.ts | Verified (endpoint + tests) |
| API-007 | POST /items/:id/claim | P0 | Implemented; single conditional UPDATE, exactly one concurrent winner, `409 ALREADY_ASSIGNED`/`NOT_CLAIMABLE` | mutations.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-008 | POST /items/:id/transition | P0 | Implemented; edge map enforced, approval requires LEAD/ADMIN of the item's team, `409 INVALID_TRANSITION`/`STALE_VERSION` | mutations.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-009 | POST /items/:id/comments | P0 | Out of Phase 5 scope (table exists; no route) | — | Not Started (out of scope) |
| API-010 | GET /items/:id/activity | P0 | Out of Phase 5 scope (events are written; no read route) | — | Not Started (out of scope) |
| API-011 | Consistent HTTP errors: 401, 403, 404, 409 + validation | P0 | 400/401/403/404/409 all implemented; 409 carries a stable `code`; malformed JSON → 400 and oversized body → 413 (Phase 6 fix), never 500 | items/auth/mutations/verification integration tests | Verified (implemented + tested) |

## 13. Implementation Roadmap (9 Phases)

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| RM-001 | Phase 1: Project foundation | P0 | Documented with all required elements | IMPLEMENTATION_ROADMAP.md | Not Started |
| RM-002 | Phase 2: Database schema and seed data | P0 | All 8 entities, migrations, seed verified against Neon | Migration + seed executed & verified | Verified (complete) |
| RM-003 | Phase 3: Authentication and authorization | P0 | Login, /me, middleware, policy helpers, tests all implemented | Full suite run against Neon (53 tests pass) | Verified (complete) |
| RM-004 | Phase 4: Work-item API | P0 | GET/POST /items, GET/PATCH /items/:id implemented with validation, service, repo, tests | Full suite run against Neon (32 items tests) | Verified (complete) |
| RM-005 | Phase 5: Correctness-critical mutations | P0 | Atomic claim, guarded transitions, optimistic concurrency, DB-backed idempotency, transactional activity + outbox | Full suite run against Neon (114 tests, 29 mutation tests); suite now 131 tests total | Verified (complete) |
| RM-006 | Phase 6: Critical integration tests | P0 | Six critical behaviors covered by real-PostgreSQL tests with genuine concurrency; plus Phase 6 audit (auth matrix, cross-team isolation, pagination, validation, idempotency guards, migration state) with two defects fixed | `mutations.integration.test.ts` + `verification.integration.test.ts` against Neon (131 tests, 5 files) | Verified (complete — executed) |
| RM-007 | Phase 7: Functional frontend | P0 | Login, shell, filtered/paginated list, detail, create, edit, claim, transitions, conflict + error states implemented; 65 frontend tests across 8 files; typecheck/build exit 0 | `cd frontend && npm test` (65 pass) + `npm run build` | Verified (implemented + tested) — with two items escalated: three dashboard presets, comments/activity (no read endpoints), cursor pagination (ARCHITECTURE.md §15) |
| RM-008 | Phase 8: Minimal asynchronous worker | P1 (conditional) | Separate worker process claims `outbox_jobs` with `FOR UPDATE SKIP LOCKED`, validates/acknowledges supported events, bounded exponential backoff with jitter, permanent vs transient errors, max-attempt enforcement, lease recovery of abandoned claims, graceful shutdown, structured sanitised logs, separate entry point + `npm run worker`; 38 unit + 30 real-PostgreSQL tests. No schema change, no migration, no external delivery. | `cd backend && npm run test:run` (199 tests, 9 files) + `npm run worker` smoke test | Verified (implemented + tested) — path deviation (`src/outbox/*` + `src/worker.ts`) recorded in IMPLEMENTATION_ROADMAP.md; at-least-once by design, OS-signal delivery unverified on Windows, no failed-job alerting |
| RM-009 | Phase 9: Submission hardening | P0 | Documented | IMPLEMENTATION_ROADMAP.md | Not Started |
| RM-010 | Deadline: Mon 19 Oct 2026 10:00 AM, target 9:30 AM | P0 | Deadline documented | IMPLEMENTATION_ROADMAP.md | Not Started |

## 14. Required Documentation Files

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| DOC-001 | docs/ASSIGNMENT_CHECKLIST.md created | P0 | File exists with complete checklist | File existence check | Not Started |
| DOC-002 | docs/ARCHITECTURE.md created | P0 | File exists with all required sections | File existence check | Not Started |
| DOC-003 | docs/IMPLEMENTATION_ROADMAP.md created | P0 | File exists with 9 phases | File existence check | Not Started |
| DOC-004 | ENGINEERING_DECISIONS.md created at repo root | P0 | File exists with 5 decisions | File existence check | Not Started |
| DOC-005 | README.md created/updated if needed | P0 | File exists; no invented commands/credentials | File existence check | Not Started |
| DOC-006 | Include Mermaid diagrams in ARCHITECTURE.md | P0 | 3 diagrams as specified | Content review | Not Started |

## 15. Performance & Constraints

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| PC-001 | Cursor pagination with deterministic ordering | P0 | Documented | ARCHITECTURE.md | Not Started |
| PC-002 | Indexes for access patterns as specified | P0 | Documented | ARCHITECTURE.md | Not Started |
| PC-003 | No Redis, search engine, read replicas, partitioning in initial build | P0 | Constraints documented | ARCHITECTURE.md | Not Started |
| PC-004 | Scale expectations documented (thousands of users, concurrent, tens of thousands of items) | P0 | Documented | ARCHITECTURE.md | Not Started |

## 16. Submission Requirements

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| SUB-001 | Public repository access ready | P0 | Documented in submission checklist | README/roadmap | Not Started |
| SUB-002 | Fresh-clone verification documented | P0 | Step documented | README/roadmap | Not Started |
| SUB-003 | Known limitations documented | P0 | Section included | README | Not Started |
| SUB-004 | Preserve submission buffer; cut optional scope before correctness/tests | P0 | Priority guidance documented | IMPLEMENTATION_ROADMAP.md | Not Started |

**Note:** This checklist tracks documentation completion according to the authoritative specification. The "Current Status" values above represent the initial state as required.