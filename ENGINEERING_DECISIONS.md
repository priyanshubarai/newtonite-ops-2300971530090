# Engineering Decisions - Newtonite Operations Under Pressure

This document records the five approved engineering decisions for the initial implementation, as specified in the authoritative specification. These decisions are final and are documented faithfully without reopening alternatives or adding competing options.

## Decision 1: Modular Monolith

### Context
The application needs to support hundreds to thousands of concurrent users, tens of thousands of active work items, and large activity history while maintaining strong correctness guarantees (transactions, atomicity). The assessment evaluates engineering judgment, correctness, maintainability, and performance.

### Decision
Use a **single TypeScript application** with a **modular monolith** architecture and **clear module boundaries**.

### Rationale
- **Transactional consistency:** Shared PostgreSQL allows cross-module operations to commit in a single transaction (critical for audit + mutation atomicity).
- **Simplicity:** Avoids distributed system complexity (service discovery, network failures, eventual consistency) for the scope of this assignment.
- **Implementation speed:** Faster to build, test, and verify correctness compared to microservices.
- **Maintainability:** Logical separation of concerns without operational overhead.
- **Testing:** Easier to write integration tests against real transactions.

### Trade-offs
- **Scaling:** Less granular horizontal scaling than microservices (trades deployment flexibility for simplicity).
- **Deployment coupling:** All modules deploy together (acceptable for initial implementation).
- **Module boundaries:** Require discipline to maintain logical separation despite physical proximity.

### Failure Modes Addressed
- Partial updates across domains (prevented via transactions)
- Inconsistent audit trails (enforced by same-transaction writes)
- Complex integration test setup (mitigated by single app + real DB)

### Verification Strategy
- Module structure enforces clear boundaries in code organization
- Transaction helpers ensure business mutation + activity event share transactions
- Integration tests verify atomicity (rollback on failure)
- Architecture documentation clearly defines module responsibilities

---

## Decision 2: PostgreSQL and Drizzle ORM

### Context
The system requires strong ACID guarantees for correctness-critical operations (claims, versioning, audit, idempotency). Data integrity, constraints, and explicit transaction control are essential.

### Decision
Use **PostgreSQL** as the source of truth. Use **Drizzle ORM** for typed schema definitions and database queries, and **Drizzle Kit** for migrations. **Prisma is prohibited.**

### Rationale
- **ACID compliance:** PostgreSQL provides robust transactional guarantees.
- **Type safety:** Drizzle provides end-to-end TypeScript types from schema.
- **Explicit control:** Drizzle allows fine-grained control over SQL, transactions, and conditional updates.
- **Migrations:** Drizzle Kit provides explicit, reviewable migration files.
- **Fit for correctness:** Direct SQL/conditional updates support atomic claim semantics cleanly.

### Trade-offs
- **Learning curve:** Team must be comfortable with Drizzle patterns vs Prisma.
- **Boilerplate:** More explicit query building than some ORMs.
- **Migration management:** Requires careful review of generated migrations.

### Failure Modes Addressed
- Race conditions (mitigated via conditional UPDATE with constraints)
- Data integrity violations (enforced by FK/UK/NOT NULL constraints)
- Uncoordinated schema changes (controlled via Drizzle Kit migrations)
- Weak typing leading to runtime errors (addressed by TypeScript inference)

### Verification Strategy
- Drizzle schema defines all tables with constraints
- Migrations apply cleanly on fresh PostgreSQL instance
- Integration tests use real PostgreSQL via Drizzle
- No Prisma dependencies or references in codebase

---

## Decision 3: Atomic Claim and Optimistic Concurrency

### Context
Multiple users may attempt to claim the same unassigned work item simultaneously. Concurrent edits to work items risk overwriting newer data. The system must guarantee exactly one claimant wins and prevent lost updates.

### Decision
- **Atomic claim:** Use a conditional database UPDATE that succeeds only when the item is still unassigned. Exactly one concurrent claimant wins; losing attempts return **409 Conflict**.
- **Optimistic concurrency:** Use a monotonically increasing `version` number on work items. Updates succeed only when the supplied version matches the current database version. Successful updates increment the version. Stale updates return **409 Conflict** without overwriting newer data.

### Rationale
- **Correctness under concurrency:** Database-level conditional updates eliminate race windows.
- **Data safety:** Optimistic concurrency prevents lost updates in multi-user scenarios.
- **API semantics:** 409 Conflict clearly indicates concurrency/conflict state.
- **Performance:** No pessimistic locking overhead for typical read-modify-write flows.

### Trade-offs
- **Retry burden:** Clients must handle 409 and retry with fresh state (acceptable).
- **Version tracking:** Requires including version in update requests and responses.
- **No forced overwrite:** Cannot silently merge; explicit conflict handling required.

### Failure Modes Addressed
- Double-assignment of unassigned items
- Lost updates when multiple users edit simultaneously
- Stale reads overwriting newer state
- Unclear error semantics for concurrent conflicts

### Verification Strategy
- Integration tests simulate concurrent claim attempts (exactly one success)
- Integration tests verify stale version rejected, newer data intact
- Database query uses `WHERE id = ? AND assignee_id IS NULL` (or equivalent) for claim
- Database query uses `WHERE id = ? AND version = ?` returning updated rows to detect staleness

---

## Decision 4: Team-Scoped Authorization and Workflow Enforcement

### Context
Authorization must be team-scoped (roles are scoped to teams, not globally). Workflow transitions must follow the exact state machine. Clients cannot be trusted to enforce rules. The matrix is fixed as specified.

### Decision
- **Server-side enforcement:** Authorization is checked on the server for every protected operation. Hiding frontend controls is **not** an authorization mechanism.
- **Team-scoped RBAC:** Permissions derive from the user's membership and role in the **item's team**. All permissions team-scoped.
- **Workflow enforcement:** Server validates allowed transitions from current state. Only an authorized **Lead** for the item's team may perform the approval action.
- **Matrix compliance:** Follow exact matrix: Viewer (view only), Member (create/edit/claim), Lead (approve/reassign within team + member rights), Admin (manage memberships + other rights). All team-scoped.

### Rationale
- **Security:** Never trust client input for authorization or workflow.
- **Correctness:** Prevents bypassing approval requirements or cross-team access.
- **Clarity:** Centralized authorization logic reduces duplication and errors.
- **Compliance:** Matches specification exactly without additions/removals.

### Trade-offs
- **Latent authorization checks:** Every request must load team membership context.
- **Error messages:** Careful use of 401/403/404 to avoid information leakage.
- **Frontend UX:** Must handle authz failures gracefully despite not relying on UI hiding.

### Failure Modes Addressed
- Privilege escalation across teams
- Unauthorized approval of workflow steps
- Invalid state transitions submitted by clients
- Bypassing business rules via direct API calls

### Verification Strategy
- Authorization middleware/guards on all protected routes
- Integration tests verify cross-team access denied
- Integration tests verify unauthorized approval rejected
- Integration tests verify invalid transitions rejected
- Matrix documented and enforced in code logic

---

## Decision 5: Idempotency, Audit History, and Transactional Outbox

### Context
Retry-sensitive operations (e.g., network retries) can cause duplicate side effects. Audit history must be complete and consistent with business changes. Secondary asynchronous work should be reliable without compromising core transactionality.

### Decision
- **Idempotency keys:** Use idempotency keys for retry-sensitive operations. Persist request identity, key, and original result under appropriate unique constraints. Replaying same key+same request returns original result. Reusing key for different request is rejected.
- **Atomic audit:** Write work-item mutation and activity event in the **same PostgreSQL transaction**. Each activity event records actor, work item, event type, timestamp, and before/after values. History is append-only.
- **Transactional outbox:** For secondary async work, insert outbox job in the same transaction as business mutation. Process jobs in separate worker with **bounded retries** and **idempotent handlers**. Outbox worker is lower priority than core product and correctness tests.

### Rationale
- **Safety on retries:** Prevents duplicate mutations from client/network retries.
- **Audit integrity:** Guarantees audit event exists if and only if mutation committed (or both rolled back).
- **Reliability:** Transactional outbox ensures "at least once" delivery without 2PC complexity.
- **Operational clarity:** Append-only audit provides full change history for "what changed, when, by whom, and why".

### Trade-offs
- **Storage:** Idempotency records and outbox jobs require retention/cleanup strategy (not specified for initial).
- **Worker complexity:** Separate process needed; must handle retries, idempotency.
- **Eventual consistency:** Async processing means secondary effects may lag (acceptable for non-blocking work).
- **Deadline sensitivity:** Worker is P1/conditional per roadmap to protect P0.

### Failure Modes Addressed
- Duplicate processing on client retries
- Audit/logging divergence from actual state changes
- Lost async events on process crash (outbox recovery)
- Infinite retry loops (bounded retries)
- Reuse of idempotency keys for different operations

### Verification Strategy
- Idempotency middleware stores/retrieves by key with request hash check
- Integration tests verify duplicate requests produce one logical operation
- Integration tests verify audit atomicity: failed activity insert rolls back mutation
- Outbox jobs inserted in same transaction as triggering mutation
- Worker implements retry count limits and idempotent handlers
- Activity events immutable (append-only; no updates/deletes)

---

## Implementation Notes (Phase 2 — Schema)

These are schema-level implementation details. They do **not** change any of the five approved architectural decisions above.

### Enums as PostgreSQL types
Fixed value sets are stored as real PostgreSQL enum types rather than text + check constraints: `team_role`, `work_item_type`, `work_priority`, `work_status`, `activity_event_type`, `idempotency_state`, `outbox_status`. This gives database-level validation and type safety for role, status, priority, type, and processing-state values.

### Activity before/after in one JSONB column
Activity events store before/after values together in a single `metadata` JSONB column (e.g. `{ "before": ..., "after": ... }`) instead of separate `before_values`/`after_values` columns. This keeps the append-only record simple while preserving all required values.

### Idempotency scope + key
Idempotency records use a `scope` + `key` pair with a unique index `ir_scope_key_unique (scope, key)`. A `request_hash` column stores a fingerprint of the original request so reuse of the same key for a *different* request can be detected and rejected. `state` (`IN_PROGRESS`/`COMPLETED`/`FAILED`), `status_code`, `response_body`, and `expires_at` support safe replay and retention.

### Restrictive deletion for audit integrity
Foreign keys referenced by audit history use `ON DELETE RESTRICT` (not cascade) so users/work items with historical activity cannot be silently removed. The only exception is `work_items.assignee_id`, which is `SET NULL` — an assignee leaving does not destroy the item or its history.

### Same-team assignee invariant not enforced in DB
The "assignee must belong to the same team" invariant is **not** enforced by a database constraint (a composite FK would require restructuring team/user keys). It is deferred to the authorization/domain service in a later phase, per the assignment's allowance.

### Seed determinism
The seed uses deterministic UUIDs (SHA-1 v5-style from a fixed namespace) and upserts keyed on unique columns (email, slug, membership pair, idempotency scope+key, item id). This makes re-runs idempotent — no duplicate logical records. Passwords are hashed with bcrypt (never plaintext); the demo password is development-only and configurable via `DEMO_PASSWORD`.

---

## Implementation Notes (Phase 3 — Authentication & Authorization)

These are implementation-level details for the auth foundation. They do **not** change any of the five approved architectural decisions above.

### Short-lived signed bearer tokens (JWT, HS256)
No auth mechanism existed in the repository, so per the assignment default I implemented short-lived signed bearer tokens using `jsonwebtoken` (HS256) with a server-side `JWT_SECRET` from the environment (min 32 chars, never committed). Trade-offs: stateless and simple to integrate on the later frontend, but a compromised secret requires rotation and there is no server-side revocation list — acceptable given the short 15-minute default expiry and that this is an internal tool.

### Roles loaded from the database, not the token
The token carries only the user id (`sub`). Memberships and roles are read fresh from PostgreSQL on every request. This is a deliberate choice over embedding roles as token claims: a role change or membership revocation takes effect on the next request instead of waiting for the token to expire. Cost: one small indexed membership lookup per authorized request, which the `user_team_unique` / `utm_user_idx` indexes serve cheaply.

### Generic login failures
Unknown email, wrong password, and deactivated account all return the identical `401 "Invalid email or password"`. A dummy bcrypt compare is performed on the unknown-email path so response timing does not distinguish "no such user" from "wrong password". No user-existence leakage.

### 404 (not 403) for cross-team access
When a caller is not a member of the target team, authorization returns `404` rather than `403`, so a caller cannot enumerate which team ids exist. `403` is reserved for a member whose role lacks the required action. Malformed team/user UUIDs fail closed as `404` before ever reaching the database.

### Fail-closed policy
`roleCan` denies any action for a missing or unrecognized role, and the authorization helper validates UUID format and re-reads the membership each time. There is no global admin bypass — authority is always scoped to one concrete team.

### Reused bcrypt for password verification
The seed already used `bcryptjs` to hash demo passwords, so login verification reuses the same library (no new dependency, consistent hash format). Plaintext is never stored, logged, or compared directly.

---

## Implementation Notes (Phase 4 — Work-Item API)

Implementation-level details for the read/create/update work-item endpoints. They do **not** change any of the five approved architectural decisions above, and they deliberately stop short of the Phase 5 correctness work.

### Layering: routes → service → repository
The auth module put most logic in the route file; work items have more orchestration (membership resolution, authorization against a resource's real team, assignee rules), so they are split into `items/{validation,repository,service,routes,serialize}.ts`. Routes stay thin (parse + translate), the service owns authorization and business rules, and the repository owns all SQL. This keeps the Phase 5 additions (audit writes, version guard) localized.

### Shared `ApiError` + central error handler
Services throw a small `ApiError(status, message, details?)` and a thin `asyncHandler` forwards rejections to the existing central Express error handler, which maps an `ApiError` to its status with the established `{ error }` body (plus optional field-level `details`) and everything else to a generic `500`. No new error shape was introduced — it matches the Phase 3 auth convention.

### Team scoping and 404-not-403
Listing is always constrained to the caller's membership team ids. Detail and update load the resource first and authorize against its **real** `team_id` from the database. As in Phase 3, a non-member is concealed as `404` and an under-privileged member gets `403`. A `teamId` list filter naming a non-member team yields an empty page rather than an error, so membership is not disclosed.

### Malformed ids fail closed as 404
A malformed `:id` on detail/update is treated as `404` (consistent with the Phase 3 convention of failing closed on malformed UUIDs) rather than `400`, so it cannot be distinguished from a non-existent item. Malformed UUIDs **in a body or query** remain `400` because they are ordinary input-validation failures and reveal nothing about other tenants.

### Server-owned fields cannot be set by clients
`POST`/`PATCH` bodies use zod `.strict()` schemas, so supplying `status`, `version`, `createdBy`, `id`, or timestamps is a `400` rather than a silent override. `createdBy`, `status = OPEN`, and `version = 1` are set by the server from the authenticated identity.

### Exact totals and deterministic ordering
`GET /items` returns an **exact** `COUNT(*)` over the same filters (a second indexed query, not an estimate). Ordering appends `id` ascending as a tie-breaker so pagination is stable. `pageSize` is bounded (1–100) and out-of-range values are rejected rather than clamped, so the cap cannot be bypassed silently.

### Same-team assignment enforced in the service
The Phase 2 note deferred the "assignee belongs to the same team" invariant out of the database. Phase 4 enforces it in the service: a supplied `assigneeId` is checked via a membership lookup (`getTeamRole`) and rejected with `400` if the user is not a member of the item's team. Any team role (including Viewer) may be assigned work; cross-team and non-member assignment are always refused.

### Deliberately deferred to Phase 5 (documented gaps)
- **No activity/audit events** are written on create/update yet; the service is structured so Phase 5 can wrap the mutation and its activity insert in one interactive transaction.
- **No optimistic concurrency**: `version` is returned but neither checked nor incremented, so `PATCH` is last-write-wins. `repository.updateWorkItem` is the single place to add `WHERE id = ? AND version = ?` + `409`.
- Claim, status transitions, comments, activity history, and idempotency remain out of scope.

---

## Implementation Notes (Phase 5 — Critical Mutations)

Implementation-level details for atomic claim, guarded workflow transitions, optimistic concurrency, idempotency, and transactional activity/outbox writes. They refine the approved Decision 3 (atomic claim + optimistic concurrency) and Decision 5 (idempotency + transactional audit/outbox) without changing either decision.

### Driver transaction capability verified before writing critical mutations
The runtime driver is `drizzle-orm/neon-serverless` over a Neon `Pool` (WebSocket). Before implementing any critical mutation I confirmed empirically (a throwaway probe, since removed) that this driver supports interactive multi-statement transactions, rolls back on a thrown error, and executes `pg_advisory_xact_lock`. No driver change was needed and no transaction was faked.

### One transaction per mutation, threaded through `TxClient`
`db.transaction(async (tx) => ...)` wraps every mutation. The item change, version increment, activity event, outbox job, and idempotency record are all written on the same `tx`. Repository mutation functions take a `TxClient`; read functions stay on the shared `db`. Authorization reads use `db` on a separate connection because memberships are never modified inside the mutation.

### The database decides the winner (conditional single-statement updates)
Under a race, correctness comes from the database, never from a prior `SELECT`:
- update: `UPDATE ... WHERE id = ? AND version = ?` (and `version = version + 1`)
- claim: `UPDATE ... WHERE id = ? AND assignee_id IS NULL AND status IN (claimable)`
- transition: `UPDATE ... WHERE id = ? AND version = ? AND status = from`

A zero-row result is mapped to `404`/`409`. There is no application-level lock and no read-then-write race.

### Workflow enforced by an explicit edge map
`items/workflow.ts` defines `WORKFLOW_NEXT` (exactly one allowed successor per status), so skipping, reversing, and reopening `CLOSED` are impossible by construction. Validation order is load → authorize → assert-valid-edge, so an unauthorized caller never learns whether an edge would have been valid; and authorization's required action depends on the edge (approval edge → `approve_transition`, everything else → `edit_item`).

### Stable conflict codes on the existing error shape
`ApiError` gained an optional `code`. `409` conflicts carry a stable machine-readable code (`STALE_VERSION`, `ALREADY_ASSIGNED`, `NOT_CLAIMABLE`, `INVALID_TRANSITION`, `IDEMPOTENCY_KEY_REUSED`) alongside the established `{ error }` body, so no existing error shape changed.

### Idempotency via PostgreSQL primitives, never memory
Keys are scoped to `user:<id>:<endpoint>`. The first statement of the idempotency transaction is `pg_advisory_xact_lock(hashtext(scope:key))`, which serializes same-key requests for the life of the transaction and releases on commit/rollback (so it works across processes). The `(scope, key)` unique index is the database-enforced backstop. A request is marked `COMPLETED` only after the business work commits; any failure rolls the record back together with the mutation, so failures are never cached and never consume the key.

### Additive enum migration for `ITEM_UPDATED`
The `activity_event_type` enum had no generic field-update value, but the phase requires recording work-item field updates. The smallest justified change was `ALTER TYPE "public"."activity_event_type" ADD VALUE 'ITEM_UPDATED'` (migration `0001_yummy_the_captain.sql`) — additive, non-destructive, and it never touches historical audit rows.

### Outbox conventions defined minimally
There was no pre-existing job format, so `items/outbox.ts` fixes one: a stable `job_type` per action (`work_item.created`/`updated`/`claimed`/`transitioned`) and a payload of `{ workItemId, teamId, actorId, status, version }`. Jobs are inserted in the mutation transaction. There is no worker in this phase.

### Test timeouts raised for remote-Neon integration
`vitest.config.ts` sets `testTimeout: 30000` / `hookTimeout: 60000` because three integration suites share one remote Neon database over WebSockets and the defaults were too tight for fixture setup.

### Known limitations (documented, not hidden)
- No outbox worker / delivery (insertion only).
- No idempotency purge (`expires_at` is a retention hint, 24h).
- Comments and activity-history read endpoints remain out of scope.
- Claimable = `OPEN`/`IN_PROGRESS`, an interpretation over the existing status model (no new statuses).

---

## Implementation Notes (Phase 6 — Integration, Security, Regression Verification)

Phase 6 audited the Phase 1–5 implementation against the running application and the live Neon database, fixed two genuine defects with minimal, in-design changes, and added a focused regression/verification suite (`backend/src/verification.integration.test.ts`). No decision above changed, and no validation/authorization/type-safety was weakened to make checks pass.

### Defect 1 — malformed/oversized request bodies were reported as 500
The central error handler in `app.ts` only recognised `ApiError`, so an Express body-parser failure (which throws an error carrying its own 4xx `status`) fell through to the generic `500` branch. A malformed JSON body therefore returned `500` instead of `400`. Fix: a small `clientErrorStatus` helper maps a non-`ApiError` with an integer 4xx status to that status with a generic, non-leaky message (`Invalid request` for `400`, `Payload too large` for `413`, `Unsupported media type` for `415`). Genuine unexpected errors still return a generic `500`.

### Defect 2 — an out-of-range `page` overflowed the SQL OFFSET and returned 500
`listItemsQuerySchema` accepted any integer `page` ≥ 1. A huge value (e.g. `1e20`) produced an `OFFSET` such as `2e+21`, which PostgreSQL rejects (`22P02 invalid input syntax for type bigint`), surfacing as a `500`. Fix: `page` is capped at `Number.MAX_SAFE_INTEGER`, which keeps `page × pageSize` (≤ `MaxSafeInteger × 100`) within PostgreSQL's `bigint`, so absurd values are now a `400`. The approved `pageSize` contract (default 20, max 100, over-cap → `400`) was preserved unchanged.

### What Phase 6 verified against real PostgreSQL
Authentication boundaries (missing/malformed/expired/forged tokens → `401` on every items endpoint); generic login failures (no account-existence disclosure); response hygiene (no SQL, stack traces, or secrets in error bodies); live membership revocation and role promotion/demotion honoured on the next request through the real API; cross-team isolation across every mutation endpoint (`404`, fail-closed); the pagination contract; `POST`/`PATCH` input validation; idempotency guards (over-long key rejected with no record, validation failure not cached and key not consumed); and live migration state (the additive `ITEM_UPDATED` enum value is applied and both migrations are recorded, matching the local journal). Concurrency, workflow, and transactional-atomicity guarantees were already covered by the Phase 5 suite and re-run green.

### Coverage gap confirmed, not invented
The Phase 6 brief lists "comment on another team's item" as an isolation case, but there is **no comments endpoint** (comments were excluded in earlier phases), so there is no route to exercise. Item-level cross-team isolation is verified against every existing mutation endpoint instead. This is recorded as a scope note rather than a new endpoint.

---

## Implementation Notes (Phase 7 — React Frontend and Operations Dashboard)

Phase 7 built the frontend on the frozen Phase 1–6 API. **No backend file was changed, no endpoint was added, and no decision above was revisited.** Every request the UI makes maps to a route verified in Phase 4–6, and every contract the UI depends on (pagination bounds, `expectedVersion`, idempotency keys, error codes, role capabilities) was read from the backend source rather than assumed.

### A typed client, not scattered `fetch`
All HTTP goes through `frontend/src/api/client.ts`; `items.ts` / `auth.ts` call it and expose one function per real route. The client owns base URL resolution, bearer attachment, query-string building (empty values dropped), `Idempotency-Key`, and parsing of the backend's `{ error, code, details }` shape into an `ApiError`. Concentrating this means the token is touched in exactly one place and cannot leak into a log or a rendered message.

### Same-origin `/api` proxy instead of a backend CORS change
The backend was not modified. The frontend targets the same-origin `/api` prefix and Vite proxies `/api/*` to `http://localhost:3000`, rewriting the prefix away. This keeps the browser free of cross-origin requests and avoids loosening the server's origin policy for a development convenience.

### In-memory token, and an honest logout
The token lives in a module-level store read through `useSyncExternalStore`; there is no `localStorage`/`sessionStorage`. The consequence — a refresh signs the user out — is documented rather than worked around. Because the backend issues stateless tokens and exposes no revocation endpoint, sign-out clears only client-held state (token + query cache) and does not pretend to revoke anything server-side.

### The 401 rule that protects the login screen
The client invokes the session-expiry handler **only for requests that carried a token**. A failed login is a `401` with no token attached, so it cannot clear a session or be mistaken for expiry. This is why the login call sets `auth: false`.

### Optimistic concurrency surfaced, never hidden
The edit form submits the `version` it read as `expectedVersion`; the value is never rendered as a control. A `409 STALE_VERSION` produces a conflict message and a **Reload latest version** action that refreshes the version while deliberately **keeping the user's unsaved edits**, then says so. There is no silent retry and no automatic overwrite — the brief's explicit requirement. `409 IDEMPOTENCY_KEY_REUSED` and invalid-transition conflicts are handled as distinct messages.

### Idempotency keys tied to payload, not to clicks
`useStableIdempotencyKey(fingerprint)` derives the key from a serialisation of the payload. Retrying the same logical request reuses the key (so a duplicate submission replays instead of double-creating); editing the payload mints a new one. This is what makes retry safe without a client-side dedupe table.

### Claim is not optimistic; lost races are recoverable
The claim button is disabled while in flight and shows pending text; it never assumes success. A `409` (already assigned / not claimable) re-fetches the item and explains the outcome. The same pattern covers a transition that has become invalid or stale. Transitions are derived from a mirror of the backend's edge map, so only the single next step is offered and reopening `CLOSED` is impossible by construction.

### Role checks are convenience, not authorization
`frontend/src/lib/permissions.ts` mirrors `backend/src/auth/policy.ts` solely to avoid offering controls that would certainly be rejected (e.g. approval is shown only to `LEAD`/`ADMIN` in the item's team). The backend re-authorizes every request; the UI never treats its own check as enforcement. Status is excluded from the general edit form, so status can only change through the transition endpoint.

### Filtering and pagination follow the real contract
The list sends only the documented parameters, offers page sizes at or below the API maximum of 100, resets to page 1 when filters change, debounces free-text filters, cancels superseded requests with `AbortSignal`, and refuses to send a partially typed assignee id as a query value. `keepPreviousData` keeps the table populated while paging. No page of data is ever accumulated client-side.

### Testing deps added for a declared-but-missing environment
`frontend/vitest.config.ts` already declared `environment: "jsdom"` and a `setupFiles` entry, but `jsdom` was not installed and there were no test files. Phase 7 added `jsdom` and the `@testing-library/*` dev dependencies so that configuration became real, and wrote 65 tests across 8 files. Only the network boundary is stubbed; the real router, guard, session provider, and API client run. These are client-behaviour tests and are explicitly **not** evidence about backend authorization or security.

### Roadmap Phase 7 items that could not be delivered in-design
The roadmap's Phase 7 also names three preset dashboard views, a comments section, an activity timeline, and cursor pagination. None of these can be built without backend work that this phase was not authorised to do: there is no "unassigned" filter (so "Unassigned Urgent" is inexpressible), no role predicate on the list endpoint, no comments-read route, no activity-read route, and `GET /items` implements offset rather than cursor pagination. Phase 7 implemented the authorised subset and escalated the gap in `docs/ARCHITECTURE.md` §15 (*Requires Architect Review*) instead of inventing endpoints or faking screens.

### Documented frontend limitations
- No activity timeline or comments UI (no read endpoints exist).
- No user/team-member directory, so assignment takes a user UUID (with an "Assign to me" shortcut).
- A page refresh logs the user out (token is in-memory by design).
- Offset pagination, matching the API.

---

## Summary

All five decisions are **final** for the initial implementation:
1. Modular monolith with clear boundaries
2. PostgreSQL + Drizzle ORM + Drizzle Kit (Prisma prohibited)
3. Atomic claim + optimistic concurrency with 409 Conflict semantics
4. Team-scoped authorization + server-side workflow enforcement (Lead-only approval)
5. Idempotency + transactional audit (same-tx) + transactional outbox (bounded retries, idempotent handlers)

These decisions directly address the critical correctness behaviors required by the assignment while maintaining the approved scope and technology constraints.