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

## Summary

All five decisions are **final** for the initial implementation:
1. Modular monolith with clear boundaries
2. PostgreSQL + Drizzle ORM + Drizzle Kit (Prisma prohibited)
3. Atomic claim + optimistic concurrency with 409 Conflict semantics
4. Team-scoped authorization + server-side workflow enforcement (Lead-only approval)
5. Idempotency + transactional audit (same-tx) + transactional outbox (bounded retries, idempotent handlers)

These decisions directly address the critical correctness behaviors required by the assignment while maintaining the approved scope and technology constraints.