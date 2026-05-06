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
    - `EXPO_PUBLIC_GPS_TEST_MODE`: When `1`/`true`/`on`, web GPS capture returns Bharat Sanchar Bhawan (28.6259, 77.2088) instead of calling `navigator.geolocation`, and screens render an orange "TEST MODE" banner. Lets the QA team test web flows without HTTPS / real GPS. **MUST be unset (or `0`) for production builds** — the value is baked into the JS bundle at build time.

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
- `lib/captureLocation.ts`: Cross-platform GPS capture used by all submission screens (handles HTTPS-required errors, permission flows, code-mapped messages).
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
- **GPS capture (all submission screens)**: For the screen-level location state (the value that gets sent to the backend on submit), ALWAYS go through `captureLocation()` in `lib/captureLocation.ts`. The helper centralises four production-critical guarantees: (1) HTTPS / secure-context detection (geolocation is silently blocked on `http://` origins by all modern browsers, returns generic PERMISSION_DENIED with misleading guidance); (2) error-code-to-actionable-message mapping; (3) preemptive-prompt avoidance — auto-capture on mount must pass `{ onlyIfAlreadyGranted: true }` so the OS/browser permission prompt only fires from an explicit user button press; (4) runtime Null Island guard — coordinates exactly at (0, 0) are rejected as `INVALID_COORDS` regardless of source, so a buggy browser/device/mock can never silently slip past the geo-fence. The original regression: an earlier `if (Platform.OS === 'web') setLocation({lat:'0', lon:'0'})` shortcut silently lied to users with a "Location Captured ✓" pill while every web submission was hard-rejected by the backend geo-fence (~9000 km from any real BSNL circle anchor). Note: it is acceptable for native photo-capture flows (`takePhoto` / `pickImage`) to call `Location.getCurrentPositionAsync` directly for a fresher per-photo geo-tag — that's a non-blocking refresh on top of an already-validated `currentLocation`, never a substitute for it.
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