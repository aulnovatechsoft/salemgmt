---
name: Task management permissions & role hierarchy
description: Who may edit/pause/complete/cancel a task, and the CGM>GM seniority correction.
---

# Task management permission rule (edit / pause / complete / cancel)

Rule (product decision): a task may be managed by **the creator, OR anyone whose
role is a PEER OR ABOVE the creator's role** in the seniority hierarchy. Someone
strictly BELOW the creator cannot manage it. CMD/ADMIN are always allowed
(system-level roles).

**Why:** Triggering incident — a GM (NIRMAL) could edit a task created by a CGM
(SAJI) merely because GM held a "can create events" role. The old gate was a flat
role-list check (`canCreateEvents(role) || isCreator`), which let any management
role edit ANY task regardless of who created it. The user wanted strict
seniority: peers and seniors of the creator may manage; juniors may not.

**How to apply:** Single helper `canManageEvent(actorRole, creatorRole)` in
`constants/app.ts` is the source of truth, used in THREE places that must stay in
sync:
1. Frontend `canManageTeam` in `app/event-detail.tsx` (drives the edit pencil,
   status-transition buttons, team/target controls). Needs `creatorRole`, which
   `getEventWithDetails` now returns.
2. Backend `events.update` authorization.
3. Backend `events.updateEventStatus` authorization.
Backend is the real enforcement boundary; the frontend gate is cosmetic.
Helper contract: CMD/ADMIN → always true; null/unknown creatorRole → fall back to
`canCreateEvents(actorRole)` (avoids locking out legacy rows); unknown roles → deny.

**Known policy exception:** ADMIN (rank 10) is below CMD (rank 11) numerically but
is still always allowed via the `isAdminRole` fast-path. So ADMIN can manage a
CMD-created task. Intentional (ADMIN is a system/support role), not strict rank.

# Role seniority: CGM is SENIOR to GM

`getRoleHierarchy` in `constants/app.ts`: CMD:11, ADMIN:10, **CGM:6, GM:5**,
DGM:4, AGM:3, SD_JTO:2, SALES_STAFF:1.

**Why:** Real BSNL hierarchy — CGM (Chief General Manager, heads a Circle) is
senior to GM. The original ranking had GM:6 > CGM:5 (modeled "GM = multi-circle")
which contradicted the user's org and broke the peer-or-above rule.

**Gotcha:** The `USER_ROLES` role-picker array still lists "GM (Multi-Circle)"
ABOVE "CGM (Circle)" for display. That display order does NOT reflect seniority —
seniority comes only from `getRoleHierarchy`. Don't infer rank from the picker
order. `getRoleHierarchy` had no other functional consumers, so swapping CGM/GM
was safe.
