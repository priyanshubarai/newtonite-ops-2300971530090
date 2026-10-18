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

## Summary

All five decisions are **final** for the initial implementation:
1. Modular monolith with clear boundaries
2. PostgreSQL + Drizzle ORM + Drizzle Kit (Prisma prohibited)
3. Atomic claim + optimistic concurrency with 409 Conflict semantics
4. Team-scoped authorization + server-side workflow enforcement (Lead-only approval)
5. Idempotency + transactional audit (same-tx) + transactional outbox (bounded retries, idempotent handlers)

These decisions directly address the critical correctness behaviors required by the assignment while maintaining the approved scope and technology constraints.