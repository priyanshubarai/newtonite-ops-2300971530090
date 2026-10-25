# Engineering Decisions — Newtonite Operations Under Pressure

This document describes the verified engineering decisions behind the Newtonite Operations implementation. Each decision is structured as **Context → Options Considered → Choice → Trade-off**. Rationale not explicitly recorded in the repository is labeled **“Rationale not explicitly recorded; inferred from the implementation.”** Source references use repository-relative paths.

---

## 1. Data Model and History

### 1.1 Context
The application must track operational work items through a linear workflow, record who changed what and when, support team-scoped access, and maintain a complete audit trail. The data model must support:
- Work items with type, priority, status, ownership, and versioning
- Team membership with four roles (Viewer, Member, Lead, Admin)
- Append-only activity history for every significant change
- Comments for collaboration
- Idempotency records for retry protection
- Transactional outbox for reliable async processing

All mutations must be transactionally consistent with their audit events.

### 1.2 Options Considered
- **Single-table audit log vs. per-entity audit tables**: A single `activity_events` table with JSONB `metadata` was chosen over per-entity tables. Rationale not explicitly recorded; inferred from implementation: reduces schema complexity while preserving structured before/after values.
- **JSONB `metadata` vs. separate before/after columns**: The implementation stores before/after values together in a single `metadata` JSONB column (e.g., `{ "before": {...}, "after": {...} }`). Rationale not explicitly recorded; inferred: keeps append-only record simple while preserving all required values.
- **PostgreSQL enum types vs. text + check constraints**: The implementation uses real PostgreSQL enum types (`team_role`, `work_item_type`, `work_priority`, `work_status`, `activity_event_type`, `idempotency_state`, `outbox_status`). This provides database-level validation and type safety.
- **Same-team assignee invariant**: The invariant "assignee must belong to the same team" is **not** enforced by a database constraint (a composite FK would require restructuring team/user keys). It is enforced in the service layer (`service.ts:378-380`, `assertSameTeamMember`). This was deliberately deferred to the service layer per the assignment's allowance.

### 1.3 Choice (Verified Implementation)
- **Entities**: `users`, `teams`, `user_team_memberships`, `work_items`, `activity_events`, `comments`, `idempotency_records`, `outbox_jobs`
- **Work items** (`work_items.ts`): UUID PK, title, description, type (enum), priority (enum), status (enum, default OPEN), team_id FK (restrict), assignee_id FK (set null), created_by FK (restrict), due_at, version (int, default 1), created_at/updated_at timestamptz
- **Indexes** (7 on `work_items`): composite for team/status/updatedAt/id, team/priority/status/updatedAt/id, assignee/status/updatedAt; plus single-column on team_id, assignee_id, status, updated_at
- **Activity events** (`activity_events.ts`): work_item_id FK (restrict), actor_id FK (restrict), event_type (enum: ITEM_CREATED, STATUS_CHANGED, ASSIGNEE_CHANGED, PRIORITY_CHANGED, ITEM_UPDATED, COMMENT_ADDED), metadata JSONB, created_at
- **Comments** (`comments.ts`): work_item_id FK, author_id FK, body text, created_at/updated_at
- **Idempotency records** (`idempotency_records.ts`): user_id, scope, key, request_hash, state (IN_PROGRESS/COMPLETED/FAILED), status_code, response_body JSONB, expires_at; unique index on (scope, key)
- **Outbox jobs** (`outbox_jobs.ts`): job_type, payload JSONB, status (PENDING/PROCESSING/COMPLETED/FAILED), attempt_count, max_attempts (default 10), next_attempt_at, processed_at, last_error; index on (status, next_attempt_at)
- **Foreign keys**: `ON DELETE RESTRICT` for audit integrity (except `assignee_id SET NULL`); prevents silent removal of users/work items with history

### 1.4 Trade-offs
| Benefit | Cost/Limitation |
|---------|-----------------|
| Strong relational integrity; FK/UK/NOT NULL enforce data validity | More schema complexity than a document store |
| JSONB `metadata` keeps audit schema simple and extensible | Before/after queries require JSONB extraction; less indexable |
| PostgreSQL enums give DB-level validation | Enum changes require migrations (additive only via `ALTER TYPE ... ADD VALUE`) |
| Composite indexes match exact query predicates | More indexes = more write overhead |
| `ON DELETE RESTRICT` preserves audit trail | Cannot delete users/teams with history without manual cleanup |
| Same-team assignee check in service layer | Not enforced at DB level; relies on service correctness |

---

## 2. Concurrency Control

### 2.1 Context
Multiple users may simultaneously claim the same unassigned work item or edit the same item. The system must guarantee:
- Exactly one claimant wins a claim race
- No lost updates when multiple users edit simultaneously
- Stale reads cannot overwrite newer state
- Retry-safe mutations via idempotency keys

### 2.2 Options Considered
- **Pessimistic locking** (SELECT FOR UPDATE before update): Would hold row locks across the request; increases contention and latency. Not chosen.
- **Application-level locking** (e.g., Redis distributed locks): Adds infrastructure dependency; not needed for this scope. Not chosen.
- **Optimistic concurrency with version column**: Chosen. Uses a monotonically increasing integer `version` on `work_items`. Updates include `WHERE version = expectedVersion` and increment version in the same statement.
- **Atomic claim via conditional UPDATE**: Chosen. Single UPDATE with `WHERE assignee_id IS NULL AND status IN (claimable)` — database decides the winner.
- **Idempotency via advisory locks + unique index**: Chosen. `pg_advisory_xact_lock(hashtext(scope:key))` serializes same-key requests; `(scope, key)` unique index is the database-enforced backstop.

### 2.3 Choice (Verified Implementation)
**Atomic Claim** (`repository.ts:222-243`, `service.ts:513-604`):
```sql
UPDATE work_items
SET assignee_id = $1, version = version + 1, updated_at = now()
WHERE id = $2 AND assignee_id IS NULL AND status IN ('OPEN', 'IN_PROGRESS')
RETURNING *
```
- Exactly one concurrent claimant wins; loser matches zero rows → 409 ALREADY_ASSIGNED or NOT_CLAIMABLE

**Optimistic Concurrency** (`repository.ts:198-214`, `service.ts:418-503`):
```sql
UPDATE work_items
SET ..., version = version + 1, updated_at = now()
WHERE id = $1 AND version = $2
RETURNING *
```
- Stale `expectedVersion` → 409 STALE_VERSION, no side effects
- No-op PATCH (values match) validates version but does not increment or write events

**Workflow Transition** (`repository.ts:253-276`, `service.ts:617-705`):
```sql
UPDATE work_items
SET status = $3, version = version + 1, updated_at = now()
WHERE id = $1 AND version = $2 AND status = $4
RETURNING *
```
- Guards both version (concurrency) and fromStatus (workflow) in DB

**Idempotency** (`idempotency.ts:149-210`):
- Keys scoped to `user:<id>:<endpoint>`
- First statement: `pg_advisory_xact_lock(hashtext(scope:key))` — serializes same-key requests for transaction lifetime
- Unique index `ir_scope_key_unique (scope, key)` as DB-enforced backstop
- Record written **inside same transaction** as mutation + activity + outbox; marked COMPLETED only after business work commits
- Failed mutations roll back idempotency record → failures never cached, key not consumed
- `request_hash` detects key reuse for different payload → 409 IDEMPOTENCY_KEY_REUSED
- Retention hint `expires_at` (24h); no automated purge implemented

### 2.4 Trade-offs
| Benefit | Cost/Limitation |
|---------|-----------------|
| Database decides winner — no read-then-write race | Clients must handle 409 and retry with fresh state |
| No pessimistic locks; low contention for typical flows | Version tracking required in all update requests/responses |
| Advisory lock works across multiple app processes | Requires PostgreSQL; not portable to other DBs |
| Idempotency record commits with mutation — atomic | Storage for idempotency records; no purge job implemented |
| `request_hash` prevents silent key reuse | Clients must generate stable keys (frontend uses payload fingerprint) |

---

## 3. Authorization Model

### 3.1 Context
Authorization must be team-scoped (roles are per-team, not global). Workflow transitions follow a fixed state machine. Server-side enforcement is mandatory — hiding UI controls is not an authorization mechanism. The matrix is fixed:
| Action | Viewer | Member | Lead | Admin |
|--------|--------|--------|------|-------|
| View | Yes | Yes | Yes | Yes |
| Create | No | Yes | Yes | Yes |
| Edit | No | Yes | Yes | Yes |
| Claim | No | Yes | Yes | Yes |
| Approve | No | No | Yes | Yes |
| Manage membership | No | No | No | Yes |

### 3.2 Options Considered
- **Embed roles in JWT**: Rejected. The implementation loads memberships/roles from PostgreSQL on every request (`authorize.ts:55`). A role change or membership revocation takes effect immediately without waiting for token expiry.
- **Global admin bypass**: Rejected. The policy explicitly has no global "admin everywhere" bypass (`policy.ts:8-10`). A LEAD in team A has no authority in team B.
- **403 for cross-team access**: Rejected. Non-membership returns **404** (not 403) to prevent cross-team enumeration (`authorize.ts:42-44`). The caller cannot distinguish "exists but forbidden" from "does not exist".
- **Client-supplied team/role for authorization**: Rejected. Authorization always resolves from the membership row for the resource's real team ID loaded from the database (`authorize.ts:16-18`, `service.ts:327-330`).

### 3.3 Choice (Verified Implementation)
**Authentication** (`auth/middleware.ts`, `auth/tokens.ts`):
- Short-lived JWT (HS256, 15 min default) in HttpOnly cookie; no token in response body
- Token carries only `sub` (user id); roles/memberships loaded from DB on every request
- Generic login failures: unknown email, wrong password, deactivated account all return identical `401 { "error": "Invalid email or password" }` — no account existence disclosure

**Authorization** (`auth/policy.ts`, `auth/authorize.ts`, `auth/repository.ts`):
- `ROLE_PERMISSIONS` matrix maps 4 roles → 6 actions
- `authorizeTeamAction(userId, teamId, action)` → loads membership, checks `roleCan`, returns 404 (non-member) or 403 (insufficient role)
- Non-member = 404 (conceals existence); under-privileged member = 403
- Malformed UUIDs fail closed as 404 before DB query
- No global role; authority always scoped to one concrete team

**Workflow Enforcement** (`items/workflow.ts`, `service.ts:617-705`):
- `WORKFLOW_NEXT` defines exactly one allowed successor per status
- `isApprovalStep` identifies the `AWAITING_APPROVAL → RESOLVED` edge
- Authorization precedes transition validation: unauthorized callers never learn if an edge would be valid
- Approval edge requires `approve_transition` (LEAD/ADMIN of item's team); other edges require `edit_item` (MEMBER+)

**Testing** (`auth.integration.test.ts`, `verification.integration.test.ts`):
- Live membership revocation and role promotion/demotion honored on next request
- Cross-team isolation verified across every mutation endpoint (404)
- `dualMember` test proves LEAD in team B cannot approve team A item (403, not 200)

### 3.4 Trade-offs
| Benefit | Cost/Limitation |
|---------|-----------------|
| Roles loaded from DB on every request — immediate effect of changes | One indexed membership lookup per authorized request |
| 404 for non-members prevents team enumeration | Slightly less intuitive than 403 for callers |
| Centralized policy matrix reduces duplication | Matrix is fixed; no granular permissions (e.g., "edit priority only") |
| Server-side enforcement — no client trust | Frontend must handle authz failures gracefully without relying on UI hiding |

---

## 4. Synchronous vs. Asynchronous Processing

### 4.1 Context
The system must execute business mutations synchronously in the HTTP request path while reliably enqueuing secondary async work (notifications, integrations) without compromising core transactionality.

### 4.2 Options Considered
- **Two-phase commit (2PC)** for async work: Rejected. Adds complexity and coordinator dependency. Not chosen.
- **Transactional outbox pattern**: Chosen. Business mutation + activity event + outbox job inserted in same PostgreSQL transaction. Separate worker process polls and processes jobs.
- **In-process background worker** (timer inside Express): Rejected. Would make API latency depend on background work; one poller per API instance; ambiguous shutdown. Worker is a separate entry point (`worker.ts`, `npm run worker`).
- **Exactly-once delivery**: Rejected in favor of **at-least-once**. Handler work happens outside the claim transaction (locks not held across processing). Idempotent handlers + `status = 'PROCESSING'` guard make replay safe.

### 4.3 Choice (Verified Implementation)
**Request Path (Synchronous)** (`service.ts:338-357`, `idempotency.ts:105-133`):
- Every mutation runs in a single `db.transaction(async (tx) => ...)`
- `recordMutation(tx, row, actorId, events, jobType)` writes:
  1. Work-item mutation (INSERT/UPDATE with version increment)
  2. Activity event(s) — one per changed category
  3. Outbox job — `job_type` = `work_item.created`/`updated`/`claimed`/`transitioned`, payload `{ workItemId, teamId, actorId, status, version }`
- All commit together or roll back together; failed activity insert rolls back mutation

**Outbox Worker (Asynchronous)** (`outbox/worker.ts`, `outbox/handler.ts`, `outbox/repository.ts`):
- Separate process: `npm run worker` (entry point `worker.ts`), not started by API
- **Claiming** (short TX): `SELECT … FOR UPDATE SKIP LOCKED` on eligible jobs (`status = 'PENDING' AND attempt_count < max_attempts AND next_attempt_at <= now()`), then `UPDATE … SET status = 'PROCESSING'` — commits before handler runs
- **Attempt accounting**: `attempt_count` incremented at claim time (not failure time) — bounds jobs that crash the worker
- **Lease**: No dedicated lock column; `updated_at` (written from `now()` on every state change) acts as lease timestamp. Job left `PROCESSING` > lease timeout → abandoned → back to `PENDING` (or `FAILED` if attempts exhausted)
- **Handler** (`handler.ts:99-146`): Validates event type, payload (Zod), referenced work item exists, event `teamId` matches item's team. **No external delivery** — records "processed/validated", never "delivered". Handler is read-only → idempotent by construction.
- **Retry**: Bounded exponential backoff with equal jitter (`ceiling = min(base × 2^(n−1), max)`, delay uniform in `[ceiling/2, ceiling]`). Permanent errors (unknown type, malformed payload, missing item, team mismatch) fail immediately → `FAILED`. Transient errors (DB temporarily unavailable) reschedule.
- **Logging**: `logEvent` restricts fields to primitives (objects → `[omitted]`); `redactSecrets` removes connection strings, tokens, JWTs, long hex secrets from logs and `last_error`

### 4.4 Trade-offs
| Benefit | Cost/Limitation |
|---------|-----------------|
| Core mutations never wait for async work | At-least-once delivery (not exactly-once); requires idempotent handlers |
| Transactional outbox — no lost events on crash | Worker is separate process; must be deployed/monitored independently |
| `FOR UPDATE SKIP LOCKED` gives disjoint claim batches | Requires PostgreSQL 9.5+; not portable |
| Lease via `updated_at` avoids schema migration | Lease coupled to other updates; less explicit than dedicated column |
| Bounded retries + equal jitter prevent stampedes | No external delivery implemented; failed jobs only visible via DB query or logs |
| `attempt_count` at claim bounds crash-looping jobs | `max_attempts` default 10; no dead-letter alerting |

**Known Gaps** (from `SECURITY_AUDIT.md`, `ARCHITECTURE.md`):
- Outbox worker graceful shutdown not OS-verified on Windows (SIGTERM delivery not tested)
- No external delivery integration approved; handler only validates/acknowledges
- No failed-job alerting or metrics platform

---

## 5. Search and Pagination

### 5.1 Context
The application must list work items with server-side filtering, search, deterministic ordering, and pagination — without loading full datasets into memory. Expected scale: tens of thousands of active work items, large and continuously growing activity history.

### 5.2 Options Considered
- **Offset pagination** (`page`/`pageSize` with `LIMIT`/`OFFSET`): Implemented. Simple, works with exact `COUNT(*)` totals.
- **Cursor pagination** (keyset): Required by `ARCHITECTURE.md §9` but **not implemented**. `GET /items` uses `page`/`pageSize` with exact `COUNT(*)`. Frontend matches the real API contract.
- **Client-side filtering**: Rejected. All filtering/sorting happens in SQL via Drizzle query builder.
- **Dedicated search engine** (Elasticsearch): Explicitly excluded from initial build (`ARCHITECTURE.md §10` constraints).

### 5.3 Choice (Verified Implementation)
**Listing** (`repository.ts:121-148`, `service.ts:116-179`):
- All filters (`teamId`, `status`, `priority`, `assigneeId`, `search`, presets) and sorts (`createdAt`, `updatedAt`, `priority`, `dueAt`) expressed in SQL `WHERE`/`ORDER BY` via Drizzle
- `search`: case-insensitive `ILIKE` on `title`/`description` with metacharacter escaping (`escapeLikePattern`)
- Presets: `assigned` (assignee = current user), `unassigned_urgent` (assignee IS NULL + priority HIGH/CRITICAL), `awaiting_approval` (status = AWAITING_APPROVAL + caller has LEAD/ADMIN in any team)
- Pagination: `page` (1 to `Number.MAX_SAFE_INTEGER`), `pageSize` (1–100, default 20). Out-of-range → 400 (not clamped). Exact `COUNT(*)` over same filters.
- Deterministic ordering: requested column/direction + `id` ASC tie-breaker. `priority` sorts by enum order (LOW → CRITICAL).

**Activity/Comments Pagination** (`repository.ts:289-315`, `333-357`):
- Both use offset pagination (page/pageSize, default 20, max 100)
- Activity: ordered by `created_at DESC`; Comments: ordered by `created_at ASC`
- Exact `COUNT(*)` per work item

**Indexes** (verified against Neon):
- `work_items`: `wi_team_status_updated_idx (team_id, status, updated_at, id)`, `wi_team_priority_status_updated_idx (team_id, priority, status, updated_at, id)`, `wi_assignee_status_updated_idx (assignee_id, status, updated_at)` + single-column
- `activity_events`: `ae_work_item_created_at_desc_idx (work_item_id, created_at DESC)`
- `comments`: `c_work_item_created_at_idx (work_item_id, created_at)`
- `outbox_jobs`: `oj_status_next_attempt_idx (status, next_attempt_at)`

**Frontend** (`frontend/src/pages/ItemsListPage.tsx`, `api/items.ts`):
- Server-filtered, server-paginated — browser never downloads collection
- Page size options: 10/20/50/100 (at or below API max 100)
- Filters reset to page 1; free-text debounced 300ms; `AbortSignal` cancels superseded requests

### 5.4 Trade-offs
| Benefit | Cost/Limitation |
|---------|-----------------|
| All filtering/sorting in SQL — no full-table scans in app memory | Offset pagination degrades with deep pages (large OFFSET) |
| Exact `COUNT(*)` for accurate totals | `COUNT(*)` can become expensive beyond ~100k rows; no estimated counts |
| Composite indexes match exact predicates/sort | 7 indexes on `work_items` = write overhead |
| Deterministic ordering with `id` tie-breaker | Stable pages but requires `id` in composite indexes |
| Bounded page size (1–100) enforced at API | No cursor pagination; deep paging not performant at scale |

**Scale Reality Check** (from `ARCHITECTURE.md §15`):
- "Unassigned Urgent" view not expressible — no `assignee IS NULL` filter in API
- "Awaiting My Approval" partially expressible — `status=AWAITING_APPROVAL` supported, but "teams where I am Lead" not a query the API accepts
- No cursor pagination implemented; frontend matches offset-based API contract
- No load testing performed against stated scale (thousands concurrent, tens of thousands items)

---

## 6. What Was Deliberately Not Built

| Capability | Status | Evidence | Practical Implication |
|------------|--------|----------|----------------------|
| **Redis / distributed cache** | Not implemented | `ARCHITECTURE.md §10` constraints; `package.json` has no Redis dependency | Session/rate-limit state in process memory; no horizontal scaling of auth/rate-limit without Redis |
| **Dedicated search engine** (Elasticsearch/OpenSearch) | Not implemented | `ARCHITECTURE.md §10`; `package.json` has no search deps | `ILIKE` search only; no full-text relevance, faceting, or typo tolerance |
| **Microservices** | Not implemented | Decision 1: Modular monolith; single deployable unit | All modules deploy together; no independent scaling |
| **WebSockets / real-time push** | Not implemented | `ARCHITECTURE.md §14`; no `ws` usage in frontend; `ws` in backend only for Neon driver | No live updates; UI relies on polling/refetch |
| **SSO / OAuth** | Not implemented | `ENGINEERING_DECISIONS.md Phase 3`: "No refresh tokens, OAuth/SSO, password reset, or account registration (out of scope)" | Only seeded demo users; no user registration or external identity providers |
| **Email / webhook delivery** | Not implemented | `outbox/handler.ts:10-23`: "no approved downstream integration... handler validates and acknowledges... never 'delivered'"; `SECURITY_AUDIT.md` L-06 | Outbox worker only validates/acknowledges; no notifications sent |
| **File attachments** | Not implemented | `ARCHITECTURE.md §14`; no file storage deps | Work items cannot have attachments |
| **Read replicas / partitioning** | Not implemented | `ARCHITECTURE.md §10` constraints | All reads/writes to primary; no horizontal read scaling |
| **Cursor pagination** | Not implemented | `ARCHITECTURE.md §15`: "Pagination is offset-based, not cursor-based" | Deep paging degrades; exact `COUNT(*)` expensive at scale |
| **Comments/Activity read endpoints** | Tables exist, **read routes not built** | `ARCHITECTURE.md §7`: "The two read endpoints for comments and activity history are **not implemented**"; Phase 6 confirmed | Frontend renders no activity timeline or comments UI |
| **User registration / password reset** | Not implemented | `ENGINEERING_DECISIONS.md Phase 3`: "out of scope for this phase" | Only seeded demo users exist |
| **Refresh tokens / server-side revocation** | Not implemented | `ENGINEERING_DECISIONS.md Phase 3`: "stateless... no server-side revocation list" | Leaked token valid until expiry (15 min default) |
| **Account-level rate limiting** | Not implemented | `SECURITY_AUDIT.md` M-01/M-03: "throttling is IP-only, not per-account" | Behind proxy without `trust proxy`, all clients share one bucket |

### Classification
| Category | Items |
|----------|-------|
| **Deliberately deferred** (explicit in docs) | Redis, search engine, read replicas, partitioning, microservices, WebSockets, SSO, email/webhook, file attachments, cursor pagination, user registration, password reset, refresh tokens |
| **Not implemented** (tables exist, read paths missing) | Comments read endpoint, Activity history read endpoint |
| **Unknown intent** (no explicit record) | Account-level rate limiting, distributed cache for auth, failed-job alerting |

---

## Appendix: Key Source References

| Area | Files |
|------|-------|
| Data model | `backend/src/db/schema/*.ts` |
| Concurrency (claim, update, transition) | `backend/src/items/repository.ts:198-276`, `backend/src/items/service.ts:418-705` |
| Idempotency | `backend/src/common/idempotency.ts` |
| Authorization | `backend/src/auth/policy.ts`, `backend/src/auth/authorize.ts`, `backend/src/auth/repository.ts` |
| Transactional outbox (producer) | `backend/src/items/service.ts:338-357`, `backend/src/items/outbox.ts` |
| Outbox worker (consumer) | `backend/src/outbox/worker.ts`, `backend/src/outbox/handler.ts`, `backend/src/outbox/repository.ts` |
| Pagination & filtering | `backend/src/items/repository.ts:121-148`, `backend/src/items/service.ts:116-179` |
| Activity events | `backend/src/items/activity.ts`, `backend/src/db/schema/activity_events.ts` |
| Auth (JWT, sessions) | `backend/src/auth/middleware.ts`, `backend/src/auth/tokens.ts`, `backend/src/auth/routes.ts` |
| Verification tests | `backend/src/verification.integration.test.ts`, `backend/src/items/mutations.integration.test.ts` |
| Security audit | `SECURITY_AUDIT.md` |
| Architecture spec | `docs/ARCHITECTURE.md` |

---

*Generated by investigating the current repository state. All claims verified against source code, schema definitions, migrations, tests, and existing documentation. Discrepancies between specification and implementation are documented explicitly.*