# BSNL Task Notification Service - API Specification

## Document Version
- **Version**: 1.0
- **Last Updated**: January 25, 2026
- **Status**: Active

---

## 1. Overview

### Purpose
This document specifies the requirements for building a standalone Notification Service that sends notifications to BSNL employees when they are assigned to tasks. The service can be developed in any programming language and will integrate with the main BSNL App via REST API.

### Scope
The Notification Service is responsible for:
- Receiving task assignment events from the BSNL App
- Sending notifications via SMS, Email, and/or Push Notifications
- Tracking delivery status
- Providing delivery reports

### Architecture
```
┌─────────────────┐         HTTP POST         ┌─────────────────────┐
│                 │  ───────────────────────> │                     │
│   BSNL App      │                           │ Notification Service│
│   (Main System) │  <─────────────────────── │   (Your Service)    │
│                 │      Response/Status      │                     │
└─────────────────┘                           └─────────────────────┘
                                                        │
                                                        ▼
                                              ┌─────────────────────┐
                                              │ SMS Gateway / Email │
                                              │ Service / Push      │
                                              └─────────────────────┘
```

---

## 2. API Endpoint Requirements

### 2.1 Main Notification Endpoint

Your service must expose this endpoint:

```
POST /api/notify
Content-Type: application/json
Authorization: Bearer <API_KEY>
```

### 2.2 Request Payload

The BSNL App will send the following JSON payload when a task is assigned:

```json
{
  "event_type": "TASK_ASSIGNED",
  "event_id": "evt_abc123xyz",
  "timestamp": "2026-01-25T10:30:00Z",
  "task": {
    "id": 123,
    "name": "SIM Distribution Drive - Mumbai Central",
    "category": "SIM,FTTH",
    "location": "Mumbai Central, Dadar West",
    "circle": "Maharashtra",
    "zone": "West",
    "start_date": "2026-01-25",
    "end_date": "2026-01-30",
    "status": "active",
    "key_insight": "Target 500 SIM activations in 5 days"
  },
  "assignee": {
    "purse_id": "12345678",
    "name": "Rajesh Kumar",
    "designation": "JTO",
    "circle": "Maharashtra",
    "zone": "West",
    "office": "Mumbai Central Exchange",
    "email": "rajesh.kumar@bsnl.co.in",
    "mobile": "9876543210"
  },
  "targets": {
    "sim_target": 50,
    "ftth_target": 20,
    "lease_circuit_target": 0
  },
  "assigned_by": {
    "purse_id": "87654321",
    "name": "Suresh Sharma",
    "designation": "SDE",
    "email": "suresh.sharma@bsnl.co.in",
    "mobile": "9876543211"
  },
  "notification_preferences": {
    "channels": ["sms", "email"],
    "priority": "high"
  }
}
```

### 2.3 Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_type` | string | Yes | Type of event. Values: `TASK_ASSIGNED`, `TASK_UPDATED`, `TASK_REMINDER`, `TASK_COMPLETED` |
| `event_id` | string | Yes | Unique identifier for this event (for idempotency) |
| `timestamp` | string | Yes | ISO 8601 timestamp when event occurred |
| `task.id` | integer | Yes | Unique task identifier in BSNL system |
| `task.name` | string | Yes | Task name/title |
| `task.category` | string | Yes | Comma-separated categories: SIM, FTTH, Lease Circuit, EB, BTS-Down, FTTH-Down, Route-Fail, OFC-Fail |
| `task.location` | string | Yes | Physical location of the task |
| `task.circle` | string | Yes | BSNL Circle (state/region) |
| `task.zone` | string | No | Zone within circle |
| `task.start_date` | string | Yes | Task start date (YYYY-MM-DD) |
| `task.end_date` | string | Yes | Task end date (YYYY-MM-DD) |
| `task.status` | string | Yes | Task status: draft, active, completed, cancelled |
| `task.key_insight` | string | No | Important notes about the task |
| `assignee.purse_id` | string | Yes | Employee's Personnel ID (8 digits) |
| `assignee.name` | string | Yes | Employee's full name |
| `assignee.designation` | string | Yes | Employee's designation (JTO, SDE, AGM, etc.) |
| `assignee.email` | string | No | Employee's email (may be null) |
| `assignee.mobile` | string | Yes | Employee's mobile number (10 digits) |
| `targets.sim_target` | integer | No | Number of SIMs to sell (0 if not applicable) |
| `targets.ftth_target` | integer | No | Number of FTTH connections (0 if not applicable) |
| `assigned_by.name` | string | Yes | Manager who assigned the task |
| `notification_preferences.channels` | array | Yes | Channels to use: `["sms"]`, `["email"]`, `["sms", "email"]`, `["push"]` |
| `notification_preferences.priority` | string | Yes | Priority level: `low`, `normal`, `high` |

---

## 3. Expected Responses

### 3.1 Success Response (HTTP 200)

```json
{
  "success": true,
  "notification_id": "notif_abc123def456",
  "event_id": "evt_abc123xyz",
  "channels_sent": [
    {
      "channel": "sms",
      "status": "sent",
      "provider_id": "sms_xyz789",
      "sent_at": "2026-01-25T10:30:05Z"
    },
    {
      "channel": "email",
      "status": "sent",
      "provider_id": "email_abc123",
      "sent_at": "2026-01-25T10:30:06Z"
    }
  ],
  "timestamp": "2026-01-25T10:30:06Z"
}
```

### 3.2 Partial Success Response (HTTP 207)

When some channels succeed and others fail:

```json
{
  "success": true,
  "partial": true,
  "notification_id": "notif_abc123def456",
  "event_id": "evt_abc123xyz",
  "channels_sent": [
    {
      "channel": "sms",
      "status": "sent",
      "provider_id": "sms_xyz789",
      "sent_at": "2026-01-25T10:30:05Z"
    },
    {
      "channel": "email",
      "status": "failed",
      "error": "Invalid email address",
      "error_code": "INVALID_EMAIL"
    }
  ],
  "timestamp": "2026-01-25T10:30:06Z"
}
```

### 3.3 Error Responses

#### Validation Error (HTTP 400)
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request payload",
    "details": [
      {
        "field": "assignee.mobile",
        "message": "Mobile number must be 10 digits"
      }
    ]
  },
  "timestamp": "2026-01-25T10:30:05Z"
}
```

#### Authentication Error (HTTP 401)
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing API key"
  },
  "timestamp": "2026-01-25T10:30:05Z"
}
```

#### Rate Limit Error (HTTP 429)
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests",
    "retry_after": 60
  },
  "timestamp": "2026-01-25T10:30:05Z"
}
```

#### Server Error (HTTP 500)
```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
  },
  "timestamp": "2026-01-25T10:30:05Z"
}
```

---

## 4. Notification Message Templates

### 4.1 SMS Templates

#### Task Assignment (Hindi + English)
```
BSNL Task Alert!
Dear {assignee.name},
You have been assigned to: {task.name}
Location: {task.location}
Date: {task.start_date} to {task.end_date}
Target: {targets.sim_target} SIM, {targets.ftth_target} FTTH
Assigned by: {assigned_by.name}
-BSNL
```

Character limit: 160 characters (single SMS) or up to 480 characters (concatenated)

#### Task Reminder
```
BSNL Reminder!
Task "{task.name}" ends on {task.end_date}.
Your progress: {current_sales}/{target} completed.
Location: {task.location}
-BSNL
```

### 4.2 Email Templates

#### Subject Line
```
[BSNL Task] You've been assigned to: {task.name}
```

#### Email Body (HTML)
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    .container { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; }
    .header { background: #1976D2; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .task-card { background: #f5f5f5; border-radius: 8px; padding: 15px; margin: 15px 0; }
    .label { color: #666; font-size: 12px; }
    .value { font-weight: bold; color: #333; }
    .targets { display: flex; gap: 20px; margin-top: 10px; }
    .target-box { background: #E3F2FD; padding: 10px; border-radius: 4px; text-align: center; }
    .footer { background: #f5f5f5; padding: 15px; text-align: center; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>BSNL Task Assignment</h1>
    </div>
    <div class="content">
      <p>Dear <strong>{assignee.name}</strong>,</p>
      <p>You have been assigned to a new task by <strong>{assigned_by.name}</strong>.</p>
      
      <div class="task-card">
        <div class="label">Task Name</div>
        <div class="value">{task.name}</div>
        
        <div style="margin-top: 10px;">
          <div class="label">Location</div>
          <div class="value">{task.location}</div>
        </div>
        
        <div style="margin-top: 10px;">
          <div class="label">Duration</div>
          <div class="value">{task.start_date} to {task.end_date}</div>
        </div>
        
        <div class="targets">
          <div class="target-box">
            <div class="label">SIM Target</div>
            <div class="value">{targets.sim_target}</div>
          </div>
          <div class="target-box">
            <div class="label">FTTH Target</div>
            <div class="value">{targets.ftth_target}</div>
          </div>
        </div>
      </div>
      
      <p><strong>Key Information:</strong> {task.key_insight}</p>
      
      <p>Please log in to the BSNL App to view complete details and start recording your progress.</p>
    </div>
    <div class="footer">
      <p>This is an automated notification from BSNL Sales & Task App.</p>
      <p>© 2026 Bharat Sanchar Nigam Limited</p>
    </div>
  </div>
</body>
</html>
```

---

## 5. Event Types

Your service should handle the following event types:

| Event Type | When Triggered | Priority |
|------------|----------------|----------|
| `TASK_ASSIGNED` | Employee added to a task team | High |
| `TASK_UPDATED` | Task details modified (dates, targets, location) | Normal |
| `TASK_REMINDER` | Scheduled reminder before task end date | Normal |
| `TASK_COMPLETED` | Task marked as completed | Low |
| `TARGET_UPDATED` | Employee's individual target changed | High |
| `TASK_CANCELLED` | Task cancelled by manager | High |

---

## 6. Security Requirements

### 6.1 Authentication
- All requests will include an API key in the `Authorization` header
- Format: `Authorization: Bearer <YOUR_API_KEY>`
- Your service must validate this key before processing

### 6.2 API Key Management
- We will provide you with an API key for integration
- The API key should be stored securely (environment variable, secrets manager)
- Never log or expose the API key

### 6.3 HTTPS Only
- Your service must use HTTPS (TLS 1.2 or higher)
- HTTP requests should be rejected or redirected

### 6.4 Request Validation
- Validate all incoming data before processing
- Sanitize phone numbers and email addresses
- Reject malformed requests with appropriate error codes

### 6.5 Idempotency
- Use `event_id` to prevent duplicate notifications
- If the same `event_id` is received twice, return the original response without resending

---

## 7. Rate Limits & Performance

### 7.1 Expected Volume
- Average: 100-500 notifications per day
- Peak: Up to 50 notifications per minute (during bulk assignments)
- Spikes: Up to 1000 notifications during major task creation

### 7.2 Response Time Requirements
- API response: < 3 seconds
- SMS delivery: < 30 seconds
- Email delivery: < 2 minutes

### 7.3 Rate Limiting (Your Implementation)
- Implement rate limiting to protect your service
- Suggested: 100 requests per minute per API key
- Return HTTP 429 when limit exceeded

---

## 8. Delivery Status Webhook (Optional)

If you want to report delivery status back to us, we can provide a webhook:

```
POST https://your-bsnl-app.com/api/webhooks/notification-status
Content-Type: application/json
Authorization: Bearer <WEBHOOK_SECRET>

{
  "notification_id": "notif_abc123def456",
  "event_id": "evt_abc123xyz",
  "channel": "sms",
  "status": "delivered",
  "delivered_at": "2026-01-25T10:30:15Z",
  "provider_status": "DELIVERED",
  "provider_id": "sms_xyz789"
}
```

Status values: `pending`, `sent`, `delivered`, `failed`, `bounced`

---

## 9. Testing

### 9.1 Test Endpoint
Provide a test endpoint for us to verify integration:

```
POST /api/notify/test
```

Should return:
```json
{
  "status": "ok",
  "service": "BSNL Notification Service",
  "version": "1.0.0",
  "timestamp": "2026-01-25T10:30:00Z"
}
```

### 9.2 Test Phone Numbers
Use these test numbers during development (won't send actual SMS):
- `9999999991` - Always succeeds
- `9999999992` - Always fails (simulated error)
- `9999999993` - Delayed delivery (5 second delay)

### 9.3 Test Email Addresses
- `test-success@bsnl.test` - Always succeeds
- `test-fail@bsnl.test` - Always fails
- `test-bounce@bsnl.test` - Simulates bounce

---

## 10. Recommended Technology Stack

You may use any language/framework. Here are some recommendations:

### Option A: Node.js
```
- Runtime: Node.js 18+
- Framework: Express.js or Fastify
- SMS: Twilio, MSG91, or AWS SNS
- Email: SendGrid, AWS SES, or Nodemailer
```

### Option B: Python
```
- Runtime: Python 3.10+
- Framework: FastAPI or Flask
- SMS: Twilio, MSG91
- Email: SendGrid, AWS SES
```

### Option C: Go
```
- Runtime: Go 1.20+
- Framework: Gin or Echo
- SMS/Email: Direct API integration
```

---

## 11. Deployment Checklist

Before going live, ensure:

- [ ] HTTPS enabled with valid SSL certificate
- [ ] API key authentication working
- [ ] All error responses follow the specified format
- [ ] Idempotency implemented using event_id
- [ ] Rate limiting configured
- [ ] Logging in place (without exposing sensitive data)
- [ ] Health check endpoint available
- [ ] Test endpoint working
- [ ] SMS gateway integrated and tested
- [ ] Email service integrated and tested
- [ ] Monitoring/alerting set up

---

## 12. Contact & Support

For integration questions or API key requests:

- **Project Owner**: [Your Name]
- **Email**: [Your Email]
- **Integration Timeline**: [Expected Date]

---

## 13. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-25 | Initial specification |

---

## Appendix A: Sample cURL Requests

### Test Connection
```bash
curl -X POST https://your-service.com/api/notify/test \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Send Task Assignment Notification
```bash
curl -X POST https://your-service.com/api/notify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "event_type": "TASK_ASSIGNED",
    "event_id": "evt_test_001",
    "timestamp": "2026-01-25T10:30:00Z",
    "task": {
      "id": 1,
      "name": "Test Task",
      "category": "SIM",
      "location": "Test Location",
      "circle": "Maharashtra",
      "start_date": "2026-01-25",
      "end_date": "2026-01-30",
      "status": "active"
    },
    "assignee": {
      "purse_id": "12345678",
      "name": "Test User",
      "designation": "JTO",
      "mobile": "9999999991",
      "email": "test@bsnl.co.in"
    },
    "targets": {
      "sim_target": 10,
      "ftth_target": 5
    },
    "assigned_by": {
      "purse_id": "87654321",
      "name": "Test Manager"
    },
    "notification_preferences": {
      "channels": ["sms", "email"],
      "priority": "high"
    }
  }'
```

---

## Appendix B: Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request payload validation failed |
| `INVALID_PHONE` | 400 | Invalid phone number format |
| `INVALID_EMAIL` | 400 | Invalid email address format |
| `MISSING_REQUIRED_FIELD` | 400 | Required field is missing |
| `UNAUTHORIZED` | 401 | Invalid or missing API key |
| `FORBIDDEN` | 403 | API key doesn't have permission |
| `NOT_FOUND` | 404 | Endpoint not found |
| `DUPLICATE_EVENT` | 409 | Event already processed (idempotency) |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `SMS_PROVIDER_ERROR` | 502 | SMS gateway error |
| `EMAIL_PROVIDER_ERROR` | 502 | Email service error |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
