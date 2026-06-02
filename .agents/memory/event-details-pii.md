---
name: getEventWithDetails PII gate
description: Why the task-detail loader is authed and conditionally attaches sale-line detail.
---

# Sale-line detail is gated PII on getEventWithDetails

The task/event detail loader (`events.getEventWithDetails`) returns aggregate sales
counts to anyone who can open a task. The per-item sale-line tables
(`simSaleLines` / `ftthSaleLines` / `lcSaleLines` / `ebSaleLines`) hold customer
**PII** — mobile numbers, customer names/contacts, site addresses, meter numbers.

**Rule:** those line arrays must only be attached to the response for an authorized
viewer — the task creator (`createdBy`), the assigned manager (`assignedTo`), an
assigned team member, or a management role (CMD/ADMIN/GM/CGM/DGM/AGM). Everyone else
gets aggregate counts only. The endpoint is `authedProcedure` (not public), and the
actor is derived from `ctx.employeeId`, never from input.

**Why:** the detail UI on the task screen needs the creator (pre-approval) and the
assignee to see exactly what was submitted, but exposing customer PII to every viewer
of a task is a broken-access-control regression. An architect review caught this when
the line tables were first surfaced to the UI.

**How to apply:** if you add any new sensitive per-submission data to this endpoint
(or a sibling loader), gate it the same way and keep the endpoint authed. Note the
app-wide identity model is an unsigned `x-employee-id` header (see replit.md's
authedProcedure gotcha) — `authedProcedure` + `ctx.employeeId` is the accepted trust
boundary here; signed sessions/JWT do not exist, so do not assume the header is
unspoofable, but match the same boundary every other actor-bearing endpoint uses.
