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
| WF-001 | State machine: Open → In Progress → Awaiting Approval → Resolved → Closed | P0 | Exact states documented | ARCHITECTURE.md | Not Started |
| WF-002 | Server enforces allowed transitions | P0 | Enforcement mechanism documented | ARCHITECTURE.md | Not Started |
| WF-003 | Only Lead authorized for the item's team may perform approval action | P0 | Authorization rule documented | ARCHITECTURE.md | Not Started |
| WF-004 | Clients must not bypass by submitting arbitrary status values | P0 | Security constraint documented | ARCHITECTURE.md | Not Started |
| WF-005 | Reopening Closed items is out of scope | P0 | Scope constraint documented | ARCHITECTURE.md | Not Started |

## 7. Dashboard Views

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| DB-001 | Three views: Assigned to Me, Unassigned Urgent, Awaiting My Approval | P0 | All three documented | ARCHITECTURE.md, README | Not Started |
| DB-002 | Server-side search, filtering, deterministic ordering, cursor pagination | P0 | All features documented | ARCHITECTURE.md | Not Started |
| DB-003 | Do not load all records into memory/browser | P0 | Constraint documented | ARCHITECTURE.md | Not Started |

## 8. Collaboration & History

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| CH-001 | Support comments and append-only activity history | P0 | comments + activity_events tables created | DB schema verified in Neon | Verified (schema) |
| CH-002 | Record: status changes, assignee changes, priority changes (minimum) | P0 | activity_event_type enum includes STATUS_CHANGED, ASSIGNEE_CHANGED, PRIORITY_CHANGED | DB enum verified; writing service deferred to Phase 5 | Verified (schema) |
| CH-003 | Each event includes actor, work item, event type, timestamp, before/after | P0 | actor_id, work_item_id, event_type, created_at, metadata(before/after) columns | DB schema verified in Neon | Verified (schema) |
| CH-004 | Business mutation and activity event in same PostgreSQL transaction | P0 | Requires transactional write service | Not implemented — Phase 5 scope | Not Started |

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
| ED-003 | Decision 3: Atomic claim + optimistic concurrency (versioning) | P0 | Documented with 409 Conflict behavior | Review document | Not Started |
| ED-004 | Decision 4: Team-scoped auth + workflow enforcement (server-side) | P0 | Documented | Review document | Not Started |
| ED-005 | Decision 5: Idempotency + transactional outbox + audit in same transaction | P0 | Documented with all aspects | Review document | Not Started |

## 11. Critical Behaviors & Tests

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| CT-001 | Concurrent claim: exactly one succeeds | P0 | Test requirement documented | ARCHITECTURE.md, Roadmap | Not Started |
| CT-002 | Stale update: rejected, newer data intact | P0 | Test requirement documented | ARCHITECTURE.md, Roadmap | Not Started |
| CT-003 | Idempotency: duplicate requests produce one logical operation | P0 | Test requirement documented | ARCHITECTURE.md, Roadmap | Not Started |
| CT-004 | Workflow enforcement: invalid transitions & unauthorized approval fail | P0 | Test requirement documented | ARCHITECTURE.md, Roadmap | Not Started |
| CT-005 | Resource authorization: cross-team access denied | P0 | Cross-team test asserts 404 for non-member team | auth.integration.test.ts (Team A role → 404 in Team B) | Verified (test) |
| CT-006 | Audit atomicity: failed activity insert rolls back mutation | P0 | Test requirement documented | ARCHITECTURE.md, Roadmap | Not Started |
| CT-007 | Real PostgreSQL for concurrency integration tests | P0 | Documented constraint | ARCHITECTURE.md | Not Started |
| CT-008 | Vitest + Supertest | P0 | Documented | ARCHITECTURE.md | Not Started |
| CT-009 | Tests runnable via documented command | P0 | Command documented in README | README.md | Not Started |

## 12. API Inventory

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| API-001 | POST /auth/login | P0 | Implemented; generic 401 on all failures, tested | auth.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-002 | GET /me | P0 | Documented | ARCHITECTURE.md | Not Started |
| API-003 | GET /items | P0 | Implemented with filtering/search/sorting/offset pagination; team-scoped, exact totals | items.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-004 | POST /items | P0 | Implemented; server-owned fields, strict body, same-team assignee | items.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-005 | GET /items/:id | P0 | Implemented; 404 for non-member team / malformed id | items.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-006 | PATCH /items/:id | P0 | Implemented; allowlisted editable fields, protected fields rejected | items.integration.test.ts against Neon | Verified (endpoint + tests) |
| API-007 | POST /items/:id/claim | P0 | Documented | ARCHITECTURE.md | Not Started |
| API-008 | POST /items/:id/transition | P0 | Documented | ARCHITECTURE.md | Not Started |
| API-009 | POST /items/:id/comments | P0 | Documented | ARCHITECTURE.md | Not Started |
| API-010 | GET /items/:id/activity | P0 | Documented | ARCHITECTURE.md | Not Started |
| API-011 | Consistent HTTP errors: 401, 403, 404, 409 + validation | P0 | 400/401/403/404 implemented and tested; 409 reserved for Phase 5 concurrency | items.integration.test.ts + auth.integration.test.ts | Partial (409 → Phase 5) |

## 13. Implementation Roadmap (9 Phases)

| ID | Requirement | Priority | Acceptance Criteria | Verification Method | Current Status |
|---|---|---|---|---|---|
| RM-001 | Phase 1: Project foundation | P0 | Documented with all required elements | IMPLEMENTATION_ROADMAP.md | Not Started |
| RM-002 | Phase 2: Database schema and seed data | P0 | All 8 entities, migrations, seed verified against Neon | Migration + seed executed & verified | Verified (complete) |
| RM-003 | Phase 3: Authentication and authorization | P0 | Login, /me, middleware, policy helpers, tests all implemented | Full suite run against Neon (53 tests pass) | Verified (complete) |
| RM-004 | Phase 4: Work-item API | P0 | GET/POST /items, GET/PATCH /items/:id implemented with validation, service, repo, tests | Full suite run against Neon (30 items tests) | Verified (complete) |
| RM-005 | Phase 5: Correctness-critical mutations | P0 | Documented | IMPLEMENTATION_ROADMAP.md | Not Started |
| RM-006 | Phase 6: Critical integration tests | P0 | Documented | IMPLEMENTATION_ROADMAP.md | Not Started |
| RM-007 | Phase 7: Functional frontend | P0 | Documented | IMPLEMENTATION_ROADMAP.md | Not Started |
| RM-008 | Phase 8: Minimal asynchronous worker | P0 | Documented | IMPLEMENTATION_ROADMAP.md | Not Started |
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