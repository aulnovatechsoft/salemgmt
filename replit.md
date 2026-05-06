# BSNL Sales & Task App
A mobile-first application for managing task assignments and tracking performance for BSNL (Bharat Sanchar Nigam Limited) with web deployment support.

## Run & Operate
- **Run migrations**: `bun run backend/db/migrate.ts`
- **Build web**: `bunx expo export --platform web`
- **Start server**: `bun run server.ts`
- **Env Vars**:
    - `BSNL_DATABASE_URL`: PostgreSQL connection string.
    - `GEO_FENCE_KM`: Soft geo-fence radius in km (default `50`).
    - `GEO_FENCE_ENFORCE`: `soft` (log + allow) or `hard` (reject).

## Stack
- **Frontend**: React Native, Expo SDK 54, React Native Web
- **Backend**: Hono, tRPC
- **Database**: PostgreSQL (via Drizzle ORM)
- **State Management**: Zustand, React Query
- **Styling**: React Native StyleSheet
- **Build Tool**: Bun

## Where things live
- `app/`: Expo Router pages (screens).
- `backend/db/schema.ts`: Database schema definition.
- `backend/trpc/routes/`: tRPC API route handlers.
- `lib/photoUpload.ts`: Photo upload logic (enforces HTTPS).
- `backend/trpc/routes/events.ts`: Core event/task logic.
- `backend/trpc/routes/sales.ts`: Sales and analytics reporting logic.
- `components/TimePeriodPicker.tsx`: Time period selection component.
- `utils/timePeriod.ts`: India-local calendar math for time periods.
- `constants/app.ts`: Application constants, including role labels.

## Architecture decisions
- **"Task" Terminology**: Consistently uses "Task" instead of "Event" across the application for clarity.
- **Finance Collection Workflow**: Implements a strict submit→approve/reject lifecycle for finance entries with transaction-level safeguards against race conditions and data integrity.
- **Geo-fencing**: Enforces location-based submission validation with soft and hard limits, dynamically calculating anchors from prior entries.
- **Audit Logging & Notifications**: Critical actions trigger audit logs and best-effort notifications (logged but not blocking core transactions) for resilience.
- **Hierarchical Data Access**: Analytics and reports use `getVisibleEmployeeIdsSubquery` to enforce data visibility based on employee hierarchy and roles.
- **IST-correct Daily Bucketing**: Database aggregations are time-zone aware (`AT TIME ZONE 'Asia/Kolkata'`) to ensure accurate daily data alignment regardless of server timezone.

## Product
- **Task Management**: Create, assign, and track various task categories (Sales, O&M, Finance).
- **Sales & Marketing (S&M) Submission**: Guided flow for submitting sales data, including geo-fencing and photo uploads.
- **Finance Collection**: Workflow for submitting, approving, and rejecting financial collections with robust validation.
- **Operations & Maintenance (O&M) Entry**: Dedicated workflow for recording maintenance activities with photo and location.
- **Hierarchy & Reporting**: Comprehensive employee hierarchy system with CSV import, and multi-tier analytics dashboards for sales, O&M, and finance.
- **Real-time Notifications**: System for push and in-app notifications for task assignments, status changes, issues, and subtasks.
- **Resource Management**: Tracks SIM and FTTH inventory from circle allocation to individual sales.
- **Admin Tools**: Bulk task upload via CSV, privileged user management, and executive task console for national overview.
- **Automated Task Status**: Tasks automatically complete based on end dates, with a scheduled sweep to ensure accuracy.

## User preferences
_Populate as you build_

## Gotchas
- **Photo Uploads in Native Builds**: `EXPO_PUBLIC_API_BASE_URL` must be set to an HTTPS URL for native builds; local development works with `localhost` over HTTP.
- **GPS capture on web**: Submission screens (`app/event-sales.tsx`, `app/submit-maintenance.tsx`) must call `navigator.geolocation.getCurrentPosition` on web — never short-circuit to `{latitude:'0', longitude:'0'}`. An earlier shortcut did exactly that and silently lied to the user with a "Location Captured ✓" pill while populating Null Island, causing every web submission to be hard-rejected by the backend geo-fence (~9000 km from any real BSNL circle anchor). On any new submission screen, surface a clear error when the browser denies permission, fails, or times out — never fall back to bogus coordinates.
- **O&M Undo Gap**: Undoing O&M progress decrements the counter but doesn't delete `maintenance_entries` rows, leading to potential drift (P2 to address).
- **Status Backdoor Closed**: Direct status changes via `events.update` are stripped; all status transitions must use `updateEventStatus` for proper state machine, auditing, and notifications.
- **`GEO_FENCE_KM * GEO_FENCE_HARD_MULT`**: Submissions beyond this hard limit (default 150km) are always rejected.

## Pointers
- **Expo Documentation**: [https://docs.expo.dev/](https://docs.expo.dev/)
- **Hono Documentation**: [https://hono.dev/](https://hono.dev/)
- **tRPC Documentation**: [https://trpc.io/docs](https://trpc.io/docs)
- **Drizzle ORM Documentation**: [https://orm.drizzle.team/](https://orm.drizzle.team/)
- **React Native Documentation**: [https://reactnative.dev/docs](https://reactnative.dev/docs)
- **Zustand Documentation**: [https://docs.pmnd.rs/zustand/getting-started/introduction](https://docs.pmnd.rs/zustand/getting-started/introduction)
- **React Query Documentation**: [https://tanstack.com/query/latest](https://tanstack.com/query/latest)