# Newtonite Operations Under Pressure - Assignment Checklist

> This checklist documents every product, architectural, correctness, testing, repository, and submission requirement from the authoritative specification. Documentation completion does not imply application implementation is complete.
>
> **Status vocabulary.** `Verified (documented)` — the deliverable exists and was reviewed. `Verified (implemented + tested)` — the behaviour exists in code **and** is covered by an automated test that was executed and passed. `Verified (implemented; partially tested)` — the behaviour exists in code but is not fully covered by tests. `Open` — not implemented. `Closed` — the requirement applied to an earlier phase that is complete; the note says what it applied to.
>
> **Last reconciled:** 2026-10-22, against commit `e67603f` plus the uncommitted stabilisation changes (cookie-based authentication, server-side sign-out, test-suite restoration).

## 1. Operating Mode & Boundaries

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| OB-001 | Documentation executor only - no independent architectural decisions | P0 | All documents faithfully record the specification as written without redesign, reinterpretation, or optimization | Manual review of created files against spec | Closed — the documentation phase produced `README.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_ROADMAP.md`, `ENGINEERING_DECISIONS.md` and this checklist; implementation was then authorised by `docs/IMPLEMENTATION_ROADMAP.md` |
| OB-002 | Conflict handling procedure documented | P0 | If conflicts exist, document in "Requires Architect Review" section without making conflicting decisions | Check for conflict handling section if needed | Verified (documented) — `docs/ARCHITECTURE.md` §15 "Requires Architect Review" |
| OB-003 | No implementation of features, scaffolding, dependencies, or stack changes | P0 | Files created only as specified; no code implementation artifacts outside docs | Repository inspection after creation | Closed — applied to the documentation phase only; the implementation phases that followed are recorded in `docs/IMPLEMENTATION_ROADMAP.md` |
| OB-004 | Preserve existing Git working tree and uncommitted changes | P0 | Git status checked and preserved | Run git status check | Verified — no commit, push, reset, or stash was performed in this cycle; all work is uncommitted on top of `e67603f` |

## 2. Project Definition

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| PD-001 | Application name: "Newtonite Operations Under Pressure" | P0 | Documented consistently across all files | Review all documents | Verified (documented) |
| PD-002 | Internal operational work-management application replacing fragmented coordination | P0 | Purpose and scope documented in README/Architecture | Document review | Verified (documented) — `README.md` overview + `docs/ARCHITECTURE.md` §1 |
| PD-003 | Users can create, assign, track, discuss, approve, resolve, and close operational work | P0 | Core capabilities documented | Document review | Verified (implemented + tested) — create/edit/claim/transition/comment endpoints are exercised by `mutations.integration.test.ts` |
| PD-004 | Work-item types: Incident, Customer issue, Payment investigation, Compliance request, Task | P0 | All five types listed and defined | ARCHITECTURE.md review | Verified (documented + implemented) — enum `work_item_type` in the DB schema and `backend/src/db/schema/enums.ts` |

## 3. Approved Technology Stack

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| TS-001 | Frontend: React + TypeScript | P0 | Documented exactly as specified | ARCHITECTURE.md §2 | Verified (documented) — and implemented (React 19 + TS 5) |
| TS-002 | Frontend server-state: TanStack Query | P0 | Documented exactly as specified | ARCHITECTURE.md §2 | Verified (documented) — and implemented (`@tanstack/react-query` v5) |
| TS-003 | Backend: Node.js + Express + TypeScript | P0 | Documented exactly as specified | ARCHITECTURE.md §2 | Verified (documented) — and implemented |
| TS-004 | Database: PostgreSQL | P0 | Documented exactly as specified | ARCHITECTURE.md §2 | Verified (documented) — and implemented (Neon-hosted) |
| TS-005 | ORM: Drizzle ORM | P0 | Documented exactly as specified | ARCHITECTURE.md §2 | Verified (documented) — and implemented |
| TS-006 | Migration tooling: Drizzle Kit | P0 | Documented exactly as specified | ARCHITECTURE.md §2 | Verified (documented) — and implemented (`drizzle-kit`) |
| TS-007 | Testing: Vitest + Supertest | P0 | Documented exactly as specified | ARCHITECTURE.md §2 | Verified (documented) — and implemented (both packages) |
| TS-008 | Local dev: Docker Compose | P0 | Documented exactly as specified | ARCHITECTURE.md §2 | Verified (documented) — the stack table lists Docker Compose for local development. **Note:** the local run in this cycle used the hosted Neon database directly, so the Compose path is documented but was not exercised here |
| TS-009 | Prisma is prohibited | P0 | Explicitly stated as prohibited | ARCHITECTURE.md §2 | Verified (documented) — stated as a prohibited constraint; no Prisma dependency present |
| TS-010 | Architecture: modular monolith | P0 | Documented as modular monolith | ARCHITECTURE.md §2/§3 | Verified (documented) — and implemented as a modular monolith |

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
| DB-001 | Three views: Assigned to Me, Unassigned Urgent, Awaiting My Approval | P0 | Documented in ARCHITECTURE.md §9 | ARCHITECTURE.md §9 + `GET /items?preset=` + `items.integration.test.ts` + `MyWorkPage`/`NeedsAttentionPage`/`AwaitingApprovalPage` tests | Verified (implemented + tested) — the three presets are now server-side filters (`assigned`, `unassigned_urgent`, `awaiting_approval`); `awaiting_approval` additionally requires `LEAD`/`ADMIN` membership and returns an empty page otherwise, so the role gate is enforced by the server, not by hiding a control. The earlier "Requires Architect Review" escalation is **closed** |
| DB-002 | Server-side search, filtering, deterministic ordering, cursor pagination | P0 | Filtering/search/ordering server-side; pagination is offset (`page`/`pageSize`), matching the implemented API | frontend/src/pages/ItemsPage.tsx + ItemsPage.test.tsx | Verified (implemented + tested; offset, not cursor) — the offset deviation is recorded in ARCHITECTURE.md §15 and is the API the backend actually implements |
| DB-003 | Do not load all records into memory/browser | P0 | Only one page is fetched; no client-side accumulation | frontend/src/pages/ItemsPage.tsx + api/items.ts | Verified (implemented + tested) |
| DB-004 | Login form with generic failure messaging; no account enumeration | P0 | Required-field validation; identical failure message for all rejection causes | LoginPage.test.tsx (18 tests) + `auth.integration.test.ts` | Verified (implemented + tested) |
| DB-005 | Session from `GET /auth/me` (user + memberships); invalid/expired auth returns to login | P0 | 401 on a session-carrying request clears session + cache; `/login` for unauthenticated routes | session.test.tsx (11 tests) + client.test.ts | Verified (implemented + tested) — the session credential is now an `HttpOnly` cookie; sign-out additionally calls `POST /auth/logout` so the server session ends too (see `SECURITY_AUDIT.md` H-01) |
| DB-006 | Detail view with claim and workflow-transition actions; approval gated to LEAD/ADMIN of the item's team | P0 | Single next workflow step offered; no reopen; approval hidden from MEMBER, shown to LEAD | ItemDetailPage.test.tsx (26 tests) | Verified (implemented + tested) |
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
| RP-004 | Hiding frontend controls is not an authorization mechanism | P0 | Enforcement is entirely server-side; frontend not yet built | ARCHITECTURE.md + backend policy | Verified (server-side enforcement) — the frontend is now built, and its role gating (e.g. hiding **Approve & resolve** from a MEMBER) is cosmetic only; the backend rejects the same call with `403` regardless of what the client shows |

## 10. Engineering Decisions (Final)

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| ED-001 | Decision 1: Modular monolith with clear boundaries | P0 | Documented in ENGINEERING_DECISIONS.md with full structure | Review document | Verified (documented) — `ENGINEERING_DECISIONS.md` "Decision 1: Modular Monolith" |
| ED-002 | Decision 2: PostgreSQL + Drizzle ORM + Drizzle Kit | P0 | Documented with rationale | Review document | Verified (documented) — `ENGINEERING_DECISIONS.md` "Decision 2: PostgreSQL and Drizzle ORM" |
| ED-003 | Decision 3: Atomic claim + optimistic concurrency (versioning) | P0 | Documented with 409 Conflict behavior; implemented in Phase 5 | Review document + code | Verified (documented + implemented) |
| ED-004 | Decision 4: Team-scoped auth + workflow enforcement (server-side) | P0 | Documented | Review document | Verified (documented) — `ENGINEERING_DECISIONS.md` "Decision 4: Team-Scoped Authorization and Workflow Enforcement" |
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
| CT-009 | Tests runnable via documented command | P0 | `cd backend && npm run test:run` (209 tests pass, 9 files) | README.md | Verified (documented + run) — re-run 2026-10-22: **209/209 pass** in 9 files |
| CT-010 | Outbox claiming is concurrency-safe (no double-claim) | P1 | Concurrent claims return disjoint batches; `FOR UPDATE SKIP LOCKED` proven against a second open transaction | `src/outbox/outbox.integration.test.ts` against Neon | Verified (test, real PostgreSQL) |
| CT-011 | Outbox retries are bounded; permanent errors never loop | P1 | Transient → backoff reschedule (never early); permanent → immediate `FAILED`; exhausted attempts → `FAILED`; malformed payload safe | `src/outbox/outbox.integration.test.ts` + `src/outbox/backoff.test.ts` | Verified (test) |
| CT-012 | Worker logs/persisted errors contain no credentials or payloads | P1 | `logEvent` emits primitives only; `redactSecrets` strips connection strings/tokens/keys; `last_error` bounded | `src/outbox/logging.test.ts` + integration suite | Verified (test) |

## 12. API Inventory

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| API-001 | POST /auth/login | P0 | Implemented; generic 401 on all failures, tested | auth.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-002 | GET /me | P0 | Implemented in Phase 3; returns user + memberships, no password hash | auth.integration.test.ts against Neon | Verified (endpoint + tests) — mounted at `GET /auth/me` |
| API-003 | GET /items | P0 | Implemented with filtering/search/sorting/offset pagination; team-scoped, exact totals | items.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-004 | POST /items | P0 | Implemented; server-owned fields, strict body, same-team assignee; writes activity + outbox | items.integration.test.ts + mutations.integration.test.ts | Verified (endpoint + tests) |
| API-005 | GET /items/:id | P0 | Implemented; 404 for non-member team / malformed id | items.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-006 | PATCH /items/:id | P0 | Implemented; allowlisted editable fields, protected fields rejected, `expectedVersion` required, version increments | items.integration.test.ts + mutations.integration.test.ts | Verified (endpoint + tests) |
| API-007 | POST /items/:id/claim | P0 | Implemented; single conditional UPDATE, exactly one concurrent winner, `409 ALREADY_ASSIGNED`/`NOT_CLAIMABLE` | mutations.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-008 | POST /items/:id/transition | P0 | Implemented; edge map enforced, approval requires LEAD/ADMIN of the item's team, `409 INVALID_TRANSITION`/`STALE_VERSION` | mutations.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-009 | POST /items/:id/comments | P0 | Implemented; team-scoped write that records a `COMMENT_ADDED` activity event in the same transaction | `mutations.integration.test.ts` cases 29–33 | Verified (endpoint + tests) — the earlier "out of scope" note is **closed** |
| API-010 | GET /items/:id/activity | P0 | Implemented; team-scoped read of the append-only activity history, paginated | `mutations.integration.test.ts` case 31 | Verified (endpoint + tests) — the earlier "out of scope" note is **closed** |
| API-009a | GET /items/:id/comments (companion read route) | P0 | Implemented; team-scoped, paginated; a non-member team receives `404`, not an empty list | `mutations.integration.test.ts` cases 34–36 | Verified (endpoint + tests) — **added in this cycle**; the route existed but had no backend coverage until now |
| API-011 | Consistent HTTP errors: 401, 403, 404, 409 + validation | P0 | 400/401/403/404/409 all implemented; 409 carries a stable `code`; malformed JSON → 400 and oversized body → 413 (Phase 6 fix), never 500 | items/auth/mutations/verification integration tests | Verified (implemented + tested) |

## 13. Implementation Roadmap (9 Phases)

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| RM-001 | Phase 1: Project foundation | P0 | Documented with all required elements | IMPLEMENTATION_ROADMAP.md | Verified (documented) — "Phase 1: Project Foundation" section present with the stack, layout, and tooling |
| RM-002 | Phase 2: Database schema and seed data | P0 | All 8 entities, migrations, seed verified against Neon | Migration + seed executed & verified | Verified (complete) |
| RM-003 | Phase 3: Authentication and authorization | P0 | Login, /me, middleware, policy helpers, tests all implemented | Full suite run against Neon (53 tests pass) | Verified (complete) — **re-verified 2026-10-22**: the session credential is now an `HttpOnly` cookie and sign-out ends the server session; see `SECURITY_AUDIT.md` H-01 |
| RM-004 | Phase 4: Work-item API | P0 | GET/POST /items, GET/PATCH /items/:id implemented with validation, service, repo, tests | Full suite run against Neon (32 items tests) | Verified (complete) |
| RM-005 | Phase 5: Correctness-critical mutations | P0 | Atomic claim, guarded transitions, optimistic concurrency, DB-backed idempotency, transactional activity + outbox | Full suite run against Neon (114 tests, 29 mutation tests); suite now 131 tests total | Verified (complete) |
| RM-006 | Phase 6: Critical integration tests | P0 | Six critical behaviors covered by real-PostgreSQL tests with genuine concurrency; plus Phase 6 audit (auth matrix, cross-team isolation, pagination, validation, idempotency guards, migration state) with two defects fixed | `mutations.integration.test.ts` + `verification.integration.test.ts` against Neon (point-in-time Phase 6 result: 131 tests in 5 files; the suite has since grown to **209 tests in 9 files** — see RM-008 and CT-009) | Verified (complete — executed) |
| RM-007 | Phase 7: Functional frontend | P0 | Login, shell, filtered/paginated list, detail, create, edit, claim, transitions, conflict + error states implemented; 137 frontend tests across 12 files; typecheck/build exit 0 | `cd frontend && npm test -- --run` (137 pass) + `npm run typecheck` + `npm run build` | Verified (implemented + tested) — **re-verified 2026-10-22**. Both earlier escalations are now **closed**: the three dashboard presets are server-side filters, and comments/activity have read endpoints. The cursor-pagination deviation remains recorded in ARCHITECTURE.md §15 |
| RM-008 | Phase 8: Minimal asynchronous worker | P1 (conditional) | Separate worker process claims `outbox_jobs` with `FOR UPDATE SKIP LOCKED`, validates/acknowledges supported events, bounded exponential backoff with jitter, permanent vs transient errors, max-attempt enforcement, lease recovery of abandoned claims, graceful shutdown, structured sanitised logs, separate entry point + `npm run worker`; 38 unit + 30 real-PostgreSQL tests. No schema change, no migration, no external delivery. | `cd backend && npm run test:run` (209 tests, 9 files) + `npm run worker` smoke test | Verified (implemented + tested) — path deviation (`src/outbox/*` + `src/worker.ts`) recorded in IMPLEMENTATION_ROADMAP.md; at-least-once by design, OS-signal delivery unverified on Windows, no failed-job alerting |
| RM-009 | Phase 9: Submission hardening | P0 | Documented | IMPLEMENTATION_ROADMAP.md | Verified (documented) — "Phase 9: Submission Hardening" section present |
| RM-010 | Deadline: Mon 19 Oct 2026 10:00 AM, target 9:30 AM | P0 | Deadline documented | IMPLEMENTATION_ROADMAP.md | Verified (documented) — deadline, 9:30 AM target, and the 30-minute buffer are stated in both the roadmap and the README |

## 14. Required Documentation Files

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| DOC-001 | docs/ASSIGNMENT_CHECKLIST.md created | P0 | File exists with complete checklist | File existence check | Verified (documented) — this file; reconciled 2026-10-22 |
| DOC-002 | docs/ARCHITECTURE.md created | P0 | File exists with all required sections | File existence check | Verified (documented) — all 15 sections present, including §9 Dashboard Views, §10 Performance & Indexing, §14 Future Scaling, §15 Requires Architect Review |
| DOC-003 | docs/IMPLEMENTATION_ROADMAP.md created | P0 | File exists with 9 phases | File existence check | Verified (documented) — nine phase sections present |
| DOC-004 | ENGINEERING_DECISIONS.md created at repo root | P0 | File exists with 5 decisions | File existence check | Verified (documented) — five decision sections, each with implementation notes per phase |
| DOC-005 | README.md created/updated if needed | P0 | File exists; no invented commands/credentials | File existence check | Verified (documented) — **updated 2026-10-22** for cookie-based authentication, the security headers and rate limiters, the `POST /auth/logout` endpoint, the dashboard presets, the comments/activity surfaces, and current test counts |
| DOC-006 | Include Mermaid diagrams in ARCHITECTURE.md | P0 | 3 diagrams as specified | Content review | Verified (documented) — 5 Mermaid diagrams present (3 required) |

## 15. Performance & Constraints

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| PC-001 | Cursor pagination with deterministic ordering | P0 | Documented | ARCHITECTURE.md §10 | Verified (documented) — deterministic ordering is specified with the `id` tie-breaker. **Deviation:** the implemented pagination is offset-based (`page`/`pageSize` with an exact `total`), not cursor-based; the deviation is recorded in ARCHITECTURE.md §15 and matches what the API actually returns |
| PC-002 | Indexes for access patterns as specified | P0 | Documented | ARCHITECTURE.md §10 | Verified (documented) — the index set and the access path each one serves are listed in §10 |
| PC-003 | No Redis, search engine, read replicas, partitioning in initial build | P0 | Constraints documented | ARCHITECTURE.md §2/§14 | Verified (documented) — stated as a constraint, and honoured: no Redis, search engine, read replica or partitioning dependency is present |
| PC-004 | Scale expectations documented (thousands of users, concurrent, tens of thousands of items) | P0 | Documented | ARCHITECTURE.md §14 | Verified (documented) — "thousands of registered users" and "hundreds to a few thousand simultaneous users" are stated, with the scaling path described |

## 16. Submission Requirements

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| SUB-001 | Public repository access ready | P0 | Documented in submission checklist | README/roadmap | Verified (documented) — the readiness line is in the README's *Submission Information* section and the Phase 9 checklist. **Note:** the repository itself was not pushed in this cycle (no commit, push, or deploy was performed), so the public-access confirmation remains a submission-time action |
| SUB-002 | Fresh-clone verification documented | P0 | Step documented | README/roadmap | Verified (documented) — README section *"Fresh-Clone / Setup Reproducibility"* covers migrations, seed idempotency, and checks; IMPLEMENTATION_ROADMAP.md Phase 9 lists the same procedure |
| SUB-003 | Known limitations documented | P0 | Section included | README | Verified (documented) — the README's *Known Limitations* section now lists both the specification's scope constraints and the implementation's own limitations (outbox delivery, offset pagination, stateless sessions, IP-only throttling, the deferred dependency advisory). The former "To Be Documented" placeholder has been **replaced** |
| SUB-004 | Preserve submission buffer; cut optional scope before correctness/tests | P0 | Priority guidance documented | IMPLEMENTATION_ROADMAP.md | Verified (documented) — *"Timeline & Priority Guidance"* states the priority definitions and the rule to cut optional scope before correctness or submission verification |

## 17. Reconciliation Summary (2026-10-22)

Every row above was re-checked against the repository and the test suites on 2026-10-22. The changes from the previous status column were:

| Change | Rows |
|---|---|
| Status advanced from *Not Started* to *Verified (documented)* | TS-001…TS-010, ED-001, ED-002, ED-004, RM-001, RM-009, RM-010, DOC-001…DOC-006, PC-001…PC-004, SUB-001…SUB-004 |
| Previously blocked, now implemented and tested | DB-001 (the three dashboard presets), API-009 (`POST /items/:id/comments`), API-010 (`GET /items/:id/activity`) |
| Previously untested route, now covered | API-009a (`GET /items/:id/comments`) — 3 new backend integration tests |
| Test counts refreshed | CT-009, RM-007, RM-008, DB-004, DB-005, DB-006 |
| Scope statement corrected | RP-004 (the frontend is now built; its role gating remains cosmetic) |
| Documentation placeholder replaced with real content | SUB-003 (README *Known Limitations*) |

**Counts.** No row is left as *Not Started*. Two rows are *Closed* because they described the documentation-only phase (OB-001, OB-003), and one is an honest deviation rather than a completion: PC-001 records that pagination is offset-based, not cursor-based, matching the implemented API.

**What is still not verified.** Two things were checked but could not be exercised in this environment, and are recorded as such rather than claimed as complete:

- **Docker Compose (TS-008)** — the local-development stack is documented exactly as specified, but this run used the hosted Neon database directly, so the Compose path was never started.
- **Outbox worker OS-signal delivery (RM-008)** — the shutdown *mechanism* is covered by the integration suite, but a programmatic `SIGTERM` is not delivered to a process on Windows, so the signal path itself is unverified on this platform.

**Note:** this checklist tracks the assignment's requirements. "Verified (implemented + tested)" means an automated test exists, was executed, and passed — it is not a claim that the feature is production-ready. The security posture of the result is reviewed separately in [`../SECURITY_AUDIT.md`](../SECURITY_AUDIT.md), which lists the findings that remain open.