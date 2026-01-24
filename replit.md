# BSNL Sales & Work App

## Overview
BSNL Sales & Work App is a mobile-first application for managing work assignments and tracking performance for BSNL (Bharat Sanchar Nigam Limited). Built with Expo (React Native) and a Hono/tRPC backend, the app supports web deployment. The app uses "Work" terminology throughout (not "Event").

## Tech Stack
- **Frontend**: React Native with Expo SDK 54, React Native Web
- **Backend**: Hono server with tRPC for type-safe API calls
- **Database**: PostgreSQL (external Neon database)
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
- **sales_reports**: Sales submissions with approval workflow
- **resources**: SIM and FTTH resource inventory
- **issues**: Event-related issues and escalations
- **event_assignments**: Employee-to-event assignments with targets
- **event_sales_entries**: Individual sales records
- **audit_logs**: Activity tracking
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
- Users link their accounts to official records via "Link My Purse ID" in /profile
- After linking, users see their reporting manager and subordinates in the hierarchy view
- Backfill mechanism: When managers link after subordinates, the system automatically updates reporting relationships

## Work Categories
The app supports 8 work categories that can be selected individually or in combination:
1. **SIM** - SIM card sales (shows SIM target field)
2. **FTTH** - Fiber to the Home installations (shows FTTH target field)
3. **Lease Circuit** - Leased line connections (shows Lease Circuit target field)
4. **EB** - Exchange based work
5. **BTS-Down** - Base station maintenance (maintenance type)
6. **FTTH-Down** - FTTH maintenance (maintenance type)
7. **Route-Fail** - Route failure resolution (maintenance type)
8. **OFC-Fail** - Optical fiber cable failure (maintenance type)

Categories are stored as comma-separated values when multiple are selected.

## Work Manager Assignment
- Mobile number lookup: Enter 10-digit mobile to auto-populate Purse ID
- Purse ID lookup: Directly enter Purse ID to find registered employee
- Two-step confirmation: Found employee card with Cancel/Confirm buttons
- Confirmed employee shows verified badge with "Change" option
- Professional card UI with avatar initials, designation, and circle

## Time-Based Work Status Management
- **Automatic completion**: Works with status 'active' automatically change to 'completed' when end date passes
- Applied consistently across all API endpoints (getAll, getByCircle, getActiveEvents, getUpcomingEvents)
- Status updates happen on data fetch, ensuring real-time accuracy

## Dashboard Work Progress Display
- **Date indicators**: Each work card shows start/end date range
- **Visual status badges** with color coding:
  - Green: "X days left" (active)
  - Yellow: "Ends tomorrow" or "Ends in 2 days" (ending soon)
  - Red: "Ends today" (urgent)
  - Gray: "Ended X days ago" (completed)
  - Blue: "Starts in X days" (upcoming)
- **Limited display**: Shows top 3 active works by default
- **"See More" button**: Expands to show all works when more than 3 available
- **Work counts**: Shows total count next to section headers

## Works CSV Upload (Admin Feature)
- Admins can bulk upload works via CSV at /admin page
- Required CSV columns: Work Name, Location, Category
- Optional CSV columns: Circle (auto-detected from location), Date Range, Zone, Key Insight
- Date Range format: "2025-10-15 to 2025-10-20" or single date "2025-10-15"
- Duplicate handling: Works with same name + location + circle are updated instead of duplicated
- Uploaded works are created in "draft" status, ready for managers to activate and assign teams

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
3. **Field Officers** (team members): Do the actual field work, sales, and report progress

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
- Event manager distributes allocated resources to team members
- Each team member gets simTarget and ftthTarget in eventAssignments
- System validates: sum of team targets ≤ event's allocated resources
- UI shows "Available to Distribute" count in team assignment modal

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
- Frontend: Static web build from Expo export
- Backend: tRPC API at /api/trpc/*
- Health check: GET /health

## Environment Variables
- `DATABASE_URL`: PostgreSQL connection string (stored as secret)

## Development Commands
- `bun install`: Install dependencies
- `bun run backend/db/migrate.ts`: Run database migrations
- `bunx expo export --platform web`: Build web version
- `bun run server.ts`: Start production server

## Deployment
Configured for autoscale deployment:
- Build: Exports web version using Expo
- Run: Starts the Bun server on port 5000
