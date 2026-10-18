# Newtonite Operations Under Pressure

An internal operational work-management application designed to replace fragmented coordination through chat, spreadsheets, email, and direct conversations. It enables teams to create, assign, track, discuss, approve, resolve, and close operational work while maintaining a complete audit trail of all decisions and changes.

## Project Overview

Newtonite Operations Under Pressure helps users understand:
- What work exists and why
- Current status and priority
- Current ownership
- Historical changes and decisions
- What requires attention next

### Supported Work Item Types
- Incident
- Customer issue
- Payment investigation
- Compliance request
- Task

### Expected Scale
- Thousands of registered users
- Hundreds to a few thousand simultaneous users
- Multiple teams
- Tens of thousands of active work items
- Large and continuously growing activity history

## Approved Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React + TypeScript | User interface |
| Frontend State Management | TanStack Query | Server state fetching, caching, and synchronization |
| Backend | Node.js + Express + TypeScript | REST API server |
| Database | PostgreSQL | Source of truth for all business data |
| ORM | Drizzle ORM | Type-safe schema definitions and queries |
| Migration Tooling | Drizzle Kit | Database schema migrations |
| Testing | Vitest + Supertest | Unit and integration testing |
| Local Development | Docker Compose | Local environment orchestration |

**Constraints:** Prisma is prohibited. Architecture is a modular monolith.

## Key Features

### Dashboard (Operational Views)
1. **Assigned to Me** - Work items assigned to the authenticated user
2. **Unassigned Urgent** - Urgent priority unassigned work items (team-scoped)
3. **Awaiting My Approval** - Work items awaiting approval for authorized Leads (team-scoped)

All views support server-side search, filtering, deterministic ordering, and cursor pagination - with no loading of full datasets into memory.

### Roles & Permissions (Team-Scoped)
| Action | Viewer | Member | Lead | Admin |
|---|---|---|---|---|
| View permitted team items | Yes | Yes | Yes | Yes |
| Create work items | No | Yes | Yes | Yes |
| Edit permitted item fields | No | Yes | Yes | Yes |
| Claim unassigned work | No | Yes | Yes | Yes |
| Approve workflow step | No | No | Yes | Yes |
| Manage team membership | No | No | No | Yes |

*All permissions are scoped to teams. Server-side enforcement is mandatory - hiding UI controls is not an authorization mechanism.*

### Workflow
`Open → In Progress → Awaiting Approval → Resolved → Closed`

- Server enforces allowed transitions
- Only Leads authorized for the item's team may perform approval actions
- Clients cannot bypass by submitting arbitrary status values
- Reopening Closed items is out of scope

### Collaboration & Audit
- Comments on work items
- Append-only activity history (status, assignee, priority changes with before/after values)
- Business mutations and activity events committed in the same PostgreSQL transaction
- Optimistic concurrency via versioning (409 on stale updates)
- Atomic claim (exactly one winner on concurrent attempts; 409 on conflict)
- Idempotency keys for retry-sensitive operations
- Transactional outbox for reliable async processing (bounded retries, idempotent handlers)

## Documentation

- [Assignment Checklist](docs/ASSIGNMENT_CHECKLIST.md) - Complete requirements tracking
- [Architecture](docs/ARCHITECTURE.md) - System design, data model, API inventory, diagrams
- [Implementation Roadmap](docs/IMPLEMENTATION_ROADMAP.md) - 9-phase implementation plan with timeline
- [Engineering Decisions](ENGINEERING_DECISIONS.md) - Five final engineering decisions with rationale

## Current Implementation Status

**Status:** Documentation phase complete. This repository currently contains specification documentation only. No application code, dependencies, or build artifacts have been implemented as per the documentation executor boundaries.

See the [Assignment Checklist](docs/ASSIGNMENT_CHECKLIST.md) for detailed status of all requirements.

## Development Setup (Planned)

*The following setup instructions will be finalized during implementation phases. No working commands, credentials, or deployments are assumed in this documentation.*

### Prerequisites (Planned)
- Node.js (LTS)
- Docker and Docker Compose
- PostgreSQL (via Docker Compose)

### Environment Setup (Planned)
```bash
# Clone repository
git clone <repository-url>
cd newtonite-assignment

# Start PostgreSQL
docker compose up -d

# Install dependencies (backend)
cd backend && npm install

# Install dependencies (frontend)
cd frontend && npm install
```

### Database Operations (Planned)
```bash
# Generate migrations
npm run db:generate

# Run migrations
npm run db:migrate

# Seed database with demo data
npm run db:seed
```

### Running the Application (Planned)
### Running the Application
```bash
# Start backend (dev)
cd backend && npm run dev
# Start frontend (dev)
cd frontend && npm run dev
```
cd frontend && npm run dev
### Testing (Planned)
### Testing
# Run all tests
# Run all tests
cd backend && npm run test
# Run with coverage
npm run test:coverage
# Type checking
cd backend && npx tsc --noEmit
cd frontend && npx tsc --noEmit
cd backend && npx tsc --noEmit
# Database (Drizzle)
cd backend && npm run db:generate
cd backend && npm run db:migrate
## Critical Testing Requirements

The following behaviors must be verified with real PostgreSQL integration tests:
1. **Concurrent claim** - Exactly one succeeds; loser gets 409
2. **Stale update** - Rejected with 409; newer data intact
3. **Idempotency** - Duplicate requests produce one logical operation
4. **Workflow enforcement** - Invalid transitions/unauthorized approvals fail
5. **Resource authorization** - Cross-team access denied
6. **Audit atomicity** - Failed activity insert rolls back mutation

## Known Limitations (To Be Documented)

Known limitations will be documented during Phase 9 (Submission Hardening). Current known constraints from specification:
- User registration is out of scope (seeded demo users only)
- Reopening Closed items is out of scope
- No Redis, dedicated search engine, read replicas, or partitioning in initial build
- WebSockets, SSO, email delivery, file attachments are not part of initial implementation
- Transactional outbox worker is conditional (P1) and may be minimal/skipped if timeline constrained

## Submission Information

- **Submission Deadline:** Monday, 19 October 2026, 10:00 AM
- **Target Submission:** Monday, 19 October 2026, 9:30 AM (30-minute buffer)
- **Repository Access:** Public repository access (to be confirmed at submission)

### Fresh-Clone Verification (Planned)
Fresh-clone verification steps will be documented in Phase 9 to ensure reproducible setup from a clean checkout.

## License

This project is for assessment purposes as specified in the assignment.
