# Newtonite --- UI & User Flow Plan

**Document type:** Frontend implementation specification\
**Audience:** Coding agent / frontend engineer\
**Product:** Newtonite operational work management system\
**Primary objective:** Replace the current task-list-only interface with
a focused, reliable operations workspace inspired by useful ClickUp
interaction patterns---without cloning ClickUp or inventing backend
capabilities.

------------------------------------------------------------------------

## 1. Product Context

Newtonite helps teams coordinate operational requests that require
investigation, action, approval, or resolution. Examples include
customer issues, engineering problems, payment investigations,
production incidents, compliance requests, and operational tasks.

The product must help a user quickly answer:

1.  What needs my attention?
2.  What is the current state and priority?
3.  Who owns this item?
4.  What can I legitimately do next?
5.  Has someone changed the item since I loaded it?
6.  Why did an action succeed or fail?

This is an operational reliability tool, not a generic task tracker.
Prioritize clear ownership, actionable queues, workflow correctness, and
trustworthy feedback over decorative analytics or feature breadth.

### Product principles

-   **Server is authoritative.** The UI must never treat a locally
    assumed mutation as final until the server confirms it.
-   **Make attention actionable.** Every dashboard count or queue should
    lead to a filtered list of real items.
-   **Show only valid actions.** Available actions depend on the item
    state and the current user's permissions; the backend remains the
    final enforcement layer.
-   **Make conflicts understandable.** A claim conflict or stale edit is
    a normal collaboration case, not an unexplained generic error.
-   **Use progressive disclosure.** Keep the list compact; expose full
    context in a detail panel.
-   **Keep scope assessment-sized.** Build a small, coherent, polished
    system rather than a partial ClickUp clone.

------------------------------------------------------------------------

## 2. Scope and Non-Goals

### In scope

-   Authenticated application shell.
-   Current-user/team context.
-   Operations dashboard.
-   Searchable, filterable, sortable work queue.
-   Create-work-item flow.
-   Work-item detail side panel or route.
-   Editing supported fields.
-   Claim/ownership flow.
-   Explicit workflow-transition actions.
-   Loading, empty, error, permission-denied, conflict, and success
    states.
-   Pagination driven by the existing API contract.
-   Responsive layout suitable for desktop first and usable on smaller
    screens.
-   Accessible keyboard focus, labels, status text, and confirmation for
    consequential actions.
-   Clear implementation notes for any backend contract gap.

### Explicitly out of scope unless backend support is added

-   Comments or a fully functional discussion thread.
-   A live activity timeline backed by activity-read APIs.
-   Real-time presence, live collaboration indicators, or WebSocket
    updates.
-   Notifications presented as delivered when no worker/delivery path
    exists.
-   Drag-and-drop workflow transitions.
-   Custom workflow builder, custom fields, Gantt, calendar, sprint
    planning, or automation builder.
-   Fake metrics or hardcoded production-looking data.
-   Frontend-only authorization as a security boundary.

The backend has transactional activity/outbox consistency, but
activity-read endpoints and an outbox worker are not currently in scope.
Do not build a functional activity feed or claim notifications are
delivered unless those capabilities are added and verified.

------------------------------------------------------------------------

## 3. UX Direction

Use ClickUp as a reference for: - Persistent left navigation and
team/workspace context. - Dense, scannable work tables. - Clear status
and priority treatments. - Search, filtering, sorting, and saved visual
hierarchy. - Opening an item in a side panel without losing the current
list context. - Contextual actions and predictable modal/form behavior.

Do **not** copy ClickUp's feature surface. Newtonite's visual tone
should be calm, professional, operational, and information-dense.

### Layout principles

-   Desktop-first, because this is an internal operations tool.
-   Fixed or sticky application sidebar on wide screens.
-   Main content gets the available width; avoid oversized cards and
    excessive whitespace.
-   Use neutral surfaces, restrained accent colors, and semantic colors
    only for meaningful states.
-   Status and priority must not be communicated by color alone; always
    include text.
-   Use consistent spacing, typography, border, radius, focus, and
    disabled-state tokens.
-   Avoid decorative charts that do not lead to an action.
-   Preserve filters and list context when opening and closing item
    details.

------------------------------------------------------------------------

## 4. Information Architecture

Primary navigation:

1.  **Overview** --- operational dashboard.
2.  **Work queue** --- all items visible to the current user/team under
    server authorization.
3.  **Assigned to me** --- work currently assigned to the current user.
4.  **Needs attention** --- urgent, unassigned, overdue, or
    awaiting-approval items, but only where the API can support accurate
    filtering.
5.  **Teams** --- team selection and team-scoped work context, if
    supported by current identity/membership responses.
6.  **Sign out** --- end the current session.

Keep the navigation small. If a queue cannot be represented accurately
using current backend filters, do not fake it with incomplete
client-side filtering over a partial page. Either: - use a supported
server query/filter; - derive it from a sufficiently complete result set
only when the backend explicitly guarantees that set is complete; or -
leave the queue as a clearly documented future enhancement.

### Global header

-   Current page title and optional breadcrumb.
-   Search entry point.
-   Current team/context selector only if the authenticated user's
    membership data supports it.
-   Current user menu with sign out.
-   Primary action: **Create work item**.

Do not invent a user profile, team switcher, or role label if the API
does not return the required information.

------------------------------------------------------------------------

## 5. Screen Specifications

## 5.1 Application Shell

**Purpose:** Provide stable navigation and context across the product.

### Layout

-   Left sidebar with Newtonite identity and primary navigation.
-   Main content region.
-   Header with page title, search, and create action.
-   Detail drawer rendered above the main content when an item is
    opened.
-   Mobile/small-screen navigation collapses into a drawer.

### Behavior

-   Highlight the active navigation item.
-   Preserve relevant query parameters (search, filters, sort, page)
    when navigating into an item and back.
-   Handle unauthenticated API responses by clearing invalid session
    state and routing to login.
-   Show a clear error state if initial identity loading fails; do not
    silently render a false authenticated state.

## 5.2 Login

**Purpose:** Authenticate the user using the existing backend contract.

### UI

-   Email/username and password fields matching the API's actual schema.
-   Submit button with pending state.
-   Inline validation and a concise authentication error.
-   Disable repeat submission while the request is pending.
-   Never expose tokens, passwords, or sensitive server details in logs
    or visible error messages.

### Flow

1.  User enters credentials.
2.  Frontend calls the existing login endpoint.
3.  On success, store credentials according to the backend's actual auth
    mechanism and load the current-user endpoint.
4.  Route to Overview or the last safe requested page.
5.  On failure, keep the form values where safe and show an actionable
    message.

Do not assume cookie versus bearer-token auth. Inspect the
implementation and use its actual contract.

## 5.3 Operations Dashboard

**Purpose:** Answer "what should I deal with next?" within a few
seconds.

### Content hierarchy

**A. Attention summary** - Urgent items. - Unassigned items. - Awaiting
approval. - Overdue items, if due dates exist and can be queried
accurately. - Assigned to me.

Only render metrics that can be computed accurately from supported API
responses. Do not use placeholder counts in the real app.

**B. Actionable work sections** - **Assigned to me** - **Urgent /
unassigned** - **Awaiting approval** - **Recently updated**, only if
reliable update metadata and query semantics exist.

Each section should show a small number of items, priority, status,
owner, and a "View queue" link that opens the corresponding filtered
work queue.

**C. Empty states** - Explain that there is no work in that category. -
Provide a relevant next action where appropriate, such as creating an
item or opening the full queue. - Do not make an empty dashboard look
like a loading failure.

### Dashboard behavior

-   Counts and lists must use the same filter definitions.
-   Clicking a count/card opens the work queue with the matching filter
    applied.
-   Loading states should use skeletons or compact placeholders.
-   A failure in one dashboard section should not necessarily blank the
    entire page; show a local retry action.
-   Avoid charts unless real, reliable data makes them useful.

## 5.4 Work Queue

**Purpose:** Main operational workspace. This should be the strongest
and most polished screen.

### Recommended table columns

1.  **Work item** --- title plus stable item identifier.
2.  **Status** --- human-readable current state.
3.  **Priority** --- Urgent / High / Normal / Low, or the exact enum
    returned by the API.
4.  **Assignee** --- user display name when available; otherwise a clear
    Unassigned label.
5.  **Team** --- only if included in item/API context.
6.  **Updated** --- relative time with an accessible exact timestamp
    where metadata exists.
7.  **Row actions** --- compact menu for actions supported by the
    backend and permitted by the current user.

Do not render columns for fields that do not exist in the current model.
Do not invent due dates, teams, categories, or requester fields.

### Toolbar

-   Search input with debounce.
-   Filter controls for status, priority, assignee, team, and other
    supported fields.
-   Sort control for supported server-side sort fields.
-   Clear-filters action.
-   Result count only when the backend supplies a trustworthy total.
-   Create work item button.
-   Optional column configuration only if it can be delivered without
    distracting from core behavior.

### Table behavior

-   Use server-side pagination for large datasets. Never load every item
    to filter or sort in the browser.
-   Use server-side filtering/sorting where the API supports it.
-   If the current API contract does not support a required query
    parameter, document the gap and either add the smallest justified
    backend change or omit that control. Do not pretend a filter is
    server-backed when it is not.
-   Keep the search/filter/sort/page state in URL query parameters where
    practical, so the view can be refreshed or shared.
-   Reset the page index when a filter that changes the result set
    changes.
-   Clicking a row opens the detail panel. Interactive controls inside a
    row must not accidentally trigger row navigation.
-   Provide clear selected-row focus and keyboard access.
-   Support a table skeleton, empty result state, initial-load error,
    and pagination error.
-   When an item is changed, update or invalidate affected queries
    instead of leaving stale values visible.

### Useful empty states

-   No items exist: "No work items yet" with Create work item.
-   Filters match nothing: "No items match these filters" with Clear
    filters.
-   Search matches nothing: explain that no matching item was found.
-   Permission-limited result set: do not imply the entire company has
    no work; say "No items available in this view" where appropriate.

### Do not

-   Add drag-and-drop status updates.
-   Render fake avatars or misleading live-presence indicators.
-   Make the entire row a button if it contains nested buttons without
    correct event handling.
-   Implement client-side pagination on an incomplete server page.

## 5.5 Create Work Item

**Purpose:** Capture operational work quickly without sacrificing data
quality.

### Entry points

-   Global Create work item button.
-   Dashboard empty state.
-   Optional contextual create button in the work queue.

### Form fields

Render only fields supported by the actual create schema. Typical
candidates are: - Title (required). - Description / reason (if
supported). - Priority. - Team or owning team (if supported). - Initial
assignee (optional and only if permitted). - Any actual required domain
fields.

Do not add an invented due date, request type, approval policy, or
custom field simply because a task-management product might have it.

### Form behavior

-   Inline validation before submit, backed by server validation.
-   Pending submit state and protection from repeated clicks.
-   Preserve entered values if the server returns a correctable
    validation error.
-   On success: close the form, invalidate relevant dashboard and queue
    queries, and open the newly created item's detail panel if the
    response includes its identifier.
-   On failure: show a concise message and keep user input.
-   If creation returns a conflict or permission error, explain it
    without implying the item was created.

A modal is appropriate for a compact form. Use a dedicated page only if
the actual schema is too large for a modal.

## 5.6 Work Item Detail Panel

**Purpose:** Show the full context for one item and provide safe,
contextual actions.

### Recommended structure

**Header** - Item identifier. - Title. - Current status. - Priority. -
Close button. - More-actions menu only for supported actions.

**Main content** - Description / reason. - Assignee and team, if
present. - Created and updated timestamps, if present. - Current version
or stale-data feedback only when useful; do not expose internal
implementation details unnecessarily. - Other persisted fields that
exist in the domain model.

**Action area** - Claim item / release claim, if supported by the API
and policy. - Edit supported fields. - Valid next workflow
transitions. - Close panel.

**History** - Do not implement a fabricated timeline. The backend
currently guarantees transactional activity/outbox consistency but does
not expose activity-read endpoints. For the first version, omit the
history timeline or show only information directly returned by the item
endpoint. Document the history UI as blocked on a read API.

### Detail loading and navigation

-   Opening a row fetches current item details using the detail
    endpoint.
-   Show a panel skeleton while loading.
-   If the item was deleted or access is denied, show a clear message
    and offer to close the panel.
-   Keep the underlying queue and its filters intact.
-   Support direct links to a detail route if routing is already in
    place and the backend supports fetching by ID.
-   On close, return focus to the row that opened the panel when
    feasible.

### Editing

-   Use an explicit Edit mode or small inline editors; do not make every
    field editable by default.
-   Keep the item version returned by the server with the edit state.
-   Submit the version expected by the backend's optimistic concurrency
    contract.
-   On a stale-version conflict:
    1.  Do not silently overwrite the latest server state.
    2.  Fetch the latest item.
    3.  Explain that another user changed the item.
    4.  Present the latest server values.
    5.  Let the user review and reapply their changes deliberately.
-   Avoid a blind automatic retry for a non-idempotent edit.

## 5.7 Claim / Ownership Flow

**Purpose:** Prevent two users from believing they own the same work.

### Happy path

1.  User opens an unassigned item.
2.  UI shows Claim item if the current user is eligible.
3.  User clicks Claim item.
4.  Button enters a pending state; repeated clicks are blocked.
5.  Frontend sends the claim request with the backend's required
    idempotency and concurrency metadata.
6.  On success, use the server response as the source of truth and
    update/invalidate item, queue, and dashboard queries.
7.  Show a concise confirmation.

### Conflict path

1.  Another user claims the item first.
2.  Server rejects the claim with its documented conflict response.
3.  Frontend fetches or uses the latest item state.
4.  Show "This item was claimed by another user" or the most accurate
    message available from the server.
5.  Refresh the visible owner and keep the user on the item.

### Rules

-   Never optimistically declare ownership as final before server
    confirmation.
-   If optimistic UI is used, make rollback/reconciliation reliable.
-   Do not assume a release/unclaim action exists unless a backend
    endpoint and policy support it.
-   Distinguish conflict, validation, authorization, and transient
    network failures.

## 5.8 Workflow Transition Flow

**Purpose:** Make valid next actions obvious while respecting
server-enforced workflow rules.

The current product design uses explicit workflow states such as Open,
In Progress, Awaiting Approval, Resolved, and Closed. The exact
canonical values and permitted transitions must be read from the backend
implementation and API contract; do not hardcode a different workflow.

### UI behavior

-   Show current status prominently.
-   Display only the transitions the frontend knows are valid for that
    state and user.
-   Use explicit buttons or a transition menu; no drag-and-drop
    transitions.
-   For consequential transitions, show a confirmation dialog if needed.
-   If the transition requires a reason or other field, collect it only
    if the API contract supports it.
-   Submit the expected item version and idempotency key in the format
    the backend requires.
-   Pending state prevents accidental duplicate submission.
-   On success, update the detail view and invalidate affected
    list/dashboard queries.
-   On conflict or invalid transition, fetch current state and explain
    why the action did not complete.
-   The server is authoritative even when the UI pre-validates
    transitions.

Do not let the frontend alone enforce workflow policy.

## 5.9 Needs Attention Queue

**Purpose:** Provide one practical place for operational exceptions.

Potential categories: - Urgent priority. - Unassigned work. - Awaiting
approval. - Overdue items, if due dates exist. - Items recently changed
by another user, only if the backend provides sufficient metadata.

Implement only categories that can be queried or derived accurately.
Each category should have: - Clear definition. - Count only if
accurate. - Filtered list. - Relevant next action. - Empty state.

Do not create a second independent dataset for this screen; reuse the
work queue with filter parameters.

## 5.10 Teams / Team Workload

This is secondary. Build it only if the current identity/membership and
item contracts expose team membership and team-scoped data.

Minimum useful version: - Select or display the active team. - Show
items visible in that team. - Show unassigned and urgent items if
accurate. - Display workload counts only if the query semantics and
permissions make those counts correct.

Do not build workload charts, employee rankings, or performance scores
for the assessment. They do not prove operational correctness and can be
misleading without robust data definitions.

------------------------------------------------------------------------

## 6. Core User Flows

## Flow A --- Sign in and find work

1.  User opens Newtonite.
2.  If unauthenticated, route to Login.
3.  Successful login loads the current-user context.
4.  User lands on Overview.
5.  User clicks a dashboard attention card or Work queue.
6.  Queue loads with supported filters.
7.  User searches, filters, sorts, or paginates.
8.  User opens a row to inspect details.

**Acceptance criteria** - Login errors are clear and do not expose
secrets. - Queue filters are reflected in the UI and preserved when
opening/closing details. - Loading, empty, and error states are
distinct.

## Flow B --- Create and assign work

1.  User clicks Create work item.
2.  User completes required fields.
3.  Frontend validates the form.
4.  Backend validates and creates the item.
5.  UI closes the form and refreshes relevant queries.
6.  Detail panel opens for the created item when possible.
7.  User claims the item or assigns it using a supported action.

**Acceptance criteria** - Repeated submit does not create accidental
duplicate items. - Validation errors preserve useful input. - No success
state is shown before the server confirms creation.

## Flow C --- Claim an item with competing users

1.  User A and User B open the same unassigned item.
2.  Both see Claim item.
3.  User A claims it successfully.
4.  User B attempts to claim using a separate session.
5.  Backend accepts one claim and rejects the other according to its
    atomic claim contract.
6.  User B sees the current owner and a clear conflict message.

**Acceptance criteria** - The UI cannot leave both users believing the
item is theirs. - A rejected claim refreshes visible state. - The
conflict is not shown as a generic "Something went wrong."

## Flow D --- Edit an item while another user changes it

1.  User A opens an item at version N and starts editing.
2.  User B changes the item, producing a newer version.
3.  User A submits using the expected version N.
4.  Backend rejects the stale update.
5.  UI loads the latest item and explains the conflict.
6.  User A reviews the new values and intentionally reapplies their
    edits if appropriate.

**Acceptance criteria** - No silent lost update. - The frontend does not
automatically overwrite newer server data. - Conflict handling preserves
user-entered changes where safe and practical.

## Flow E --- Advance workflow

1.  User opens an item.
2.  UI shows current status and permitted next actions.
3.  User chooses a transition.
4.  Frontend submits the transition with required
    concurrency/idempotency metadata.
5.  Backend validates the transition and authorization.
6.  UI reflects the returned server state or refreshes the item.
7.  On rejection, UI explains the failure and displays current state.

**Acceptance criteria** - Invalid transitions cannot be presented as
successful. - The backend remains the final authority. - A stale
transition does not leave the panel showing an incorrect status.

## Flow F --- Recover from a failed mutation

1.  User initiates an edit, claim, or transition.
2.  Request times out, fails validation, conflicts, or returns an
    authorization error.
3.  UI categorizes the failure using the actual API error contract.
4.  UI preserves safe input, shows a useful message, and refreshes state
    when necessary.
5.  Retry is offered only when appropriate; idempotency behavior follows
    the backend contract.

**Acceptance criteria** - Do not blindly retry an unknown-outcome
mutation without understanding idempotency support. - Network failure is
not presented as proof that the server did nothing. - The user can
recover without reloading the entire application.

------------------------------------------------------------------------

## 7. API and Frontend Integration Contract

The backend currently has these known capabilities from the
implementation plan:

-   `POST /auth/login`
-   `GET /me`
-   `GET /items`
-   `POST /items`
-   `GET /items/:id`
-   `PATCH /items/:id`
-   `POST /items/:id/claim`
-   `POST /items/:id/transition`

Confirm exact request/response schemas, status codes, pagination format,
and auth mechanism from the actual source code before implementing. This
list is a navigation guide, not a substitute for inspecting the
contracts.

### Integration requirements

-   Create one typed API client module.
-   Centralize base URL, auth handling, response parsing, and error
    normalization.
-   Define TypeScript types from actual API schemas; avoid duplicating
    handwritten types across components.
-   If Zod schemas already exist in the project, reuse or align with
    them.
-   Use TanStack Query for server state, caching, mutation lifecycle,
    invalidation, and refetching.
-   Keep transient UI state---drawer open/closed, form draft, active
    menu---local unless shared state is genuinely required.
-   Do not maintain a second copy of server data in a global store
    without a concrete reason.
-   Avoid optimistic updates for high-risk operations unless rollback
    and reconciliation are thoroughly implemented.
-   Use the backend's actual idempotency-key header/body convention and
    expected-version field; do not invent names.
-   Normalize known errors into typed UI cases, including unauthorized,
    forbidden, validation, not found, conflict/stale version, rate limit
    if applicable, and network/server failure.
-   Never expose stack traces, SQL details, internal tokens, or secrets
    in UI errors.

### Query-key design

Use a consistent key hierarchy, for example: - `['me']` -
`['items', normalizedListParams]` - `['item', itemId]` -
`['dashboard', dashboardParams]` only if dashboard queries are actually
supported.

On successful create, edit, claim, or transition: - Update the detail
cache from the authoritative response when safe. - Invalidate affected
list queries. - Invalidate dashboard counts/lists that depend on the
changed item. - Avoid invalidating unrelated queries unnecessarily.

The exact cache strategy should match the real response shapes.

------------------------------------------------------------------------

## 8. Data and Filtering Rules

-   Do not load the full dataset into the browser.
-   Use server-side pagination for the expected tens of thousands of
    work items.
-   Debounce text search to avoid a request per keystroke.
-   Normalize filter values before creating query keys.
-   Keep pagination, sort, and filters consistent when switching between
    queue and detail.
-   Treat missing values honestly: show "Unassigned" or "Not available"
    instead of fabricated data.
-   Do not infer overdue state unless a due date exists and date/time
    semantics are defined.
-   Do not infer current-user ownership solely from display names; use
    stable IDs.
-   Use server-supplied timestamps and parse/display them consistently.
-   If a total count is unavailable, do not invent one.

------------------------------------------------------------------------

## 9. Visual System and Reusable Components

Build a small, consistent component system rather than styling each page
independently.

### Core components

-   `AppShell`
-   `SidebarNavigation`
-   `TopBar`
-   `PageHeader`
-   `GlobalSearch` (only if search contract supports it)
-   `PrimaryButton` / `IconButton`
-   `StatusBadge`
-   `PriorityBadge`
-   `AssigneeDisplay`
-   `WorkItemTable`
-   `WorkItemRow`
-   `WorkItemFilters`
-   `PaginationControls`
-   `WorkItemDetailPanel`
-   `CreateWorkItemDialog`
-   `EditWorkItemForm`
-   `WorkflowActionMenu`
-   `ConfirmDialog`
-   `ConflictBanner`
-   `InlineError`
-   `LoadingSkeleton`
-   `EmptyState`
-   `Toast` or equivalent notification pattern

### Design rules

-   Use a semantic token system for color, spacing, borders, typography,
    and focus rings.
-   Keep status and priority styles consistent across dashboard, queue,
    and detail panel.
-   Use semantic colors sparingly: danger for urgent/error states,
    warning for pending attention, success for confirmed completion.
-   Pair color with text and, where useful, an icon.
-   Avoid excessive gradients, large hero banners, and decorative
    animations.
-   Respect reduced-motion preferences.
-   Ensure keyboard users can open/close panels, navigate controls,
    submit forms, and see focus.
-   Provide accessible labels for icon-only controls.
-   Confirm destructive or irreversible actions when applicable.

------------------------------------------------------------------------

## 10. Responsive Behavior

### Desktop

-   Persistent sidebar.
-   Full work table.
-   Detail drawer on the right.
-   Filters visible in a toolbar.

### Tablet

-   Collapsible sidebar.
-   Horizontal overflow only where necessary.
-   Detail panel may use more of the viewport width.

### Mobile

-   Sidebar becomes a navigation drawer.
-   Table may become compact stacked rows/cards, preserving title,
    status, priority, and owner.
-   Detail panel becomes a full-screen route or sheet.
-   Keep critical actions visible without horizontal scrolling.
-   Avoid placing essential functionality only behind hover.

Desktop is the primary target, but the core queue and detail workflows
must remain usable on smaller screens.

------------------------------------------------------------------------

## 11. Error, Loading, and Empty-State Matrix

Every data-driven screen must explicitly handle:

  -----------------------------------------------------------------------
  State                               Expected behavior
  ----------------------------------- -----------------------------------
  Initial loading                     Skeleton or compact loading
                                      indicator; avoid layout jumps.

  Empty dataset                       Explain that no work exists and
                                      offer a relevant next step.

  No filter results                   Explain that filters/search found
                                      no items and provide Clear filters.

  Unauthorized                        Re-authenticate or route to login
                                      according to actual auth behavior.

  Forbidden                           Explain that the user lacks
                                      permission; do not repeatedly
                                      retry.

  Not found                           Explain that the item may have been
                                      removed or is no longer accessible.

  Validation error                    Show the message next to the
                                      relevant field where possible.

  Conflict/stale version              Fetch current state and guide the
                                      user through review.

  Claim conflict                      Display the current owner/state
                                      after refreshing.

  Network/server failure              Keep safe user input and provide a
                                      retry path when appropriate.

  Unknown mutation outcome            Explain that the result could not
                                      be confirmed; reconcile with server
                                      before retrying.
  -----------------------------------------------------------------------

Use concise, human-readable copy. Do not surface raw backend exception
strings unless they are intentionally safe and user-facing.

------------------------------------------------------------------------

## 12. Security and Authorization UX

-   Backend authorization is the security boundary.
-   Use the current user's real identity and membership data.
-   Hide or disable actions the user cannot perform when permissions are
    known.
-   Still handle server `403` responses because permissions can change
    or UI state can be stale.
-   Do not assume that every team member can claim, edit, transition, or
    close every item.
-   Do not expose items outside the server-authorized result set.
-   Avoid leaking inaccessible item details in error messages, dashboard
    counts, or search results.
-   Do not treat a role label in the UI as proof of authorization.

If the backend does not expose a capability/permission model to the
frontend, use conservative UI behavior and let the server reject
unauthorized actions. Document the limitation instead of guessing
permissions.

------------------------------------------------------------------------

## 13. Testing and Acceptance Criteria

### UI/component tests

-   Status and priority render the exact values returned by the API.
-   Search and filters create the expected query parameters.
-   Pagination resets appropriately when filters change.
-   Form validation and server field errors render correctly.
-   Nested row controls do not accidentally open the detail panel.
-   Loading, empty, and error states are distinguishable.
-   Dialogs and panels are keyboard accessible.

### Integration tests

-   Login success/failure.
-   Create item success/validation failure.
-   Detail loading and not-found handling.
-   Edit success and stale-version conflict.
-   Claim success and claim conflict.
-   Valid and rejected workflow transitions.
-   Query invalidation after successful mutations.
-   Authorization failures.
-   Unknown network outcome does not cause unsafe blind retries.

### Manual demonstration scenarios

The assessment demo should deliberately show at least these correctness
cases: 1. Two users attempt to claim the same item; only one owns it. 2.
A stale edit is rejected and reconciled. 3. An invalid workflow
transition is rejected. 4. Repeated submission does not accidentally
duplicate an operation. 5. The UI recovers from a failed request without
showing false success.

Use automated tests for the most dangerous behaviors. Do not rely
exclusively on screenshots or a happy-path demo.

------------------------------------------------------------------------

## 14. Implementation Plan for the Coding Agent

Work in small phases. Inspect the existing repository before changing
anything.

### Phase 0 --- Inspect and map existing code

-   Identify framework, routing, styling system, current task-list
    implementation, API client, auth mechanism, query library, and test
    setup.
-   Read backend request/response schemas and error contracts.
-   Confirm actual status/priority enums, item fields, pagination/filter
    support, and expected-version/idempotency conventions.
-   Identify which UI features can be implemented without backend
    changes.
-   Do not rewrite working backend logic.

**Deliverable:** Short contract map and list of frontend files to
reuse/modify.

### Phase 1 --- App shell and authentication

-   Build the application shell and navigation.
-   Connect login and current-user loading to the existing backend.
-   Implement loading, unauthorized, and login error states.
-   Confirm navigation works on desktop and small screens.

**Exit criteria:** A user can sign in and navigate the application using
real identity data.

### Phase 2 --- Work queue

-   Upgrade the existing task list into a polished, accessible table.
-   Implement supported search, filters, sorting, and server pagination.
-   Add empty/loading/error states.
-   Preserve query state in the URL where practical.

**Exit criteria:** Users can find and open items without loading the
entire dataset.

### Phase 3 --- Detail panel and editing

-   Implement item details.
-   Add edit mode for supported fields.
-   Use expected-version concurrency control.
-   Handle stale edits without silent overwrites.
-   Keep queue context when the panel opens/closes.

**Exit criteria:** Users can inspect/edit items and understand conflict
outcomes.

### Phase 4 --- Claim and workflow actions

-   Add claim flow and conflict handling.
-   Add explicit, valid workflow transitions.
-   Implement idempotency and pending-state behavior using the real
    backend contract.
-   Reconcile caches after server decisions.

**Exit criteria:** The main correctness-sensitive flows are visible,
testable, and do not falsely report success.

### Phase 5 --- Operations dashboard

-   Build attention cards and actionable sections from real API data.
-   Link each section to the corresponding queue filters.
-   Omit unsupported metrics rather than mocking them.

**Exit criteria:** Dashboard sections are accurate and lead directly to
relevant work.

### Phase 6 --- Quality pass

-   Verify authorization and all error states.
-   Add/extend tests for concurrency and mutation handling.
-   Check accessibility, responsive behavior, and keyboard navigation.
-   Run lint, typecheck, tests, and production build.
-   Document known backend/API gaps.

**Exit criteria:** No critical flow depends on fake data or silently
ignores server rejection.

------------------------------------------------------------------------

## 15. Definition of Done

The frontend is ready for review when:

-   [ ] The existing backend remains unchanged unless a documented
    contract gap requires a minimal change.
-   [ ] The user can authenticate and load current-user context.
-   [ ] The work queue is searchable/filterable using only supported API
    capabilities.
-   [ ] Large lists use server-side pagination and do not load the
    entire dataset.
-   [ ] The user can create and inspect work items.
-   [ ] Supported fields can be edited with stale-version handling.
-   [ ] Claim conflicts are explained and reconciled.
-   [ ] Workflow transitions are explicit and server-authoritative.
-   [ ] Idempotency and repeat-submission behavior match the backend
    contract.
-   [ ] Successful mutations update or invalidate affected queries.
-   [ ] Unauthorized, validation, not-found, conflict, and network
    states are handled.
-   [ ] No fake comments, activity history, notifications, counts, or
    permissions are presented as real.
-   [ ] The UI is keyboard accessible and usable at desktop and mobile
    widths.
-   [ ] Tests cover the most dangerous user-visible behaviors.
-   [ ] Lint, typecheck, tests, and production build pass.
-   [ ] Known limitations and API gaps are documented.

------------------------------------------------------------------------

## 16. Final Guidance to the Coding Agent

Build a **focused operational workspace**, not a feature-for-feature
ClickUp clone.

Prioritize in this order: 1. Correctness and trustworthy feedback. 2.
Fast work discovery. 3. Clear ownership and workflow actions. 4. A
compact, polished visual system. 5. Dashboard convenience. 6. Optional
refinements only after the critical paths work.

Before implementation, inspect the existing code and adapt this plan to
the actual contracts. If a UI requirement cannot be supported by the
backend, do not invent behavior or add an unrelated backend subsystem.
Document the gap and choose the smallest justified change.

The final result should make Newtonite feel like a deliberate internal
operations product: familiar enough to use immediately, compact enough
to navigate quickly, and explicit enough that users can trust what
happened when several people act on the same work.
