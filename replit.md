# BSNL Sales & Task App

## Overview
BSNL Sales & Task App is a mobile-first application for managing task assignments and tracking performance for BSNL (Bharat Sanchar Nigam Limited). Built with Expo (React Native) and a Hono/tRPC backend, the app supports web deployment. The app uses "Task" terminology throughout (not "Event").

## Tech Stack
- **Frontend**: React Native with Expo SDK 54, React Native Web
- **Backend**: Hono server with tRPC for type-safe API calls
- **Database**: PostgreSQL (external at 117.251.72.195:5433). Connection string read from `BSNL_DATABASE_URL` (Replit reserves `DATABASE_URL`).

## Environment Variables
- `BSNL_DATABASE_URL` — Postgres connection string for the external BSNL DB.
- `GEO_FENCE_KM` — Soft-warn radius (km) for sales submission geo-fence vs. event anchor (avg of prior entries' GPS). Default `50`.
- `GEO_FENCE_ENFORCE` — `soft` (default, log + allow) or `hard` (reject when > `GEO_FENCE_KM`). Submissions > `3 × GEO_FENCE_KM` are always rejected as suspicious.

## S&M Submission Flow (architect-aligned)
- `submitEventSales` is an **authedProcedure** — actor is the `x-employee-id` header (sent by `lib/trpc.ts`); client-supplied employee IDs are ignored.
- Requires ≥1 photo and a captured GPS location; backend mirrors the gating done in `app/event-sales.tsx`.
- Per-subtype line items (SIM / FTTH / LC / EB) are validated for format, parity vs. activated/sold counts, in-submission uniqueness, and cross-event uniqueness against active prior entries.
- `app/submit-sales.tsx` is a redirect-only screen; `app/event-sales.tsx` is the single canonical submit screen.
- `app/(tabs)/my-tasks.tsx` shows **per-employee** LC/EB/maintenance progress sourced from `getMyAssignedTasks.myProgress` / `maintenanceProgress`.
- Owners (and event creators / managers) can soft-delete entries with an audit reason; owners can append SIM/FTTH activations via `activateSimsForEntry` / `activateFtthForEntry` mutations.

## Finance Collection Flow (production-grade, May 2026)

The 5 Finance subtasks (LC, LL/FTTH, Tower, GSM PostPaid, Rent of Building) follow a strict submit→approve/reject lifecycle:

- **Submit** (`submitFinanceCollection`): inserts entry with `approval_status='pending'`. Does NOT touch `events.fin_*_collected` — those reflect *verified* money only. Pending sub-totals are computed live from the entries table.
- **Approve** (`approveFinanceCollection`): runs in a single DB transaction with two safeguards: (1) conditional `WHERE approval_status='pending'` so concurrent approvals can't double-claim, (2) SQL atomic `SET col = col + amount` so concurrent approvals on different entries can't lose increments.
- **Reject** (`rejectFinanceCollection`): same conditional/atomic transaction pattern. No-op on event totals (since submit didn't add).
- **Summary** (`sales.getFinanceSummary`): returns `totalCollected` (approved only), `totalPending`, `totalPendingEntries`, and per-type `byType[].pendingAmount`. Rejected entries excluded from totals.
- **Pending review queue** (`getPendingFinanceCollections`): filters events by `taskCategory = 'Finance'` (literal value, not `LIKE 'FIN_%'`). CMD/ADMIN see all circles, GM/CGM see their circle, DGM/AGM see only their own Finance events (the `taskCategory='Finance'` filter is applied to **every** branch — top-mgmt and DGM/AGM alike — so non-Finance events never leak into the review queue).
- **Notification resilience**: every `notifications.insert` for finance submit/approve/reject is wrapped in `try/catch` and runs **outside** the core transaction. Notification failures are logged but never undo a committed approval/rejection or fail the API call to the user.
- **Input hardening**: `amountCollected` is `z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)` to reject floats, zero/negative amounts, and values that would lose precision before BIGINT write.
- **Auth roles allowed to review**: CMD, ADMIN, GM, CGM, DGM, AGM (frontend `MANAGEMENT_ROLES` and backend gates kept in sync).
- **Amount precision**: `amount_collected`, `target_fin_*`, `fin_*_collected` are PostgreSQL `BIGINT` (drizzle `bigint(mode:'number')`). Safe up to `Number.MAX_SAFE_INTEGER` (~9×10¹⁵ INR), needed because BSNL outstanding totals already exceed 35,720 Cr.
- **Migration**: `backend/db/migrate.ts` widens each finance column individually inside its own `try/catch`, so a missing column on a fresh DB doesn't abort the rest of the bigint migration; the loop reports `widened` vs `skipped` counts on startup.

## O&M Submission Flow (P1, architect-aligned)
- `submitMaintenanceEntry` is the **only** server-side write path for positive O&M increments — `authedProcedure` with the same transaction pattern as `updateMemberTaskProgress` (lock event row + `.for('update')` on the target's assignment row).
- Server requires `siteId` (≥1 char), ≥1 photo, valid `gpsLatitude`/`gpsLongitude`; geo-fence anchor = avg GPS of prior `maintenance_entries` for the event, soft (`GEO_FENCE_KM`) and hard (`× 3`) limits, `GEO_FENCE_ENFORCE` honoured.
- Authorisation: actor must be self, the event creator, or the assigned manager. `targetEmployeeId` defaults to the actor; managers/creators can record on behalf of a team member.
- Inside the same tx: increments per-member completed counter (`btsDownCompleted` etc.), inserts the `maintenance_entries` row with `photos`, `gpsLatitude/Longitude`, `siteId`, `remarks`, `createdBy`, recomputes the event-level total from assignments, sets the per-type `*StartedAt` timestamp on first non-zero, and writes an audit log row — all rolled back together on any failure.
- **Server-side lockdown**: both `updateTaskProgress` and `updateMemberTaskProgress` now reject positive O&M increments at the top of their handlers, redirecting clients to `submitMaintenanceEntry`. Negative O&M increments still work via these mutations as a manager rollback path.
- New screen `app/submit-maintenance.tsx` is the only UI path to a positive O&M increment. `my-tasks` `+` button (`handleMaintenanceComplete`) and `event-detail` `Mark +1` for O&M types both `router.push('/submit-maintenance?eventId=…&taskType=…&memberId=…')`.
- The `-1` undo path on `event-detail` and the `Undo` modal in `my-tasks` still call `updateMemberTaskProgress(increment: -1)` (with a confirm dialog). **Known gap (P2)**: undo decrements the counter but does NOT delete the matching `maintenance_entries` row — counter and entries can drift on undo. Replace with a "delete most recent entry" flow.
- Schema additions in `maintenance_entries` (Drizzle + idempotent SQL migration via `scripts/add-site-id-column.ts`): `site_id text`, `created_by uuid REFERENCES employees(id)`.

## Photo upload base URL — fail-closed transport policy
- `lib/photoUpload.ts` resolves the upload host as: `EXPO_PUBLIC_API_BASE_URL` env var → web `window.location.origin` → **throws** (no insecure fallback).
- HTTPS is enforced at runtime — any non-HTTPS resolved URL throws, except for `localhost`/`127.0.0.1` when `__DEV__` is true (so local Expo Go / simulators keep working).
- **Set `EXPO_PUBLIC_API_BASE_URL` to an HTTPS URL** before shipping native builds; without it, native uploads fail with a clear configuration error rather than silently downgrading transport.
- **ORM**: Drizzle ORM
- **State Management**: Zustand, React Query
- **Styling**: React Native StyleSheet

## Project Structure
```
/
├── app/                 # Expo Router pages (screens)
│   ├── (tabs)/          # Tab navigation screens
│   ├── _layout.tsx      # Root layout with providers
│   ├── login.tsx        # Login screen
│   └── ...              # Other screens
├── backend/
│   ├── db/              # Database configuration and migrations
│   │   ├── index.ts     # Drizzle database client
│   │   ├── schema.ts    # Database schema definitions
│   │   └── migrate.ts   # Migration script
│   ├── trpc/            # tRPC API routes
│   │   ├── app-router.ts
│   │   ├── create-context.ts
│   │   └── routes/      # API route handlers
│   └── hono.ts          # Hono server setup
├── contexts/            # React context providers
├── constants/           # App constants (colors, etc.)
├── lib/                 # Utilities (tRPC client, etc.)
├── types/               # TypeScript type definitions
├── dist/                # Built web assets (generated)
└── server.ts            # Main server entry point
```

## Database Schema
The app uses the following main tables:
- **employees**: Staff members with roles (GM, CGM, DGM, AGM, SD_JTO, SALES_STAFF)
- **employee_master**: Official employee records imported from CSV with hierarchy (purse_id, name, circle, zone, reporting_purse_id)
- **events**: Sales events with targets and assignments
- **sales_reports**: Sales submissions with approval taskflow
- **resources**: SIM and FTTH resource inventory
- **issues**: Event-related issues and escalations
- **event_assignments**: Employee-to-event assignments with targets
- **event_sales_entries**: Individual sales records (with `entry_status`, `version`, `superseded_by`, `deleted_at` for edit/delete/version tracking)
- **sim_sale_lines / ftth_sale_lines / lc_sale_lines / eb_sale_lines**: Per-subtype line items keyed to a parent entry; enforce per-event uniqueness on mobile / FTTH ID / circuit ID / connection ID
- **audit_logs**: Activity tracking (includes sales-entry delete/edit reasons + actor)
- **notifications**: Real-time notifications for users (event assignments, issues, subtasks)
- **push_tokens**: Expo push notification tokens for mobile devices

## Real-Time Notification System
The app implements a production-grade notification system:

### Notification Types
- **EVENT_ASSIGNED**: When a user is assigned to an event/work
- **EVENT_STATUS_CHANGED**: When event status changes
- **ISSUE_RAISED**: When a new issue is reported on an event
- **ISSUE_RESOLVED**: When an issue is marked as resolved
- **ISSUE_STATUS_CHANGED**: When issue status changes
- **ISSUE_ESCALATED**: When an issue is escalated
- **SUBTASK_ASSIGNED**: When a subtask is assigned to a user
- **SUBTASK_COMPLETED**: When a subtask is marked complete
- **SUBTASK_DUE_SOON**: When a subtask is approaching its due date
- **SUBTASK_OVERDUE**: When a subtask has passed its due date

### Security
- All notification endpoints use protected procedures with server-side authentication
- Employee ID is derived from the `x-employee-id` header (set automatically by the client)
- Users can only access/modify their own notifications and push tokens

### Components
- **NotificationBell**: Header component showing unread count with polling (30s interval)
- **Notifications Screen**: Full list of notifications with filtering and mark as read
- **Push Notifications**: Expo push notifications for mobile devices (development build required)
- **Notification Service**: Backend service that creates notifications when events occur

## Employee Hierarchy System
- Admins can import official employee master data via CSV upload at /admin
- CSV format matches BSNL HR export: circle, ba_name, Employee pers no, emp_name, emp_group, employee designation, controller_officer Pers no, controller_officer_name, controller_designation, shift_group of employee, division of employee, building Name, office Name, distance_limit for attendance, sort_order
- Large files (60K+ records) are processed in batches of 500 with progress indicator
- Users link their accounts to official records via "Link My Pers No" in /profile
- After linking, users see their reporting manager and subordinates in the hierarchy view
- Backfill mechanism: When managers link after subordinates, the system automatically updates reporting relationships

## Organization Hierarchy Feature

### Two-Part UI Design
1. **Profile Screen Preview Card** - Compact "My Organization" card showing:
   - Stats: Levels up (managers) and Direct reports count
   - Mini tree: Immediate manager → You → Top 2 subordinates
   - Tap to open full hierarchy page

2. **Dedicated Hierarchy Page** (/hierarchy) - Full interactive org chart with:
   - Level indicators (L-2, L-1, YOU, L+1, L+2)
   - 2 levels up (managers) and 2 levels down (subordinates)
   - Professional card design with colored avatars
   - Tree connectors between nodes
   - Expandable subordinate tree view
   - Search by name or Pers No
   - Quick actions: Call/email registered colleagues

### UI Components
- **Colored Avatars**: Initials-based avatars with consistent color per employee name
- **Level Pills**: Color-coded level indicators (orange=managers, blue=you, green=team)
- **Manager Section**: Yellow-highlighted manager cards showing reporting chain
- **Subordinates Tree**: Expandable tree with visual connecting lines
- **Status Indicators**: Green dot for registered, badges for unregistered
- **Contact Actions**: Phone/email buttons for quick communication

### Production-Grade Backend Optimizations
- **Batch Fetching**: Uses inArray to fetch linked employees in single query (avoids N+1)
- **Cycle Detection**: visited Set prevents infinite loops in corrupted hierarchy data
- **Depth Limits**: maxDepth=3 for subordinates, depth>10 for search to prevent excessive queries
- **Batch Counting**: GROUP BY query for direct reports count instead of individual queries
- **Error Handling**: Try-catch with user-friendly error messages
- **Caching**: 30-second staleTime for hierarchy data

### Frontend Optimizations
- **Search Debouncing**: 300ms delay before API call to reduce server load
- **Loading States**: Visual indicators while searching/loading
- **Error Recovery**: Retry button for failed hierarchy loads
- **Pull-to-Refresh**: Refresh hierarchy data with pull gesture
- **Accessibility**: Labels and hints on interactive elements

## Task Categories
The app supports 8 task categories that can be selected individually or in combination:
1. **SIM** - SIM card sales (shows SIM target field)
2. **FTTH** - Fiber to the Home installations (shows FTTH target field)
3. **Lease Circuit** - Leased line connections (shows Lease Circuit target field)
4. **EB** - Exchange based task
5. **BTS-Down** - Base station maintenance (maintenance type)
6. **FTTH-Down** - FTTH maintenance (maintenance type)
7. **Route-Fail** - Route failure resolution (maintenance type)
8. **OFC-Fail** - Optical fiber cable failure (maintenance type)

Categories are stored as comma-separated values when multiple are selected.

## Task Manager Assignment
- Mobile number lookup: Enter 10-digit mobile to auto-populate Purse ID
- Purse ID lookup: Directly enter Purse ID to find registered employee
- Two-step confirmation: Found employee card with Cancel/Confirm buttons
- Confirmed employee shows verified badge with "Change" option
- Professional card UI with avatar initials, designation, and circle

## Time-Based Task Status Management
- **Automatic completion**: Tasks with status 'active' automatically change to 'completed' when end date passes
- Applied consistently across all API endpoints (getAll, getByCircle, getActiveEvents, getUpcomingEvents)
- Status updates happen on data fetch, ensuring real-time accuracy

## Dashboard Task Progress Display
- **Date indicators**: Each task card shows start/end date range
- **Visual status badges** with color coding:
  - Green: "X days left" (active)
  - Yellow: "Ends tomorrow" or "Ends in 2 days" (ending soon)
  - Red: "Ends today" (urgent)
  - Gray: "Ended X days ago" (completed)
  - Blue: "Starts in X days" (upcoming)
- **Limited display**: Shows top 3 active tasks by default
- **"See More" button**: Expands to show all tasks when more than 3 available
- **Task counts**: Shows total count next to section headers

## Tasks CSV Upload (Admin Feature)
- Admins can bulk upload tasks via CSV at /admin page
- Required CSV columns: Task Name, Location, Category
- Optional CSV columns: Circle (auto-detected from location), Date Range, Zone, Key Insight
- Date Range format: "2025-10-15 to 2025-10-20" or single date "2025-10-15"
- Duplicate handling: Tasks with same name + location + circle are updated instead of duplicated
- Uploaded tasks are created in "draft" status, ready for managers to activate and assign teams

### Production-Grade Features
- **Proper CSV parsing**: Handles quoted fields with commas (e.g., "Mumbai, Central")
- **Circle is optional**: System auto-detects circle from location using employee_master zone data + fallback city mapping
- **Smart circle matching**: Accepts state names, abbreviations (MH, AP, KA), or major cities (Mumbai→Maharashtra)
- **Flexible category matching**: Accepts variations like "Mela"→Fair, "Fest"→Festival, "Expo"→Exhibition
- **Row-level error tracking**: Errors include row numbers for easy debugging
- **Date validation**: Validates end date >= start date
- **Parse error reporting**: Shows skipped rows with reasons before import
- **Batch processing**: Large files processed in batches of 100 with progress indicator
- **Unknown circle handling**: Events with undetectable circles are skipped with helpful error message

## Simplified Registration (using Employee Master)
- New users enter their Employee Pers No (Purse ID) to start registration
- System verifies the ID exists in employee_master and is not already linked
- Employee details (name, designation, circle, zone, office, reporting officer) are auto-filled
- User only needs to provide: Email, Mobile, Password
- On registration, account is automatically linked to the official employee record

## Event Team Management

### Hierarchy
1. **Event Creator**: Creates events and assigns an Event Manager
2. **Event Manager** (assignedTo): Manages the event, creates field team, assigns tasks to field officers
3. **Field Officers** (team members): Do the actual field task, sales, and report progress

### Features
- Events have a team of assigned employees stored in both `events.assignedTeam` (JSONB array) and `eventAssignments` table (with targets)
- Event Manager is displayed separately in the UI with "Manages team & assigns tasks" label
- Event Manager can manage team and tasks even if their role doesn't have admin privileges
- Field Officers are displayed separately from the Event Manager
- Cross-circle visibility: Field officers see events they're assigned to, regardless of circle
- Team members have individual SIM and FTTH targets tracked in eventAssignments
- Team member cards display: Name, Designation, Purse ID, and progress towards targets
- All employee lookups use Purse ID from employee_master for consistency

## Resource Management Flow
The complete resource management flow tracks SIM and FTTH from circle inventory through events to sales:

### 1. Circle Inventory (Admin Level)
- Resources table stores total SIM/FTTH inventory per circle
- Fields: total, allocated (to events), used (sold), remaining (available for allocation)
- Admin can update stock via /admin or resources management

### 2. Event Allocation (Event Creator)
- When creating an event, allocate SIM/FTTH from circle's available resources
- System validates: allocatedSim ≤ circle's remaining SIM resources
- On event creation, circle's allocated increases, remaining decreases
- Only event creator can modify event's allocated resources

### 3. Team Distribution (Event Manager)
- Event manager distributes event targets to team members. One task can be
  given to many members; auto-distribution covers all 8 task types
  (SIM, FTTH, LEASE_CIRCUIT, EB, BTS_DOWN, FTTH_DOWN, ROUTE_FAIL, OFC_FAIL).
- **Fair-split algorithm** (`distributeFairly` in `backend/trpc/routes/events.ts`):
  for each task type, share = `floor(total / N)` with the first `total % N`
  members receiving `+1`. Sum across the team always equals the event total
  (no over-allocation from `Math.ceil` rounding, no under-allocation from
  `Math.floor` truncation), regardless of odd/even totals or odd/even team
  size. Order is deterministic (sort by employeeId).
- Each team-member row in `event_assignments` carries a target column per
  task type plus an `assignedTaskTypes` array.
- `events.assignTeamMember` validates each requested per-member target
  against the corresponding `event.target*` (not the inventory `allocated*`),
  so maintenance task types — which have no inventory — can also be
  distributed.
- `events.redistributeTargets` (creator/manager only) re-runs the fair split
  over the current team. It clamps each member's new share UP to whatever
  they have already sold/completed, then trims the resulting excess back
  down from members with slack so the team total still equals the event
  total. If sold/completed across the team genuinely exceeds the event
  target, the leftover is returned in an `overflow` map and audit-logged.
  Wrapped in a transaction with `SELECT … FOR UPDATE` on the event row so
  concurrent assigns can't race.

### 4. Sales Entry (Team Members)
- Team members record sales via submit sales entry
- Updates eventAssignments.simSold and ftthSold
- Updates circle resources.used count in real-time
- Tracks both sold and activated quantities
- Validation: Cannot sell more than assigned target
- Validation: Cannot submit sales for completed/cancelled events
- Validation: Must be assigned to event to submit sales

### Production-Grade Validations
- **Event allocation updates**: Cannot reduce allocation below already distributed amounts; validates against circle availability
- **Team target updates**: Cannot exceed event's allocated resources; cannot reduce target below already sold amounts
- **Team member removal**: Cannot remove member who has recorded sales
- **Sales submission**: Cannot exceed target; requires event assignment; blocked for completed/cancelled events
- **Resource balancing**: Circle inventory automatically updated when event allocation changes

### 5. Reporting (Hierarchical)
- Event-level: allocated → distributed → sold → remaining
- Circle-level dashboard: inventory status + all events summary
- Manager dashboard: all events created/managed with resource metrics
- API endpoints: getEventResourceStatus, getCircleResourceDashboard, getHierarchicalReport

## Running the App
The app runs on port 5000 with a combined frontend/backend server:
- Frontend: Static web build from Expo export (dist/ folder)
- Backend: tRPC API at /api/trpc/*
- Health check: GET /health
- The BSNL App workflow automatically rebuilds the web app (`bunx expo export --platform web`) before starting the server to ensure the latest code is always served

## Environment Variables
- `DATABASE_URL`: PostgreSQL connection string (stored as secret)

## Development Commands
- `bun install`: Install dependencies
- `bun run backend/db/migrate.ts`: Run database migrations
- `bunx expo export --platform web`: Build web version
- `bun run server.ts`: Start production server

## Reports (View Reports)
- Entry point: `app/(tabs)/dashboard.tsx` "View Reports" button → `app/sales.tsx`.
- Top-level **Category selector** (S&M / O&M / Finance) above three sub-tabs (Overview / Team / Trends). Each category × tab pair queries its own tRPC procedure.
- All charts are SVG-based primitives in `components/SalesCharts.tsx` (DonutChart, MultiLineChart, GroupedBarChart, StackedBarChart, ChartLegend, formatIndianNumber). Built on existing `react-native-svg` 15.12.1 — no new dependency.

### S&M (Sales & Marketing) — `trpc.sales.getSalesAnalytics / getTeamPerformance / getSalesTrends`
- Covers all four S&M sub-tasks: SIM, FTTH, **Lease Circuit (LC)**, and **EB**. Backend aggregations in `backend/trpc/routes/sales.ts` include `leaseSold` + `ebSold` in `totals`, `byEmployee`, `byEvent`, `daily`, `summary`, and ranking `orderBy`.
- Overview: 4-card summary (SIM / FTTH / LC / EB), Activation-Rate donuts for SIM and FTTH (renders "—" when zero sold), Top Performers grouped bar across all 4 series.
- Team: Contribution-by-Member top-10 grouped bar (4 series) + per-member breakdown rows.
- Trends: 4-card summary, multi-line trend (SIM/FTTH/LC/EB), stacked bar for activations. Continuous date series across the full 7/30/90 window (fixes earlier `slice(-14)` bug); date keys built from local parts (NOT `toISOString()`) to avoid IST timezone shift; missing days render as 0.

### O&M (Operations & Maintenance) — `trpc.sales.getOperationsAnalytics`
- Aggregates `maintenance_entries` by `taskType` (BTS_DOWN / FTTH_DOWN / ROUTE_FAIL / OFC_FAIL) using `SUM(increment)`.
- Overview: 4-card summary by task type, Top Performers grouped bar (per-type series), Top performer ranking list.
- Team: Top-10 contribution grouped bar + full ranking list with per-type counts.
- Trends: Multi-line and stacked-bar daily trend per task type with continuous date series.

### Finance — `trpc.sales.getFinanceAnalytics`
- Aggregates `finance_collection_entries` per `financeType` (FIN_LC / FIN_LL_FTTH / FIN_TOWER / FIN_GSM_POSTPAID / FIN_RENT_BUILDING). Daily series and per-collector totals filter to **approved-only** collections; status totals (approved/pending/rejected) span all entries in the window.
- Overview: 3-card approval-status summary (₹ Approved / Pending / Rejected with entry counts), per-type approved horizontal bar (Indian-rupee formatted), Top Collectors list.
- Team: Top-10 contribution grouped bar across 5 finance types + full ranking list with collector totals.
- Trends: Multi-line and stacked-bar daily approved-collection trend per type.

### Time Period Selector (Management Deep-Dive)
A unified `TimePeriodPicker` (`components/TimePeriodPicker.tsx`) drives every analytics tab. State lives as a single `PeriodRange = { key, label, startDate, endDate }` in `app/sales.tsx` and is passed to all five backend procedures.

Presets, grouped:
- **Quick**: Today, Yesterday, Last 7 / 30 / 90 Days
- **Calendar**: Month-to-Date, Last Month, Quarter-to-Date, Last Quarter, Calendar YTD, Last Calendar Year
- **Financial Year (India)**: Financial YTD (Apr 1 → today), Last Financial Year (Apr → Mar)
- **Custom**: free YYYY-MM-DD range up to 730 days (validated)

All preset ranges are computed in `utils/timePeriod.ts` using India-local calendar math (Indian FY = Apr–Mar). Backend procedures accept `startDate` + `endDate` (YYYY-MM-DD) and interpret them as IST day boundaries via `istDayStart` / `istDayEnd`, then bucket daily results in `Asia/Kolkata` so backend keys align with frontend `eachDayInRange()` keys. The legacy `days` input is retained as a fallback for any older callers.

### Cross-Cutting
- All new procedures reuse `getVisibleEmployeeIdsSubquery(persNo)` for hierarchical scope (admin sees all, others see self + subordinates). Optional `circle` filter applies on top.
- Numbers formatted in Indian style (Cr / L / K) via `formatIndianNumber`; rupee values prefixed with ₹.
- Production-grade safety: chart primitives sanitize NaN/Infinity inputs (`safeNum`/`safeArr`), clamp percentages, guard divisors, and expose `accessibilityLabel` summaries for screen readers. Each tab's tRPC query is `enabled` only when its category is active to avoid unnecessary fetches.
- **IST-correct daily bucketing**: Daily group-by uses `(${col} AT TIME ZONE 'Asia/Kolkata')::date` and emits `TO_CHAR(..., 'YYYY-MM-DD')` so backend day-keys align with the frontend's local-date keys (`toLocalKey`). This prevents late-night IST entries from being mis-bucketed into the prior day when the DB session timezone is UTC. Applied to `getSalesTrends`, `getOperationsAnalytics`, and `getFinanceAnalytics`.
- **Parallel queries**: `getOperationsAnalytics` and `getFinanceAnalytics` batch their three independent aggregations (totals/byEmployee/daily and collectors/daily/status, respectively) via `Promise.all` for ~3x lower perceived latency.

## Privileged Users (Admin Panel)
- `admin.listPrivilegedUsers` (publicProcedure, role-gated): caller must be ADMIN or CMD; otherwise throws Forbidden.
  - Input: `{ userId: uuid, includeManagementPanel?: boolean }`
  - Default returns `ADMIN + CMD`. With `includeManagementPanel: true` returns `CMD, ADMIN, GM, CGM, DGM, AGM`.
  - Output: `{ total, byRole, users: [{ id, name, email, phone, role, circle, zone, persNo, designation, isActive, createdAt }] }`, sorted by role then name.
- UI: app/admin.tsx renders a "Privileged Users" section visible only when `isAdminRole(role)` is true. Has Show/Hide toggle, two filter chips (Admins-only / All management roles), summary line with per-role counts, role badges, contact rows, and Refresh.
- Backend reports/analytics "see-all" bypass: `isAdmin = role === 'ADMIN' || role === 'CMD'` in all 8 sales.ts endpoints (getDashboardStats, getSalesAnalytics, getTeamPerformance, getSalesTrends, getOperationsAnalytics, getFinanceAnalytics, plus the two underlying scope-resolution helpers). CMD now bypasses circle/persNo scope filters and sees all-India data, matching the role's top-of-hierarchy position.

## CMD Executive Tasks Console (`/cmd-tasks`)
3-tier executive view of national task health for CMD/ADMIN. Linked from dashboard "Executive View" action button (visible only when `isAdminRole(role)`).
- **Backend** (events.ts, all role-gated to CMD/ADMIN, throw Forbidden otherwise):
  - `events.getNationalTaskKPIs({ userId, startDate, endDate })` → `{ active, overdue, atRisk, completedInPeriod, escalated }`. Active = status IN ('active','paused'); overdue adds `end_date < NOW()`; atRisk adds `end_date BETWEEN NOW() AND NOW()+48h`; completedInPeriod = `status='completed' AND updated_at` in IST [start,end]; escalated = open issues with `escalated_to IS NOT NULL`. Five `db.execute` queries via `Promise.all`.
  - `events.getCircleHealthGrid({ userId, startDate, endDate })` → `{ grid: [{ circle, active, overdue, atRisk, completedInPeriod, escalatedOpen, overduePct, health }], totalCircles }`. Two aggregations (events-by-circle FILTER counts; issues-by-circle escalation counts). Merged with the canonical 26-entry `circleEnum` so green circles still appear with zeros; any rogue circle strings are appended sorted. Health rule: red if `overduePct ≥ 15` OR `escalatedOpen > 0`; amber if `overduePct ≥ 5` OR `atRisk > 0`; else green. Sorted red→amber→green, then by overdue desc, then alphabetically.
  - `events.getCmdAttentionList({ userId, limit≤100 })` → `{ overdue, escalated, totalOverdue, totalEscalated }`. Overdue = active events past `end_date`, joined with `assignedTo` employee for name/role/designation. Escalated = OPEN/IN_PROGRESS issues with `escalated_to ∈ {CMD,ADMIN,GM,CGM}`, joined with raiser + escalatee + event. Each row carries `daysOverdue`/`daysOpen` computed via `EXTRACT(DAY FROM (NOW() - <ts>))`.
- **Frontend** (`app/cmd-tasks.tsx`):
  - Tier 1: 5-tile KPI strip (Active/Overdue/At Risk/Completed/Escalated) with the overdue tile visually highlighted (border + shadow).
  - Tier 2: Circle health grid (cards 220px on web / 2-up on mobile) — color = health, shows active/overdue/atRisk, % late, and an escalation flag badge. Tap → `/(tabs)/events?circle=<NAME>`.
  - Tier 3: "Needs Your Attention" — escalations group first (purple rule), then overdue group (red rule). Empty state shows green checkmark when both lists are empty. Each row taps to `/event-detail?id=<eventId>`.
  - Header period chip uses the existing `TimePeriodPicker` component (`{value, onChange}` API). Default period = MTD. Pull-to-refresh refetches all three queries in parallel.
  - Hard-blocks non-admin/non-CMD users with a Restricted screen (queries `enabled` flag is also gated, so no unauthorized requests fire).

## Task Lifecycle Hardening (Tier A — "Stop the bleeding")
Production-grade safety on the create→assign→execute→approve→complete loop. All implemented in `backend/trpc/routes/events.ts` + the boot-time scheduler in `backend/services/notification-scheduler.service.ts`.

- **A1 — Date validation**:
  - `events.create` uses `superRefine` to reject invalid Date parses, `startDate > endDate`, and end dates already in the past (24h IST grace for time-zone slop).
  - `events.update` uses `superRefine` for the in-payload check AND additionally cross-validates against the persisted DB row inside the mutation, so a partial update (only `startDate` or only `endDate`) cannot persist an inverted range.

- **A2/A3 — Auto-completion sweep**:
  - Core logic extracted into `_completeExpiredEventsCore(eventsList)`. Throttled wrapper `autoCompleteExpiredEvents(list)` is kept for lazy callers (`getAll`, `getByCircle`, etc.).
  - New exported `runAutoCompleteSweepNow()` queries every active event itself; called by `startNotificationScheduler` on boot AND every 15 min interval.
  - Race-safe flip: `UPDATE events SET status='completed' WHERE id IN (...) AND status='active'` with `.returning({id})`; the toComplete list is post-filtered so audits/notifications only fire for events we truly transitioned (concurrent pause/cancel won't be clobbered).
  - Per-completion side-effects: notifications (type `EVENT_STATUS_CHANGED`, transition in `metadata`) fan-out to creator + assigned manager + every team member (resolved via `eventAssignments.employeeId`); single audit row `AUTO_COMPLETE_EVENT` per event. Notification + audit failures are best-effort (logged, never block the status flip).
  - Tasks expired but with unmet targets are deliberately left as `active` so they keep showing up on the CMD heatmap / overdue lists.

- **A4 — Geo-fence on finance collections**:
  - `submitFinanceCollection` mirrors the Sales pattern. Anchor = avg GPS of prior non-rejected `financeCollectionEntries` for the same event.
  - Hard limit `GEO_FENCE_KM * GEO_FENCE_HARD_MULT` (default 50 × 3 = 150 km) always blocks. Soft limit `GEO_FENCE_KM` warns by default, blocks when `GEO_FENCE_ENFORCE=hard`.
  - First entry seeds the anchor (no fence check on the very first submission).

- **A5 — Status transitions**:
  - `updateEventStatus` is now `authedProcedure`; actor is `ctx.employeeId` (legacy `input.updatedBy` is accepted for client compatibility but ignored).
  - State-machine guard: terminal states (`completed`, `cancelled`) cannot transition (a future Tier B "reopen" admin action will be required).
  - Cancellation requires a non-empty `reason`.
  - Atomic compare-and-set: `UPDATE ... WHERE id=? AND status=previousStatus`; throws `TRPCError CONFLICT` on 0 rows so a racing client gets a clean "refresh and try again".
  - Notifications (`EVENT_STATUS_CHANGED`) fan out to creator + manager + team for paused/cancelled/completed; the actor is excluded.
  - Audit captures `previousStatus`, `newStatus`, `reason`.

- **Authorization (closed in this tier)**:
  - `events.create`, `events.update`, `updateEventStatus`, `submitFinanceCollection` are all converted to `authedProcedure`. Actor identity comes from `ctx.employeeId`; client-supplied `createdBy`/`updatedBy`/`employeeId` is ignored or strictly enforced to match.
  - `events.update` and `updateEventStatus` enforce event-level authorization: only ADMIN/CMD, the event creator, or the assigned event manager can mutate; otherwise `FORBIDDEN`.
  - `submitFinanceCollection` rejects `input.employeeId !== ctx.employeeId`.

- **Notification enum compliance**: All new task-status notifications use the existing `EVENT_STATUS_CHANGED` enum value (no schema migration required); the actual `previousStatus`/`newStatus`/`reason`/`autoCompleted` flags live in `metadata`.

- **Status backdoor closed**: `events.update` accepts `status` in the input schema for backward compatibility but **silently strips** it before the DB write. All status changes must go through `updateEventStatus` so the state-machine, atomic CAS, audit, and notifications fire. Removes the privilege-escalation hole where a client could call `events.update({ status: 'completed' })` and skip every safeguard.

- **Legacy identity fields hardened**: `createdBy` (events.create), `updatedBy` (events.update), `employeeId` (submitFinanceCollection) are all `.optional()` in the input schema; the server rebinds them from `ctx.employeeId`. If a legacy client supplies its own value AND it mismatches `ctx.employeeId`, finance submission throws `FORBIDDEN`. Inserts/audits use the bound local variable, never the optional input field.

- **Cancellation UX & enforcement**: When a manager picks "Cancel Task" from the status modal in `app/event-detail.tsx`, a dedicated modal opens to capture the mandatory reason (`>=5` chars, 500-char counter, with "Keep Task" escape hatch and a disabled Cancel button while the mutation is pending). The same `>=5` chars rule is enforced server-side in `updateEventStatus` (`BAD_REQUEST`), so non-UI clients can't slip through with `"x"`. The status-mutation `onError` detects `CONFLICT` (atomic CAS race) and shows "Someone else updated this task… refreshing" + auto-refetches the latest state.

- **Pre-existing bug fixed**: `events.create` role-check was `role === 'ADMIN' && role !== 'CMD'` (impossible AND, TS warned). Simplified to `role === 'ADMIN'` and switched from `Error` to `TRPCError(FORBIDDEN)` for consistent client handling.

## Manager UX (Tier B)

- **Admin Reopen action** (`events.reopenEvent`): a dedicated escape hatch for completed/cancelled tasks that the state-machine deliberately blocks. ADMIN/CMD only (server-checked via `employees.role`); source state must be terminal; mandatory reason 5+ chars; atomic compare-and-set against the previous terminal status (CONFLICT on race); audits as `REOPEN_EVENT`; notifies creator + assigned manager + every team member (excluding the actor) via `EVENT_STATUS_CHANGED` with `metadata.reopened=true`. UI: when an ADMIN/CMD opens a completed/cancelled task in `app/event-detail.tsx`, the status badge becomes tappable and the status modal exposes a "Reopen Task (Admin)" entry; that entry opens a reason modal (5+ char minimum, 500-char counter, "Keep Closed" escape, button disabled while pending) and surfaces server CONFLICT as "Someone else updated this task… refreshing". Auto-refetches on success.

- **Unified progress endpoint** (`events.getEventProgressSummary`): single tRPC call returning `{ overallPct, breakdown[], subtasks }` for one event. Combines (a) live SIM/FTTH actuals aggregated from `event_sales_entries` (`sims_activated` + `ftth_activated`), (b) the per-category target/completed counters already on the events row (EB, Lease, BTS_DOWN, FTTH_DOWN, ROUTE_FAIL, OFC_FAIL, and the 5 finance categories), and (c) subtask roll-up from `event_subtasks` (total / done / cancelled / active / pct). `overallPct` is the simple average of every non-zero-target category pct plus the subtask pct, capped at 100 so over-collection doesn't inflate the headline. Subtasks are *displayed* but never auto-mutate `event.status` — managers retain full control of the lifecycle.

- **Overall progress bar in EventCard** (`app/(tabs)/events.tsx`): every event row in the list now shows a single progress bar derived locally from the per-category target/completed pairs already on the event prop (no extra round-trip). Bar color shifts at 40% (red), 75% (orange), 100% (green→blue) so managers can scan task health at a glance. Renders only when at least one category has a target > 0. Label adapts to ownership: "Team Progress" when the viewer is on the `assigned_to_me` row (the bar is always team-level; the per-member chips above show the viewer's personal slice), "Overall Progress" everywhere else.

- **Live progress panel in event-detail header**: wires the new `getEventProgressSummary` endpoint into the event-detail screen. Right under the title/location/date block sits a compact panel with (a) the overall % bar (color-tiered like the card), (b) up to 6 per-category target/actual chips (SIM 12/20, FTTH 3/5, EB 2/2, …), and (c) a purple "Subtasks" chip showing `done/active` plus `(+N cancelled)` when applicable. The query has a 30s `staleTime` and is force-refetched from **every** mutation that can move a number — status change, reopen, subtask CRUD, target edits, task progress, member task progress, task approval, sales-entry deletion, and SIM/FTTH activation — so the panel never lags behind the source-of-truth, even when the user stays on the screen and edits in place.

### Polish + Robustness (Tier C)

- **Inventory return on cancel** (`backend/trpc/routes/events.ts → updateEventStatus`): closes a long-standing leak where cancelling a task left its allocated SIM / FTTH counted against the circle's `resources.allocated` forever, falsely lowering the `remaining` pool the next planner sees. When a task transitions from any non-terminal state into `cancelled`, the route reads every `resource_allocations` row for the event, then for each row issues an **atomic** `UPDATE resources SET allocated = GREATEST(0, allocated - LEAST(qty, allocated)), remaining = LEAST(total, remaining + LEAST(qty, allocated))` — server-side arithmetic with `GREATEST`/`LEAST` clamps so the math is race-safe under concurrent cancels and `allocated` can never go negative nor `remaining` exceed `total`. The pre-read on each `resources` row is cosmetic-only (used to split the SIM/FTTH summary toast); it never feeds the update arithmetic, so a stale read can at worst skew the toast number by one — the actual stock numbers are always correct. The route then deletes the allocation rows so a re-cancel after a reopen→cancel cycle is a safe no-op, and writes a dedicated `RETURN_INVENTORY` audit row with per-type counts. **The status flip + audit row + inventory return all live inside a single `db.transaction(...)`** — if any step throws, Postgres rolls back the status flip too, so the system can never end up in a half-cancelled state where the task is `cancelled` but its stock leaked. Notifications stay outside the transaction (best-effort). Completed tasks correctly do *not* trigger a return (their stock is `used`, not just `allocated`). The mutation also returns an `inventoryReturn: { returnedSim, returnedFtth, allocationsRemoved } | null` block so the cancel modal can render a precise success toast ("Returned 12 SIM + 3 FTTH back to the circle pool.") instead of a generic "Task status updated".

- **SLA pill on EventCard** (`app/(tabs)/events.tsx`): every active or upcoming event row in the list now carries a small `Clock`-iconed pill, **right-aligned inline with the date row** so "when is it due?" and "how urgent is that?" are read together as a single piece of information. Five colour bands matching the event-detail header's urgency grammar — green (>7d), orange (3-7d, tightened from yellow for better contrast), orange (1-3d), red (<24h "Due in Nh"), dark-red ("Overdue Nd/h"). Hidden on terminal statuses (`completed`, `cancelled`, `past`) where remaining-time is meaningless, so the card gracefully collapses back to just the date when a task closes out.

- **Status transition map aligned to backend** (`app/event-detail.tsx → STATUS_TRANSITIONS`): terminal entries (`completed`, `cancelled`) now offer no transitions in the status modal — direct flips like `completed → active` or `cancelled → draft` were always rejected by the backend state machine and only produced confusing error toasts. Reopen now goes exclusively through the dedicated `reopenEvent` admin action which has its own role gate, mandatory reason, and notification fan-out.

- **Activity Timeline enhancements** (`app/event-detail.tsx`): the existing Recent Activity panel now (a) shows up to **10** entries instead of 5 so the full reopen→edit→cancel arc fits in a single glance, (b) renders **relative timestamps** ("just now", "Nm ago", "Nh ago") for entries inside the last 24h with the absolute IST date for older rows — the relative diff explicitly compensates for the IST-stored-as-UTC timestamp model by shifting "now" by +5h30m so both sides live in the same coordinate space, and (c) humanizes every Tier A/B/C audit action including `REOPEN_EVENT`, `AUTO_COMPLETE_EVENT`, `RETURN_INVENTORY`, subtask CRUD, sales-entry deletion, SIM/FTTH activations, plus the broader feed: `CREATE_ISSUE`, `UPDATE_ISSUE_STATUS`, `RESOLVE_ISSUE`, `ALLOCATE_RESOURCE` ("allocated 12 SIM + 3 FTTH from circle pool"), `SUBMIT_SALES`, `APPROVE_SALES` / `REJECT_SALES`, `APPROVE_TASK` / `REJECT_TASK`, `SUBMIT_FOR_REVIEW`, `CREATE_EVENT`, `UPDATE_EVENT`, `ASSIGN_TEAM_MEMBER`, `REMOVE_TEAM_MEMBER`, `UPDATE_TEAM_MEMBER_TARGETS`. Unmapped actions fall back to a title-cased label instead of raw `snake_case`. Reopen / auto-complete entries also get a distinct purple icon so lifecycle moments stand apart from routine progress updates.

- **Role label helpers** (`constants/app.ts`): `getRoleLabel(role)` and `getRoleShortLabel(role)` provide a single source of truth for human-readable role names ("Chairman", "Chief General Manager", "SD / JTO", …) so raw enum codes (`SD_JTO`, `CGM`) never leak into audit feeds, member lists, or role pickers. Both helpers gracefully handle null/undefined and unknown codes — a future role rebrand (CGM → Circle Head, etc.) is now a one-line change instead of a grep-and-replace across the app.

## Deployment
Configured for autoscale deployment:
- Build: Exports web version using Expo
- Run: Starts the Bun server on port 5000
