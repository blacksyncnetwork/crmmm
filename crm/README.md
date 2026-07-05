# BlackSync CRM

A GoHighLevel-style, multi-tenant CRM for BlackSync — agency on top,
unlimited **sub-accounts** underneath, with pipelines, unified conversations,
automations, and native call logging from the SRCA phone bridge.

Zero build step, zero native dependencies: Node + Express + a JSON datastore,
and a vanilla-JS single-page app.

## Run it

```bash
npm install
npm run crm          # http://localhost:8090
```

First boot seeds a full demo workspace:

| Login | Role |
|---|---|
| `admin@blacksync.capital` / `blacksync123` | Agency admin (all sub-accounts) |
| `maya@blacksync.capital` / `blacksync123` | Account admin (HQ only) |
| `devon@blacksyncrealty.com` / `blacksync123` | User (Realty only) |

Seeded sub-accounts: **BlackSync Capital — HQ** (funding pipeline, contacts,
conversations, automations, 30 days of activity) and **BlackSync Realty**.

## Features

- **Agency → sub-accounts** — every location has its own contacts, pipelines,
  conversations, calendars, automations, custom fields, and API keys. Users are
  scoped per location; agency admins see everything. Location switcher in the
  top bar.
- **Snapshots** — clone any sub-account's pipelines, automations, custom
  fields, smart lists, and calendars into a new sub-account (GHL snapshots).
- **Contacts** — tags, custom fields, DND, CSV import, full activity timeline,
  automatic **lead scoring** from calls/messages/appointments/wins.
- **Smart lists** — saved filters (tag, min score, source).
- **Pipelines** — kanban board with drag-and-drop stage moves, won/lost,
  per-stage totals; stage moves fire automations. Full pipeline manager:
  create pipelines, add/rename/reorder/delete stages.
- **Power Dialer** — build a call queue from all contacts, a smart list, or a
  tag (DND and phoneless contacts skipped, hottest lead score first), then
  dial straight through with a live call timer. Dispositions: answered,
  voicemail, no answer, busy, callback, wrong number. Each outcome logs the
  call to the contact's conversation, fires `call.completed` automations, and
  applies session rules — answered moves the deal to a stage you pick,
  voicemail/no-answer tag the contact, callback creates a due task, wrong
  number sets DND. Dials go out through Telnyx Call Control when
  `TELNYX_API_KEY`/`TELNYX_CONNECTION_ID`/`TELNYX_PHONE_NUMBER` are set;
  otherwise calls are simulated so the workflow works everywhere.
- **Conversations** — one unified thread per contact for SMS, email, notes,
  and call logs. Outbound sends are recorded as `simulated` until a real
  SMS/email provider is wired in, so the whole flow is testable end to end.
- **Calendar & tasks** — appointments (booking fires automations), task list
  with due dates, auto-created follow-up tasks.
- **Automations** — trigger → actions workflows with a visual editor, per-run
  history, and dry-run testing. Triggers: contact created, tag added, form
  submitted, opportunity stage changed, call completed, inbound message,
  appointment booked. Actions: send SMS/email, add/remove tag, create
  task/opportunity, add note, outbound webhook. `{{contact.first_name}}`-style
  merge fields supported.
- **Lead claiming** — a Claim button on every unowned contact assigns it to
  the clicking user and fires the `contact.claimed` trigger, so "as soon as
  someone claims the lead" automations (personalized intro email + sequence
  enrollment + first-call task) run instantly. Claimed leads show their owner.
- **Email sequences** — multi-step drips with per-step delays and
  `{{contact.first_name}}` personalization. Enroll manually, or via the
  `enroll_sequence` automation action. Sequences stop automatically when the
  contact replies or goes DND; enrollments and next-send times are visible
  per sequence.
- **Real email via Google** — set `SMTP_HOST/PORT/USER/PASS` (Gmail app
  password) and every automation, sequence step, and conversation email is
  actually delivered from your Google account; without credentials, sends are
  recorded as `simulated`. Settings shows live/simulated status.
- **Light & dark themes** — white-background option, toggle in the top bar,
  persisted per browser. Charts re-color per theme with a validated palette.
- **Dashboard** — KPIs, 30-day activity chart, pipeline funnel, live feed.
- **Public webhooks** (keyed by per-location API keys):
  - `POST /webhooks/forms/:apiKey` — website form → contact upsert +
    `form.submitted` automations.
  - `POST /webhooks/calls` — call events → contact matched/created by phone,
    call logged into its conversation, `call.completed` automations.

## Phone bridge integration

Set these on the SRCA phone-bridge service and every finished call lands in
the CRM automatically:

```bash
CRM_WEBHOOK_URL=https://<your-crm-host>/webhooks/calls
CRM_API_KEY=<key from CRM Settings → API keys>
```

## Deploying on Railway

Run the CRM as a second service from the same repo:

- Start command: `npm run crm`
- Add a volume and set `CRM_DATA_DIR` to its mount path (the datastore is a
  single JSON file; without a volume, data resets on redeploy)
- Set `CRM_JWT_SECRET` to a long random string

## API sketch

All authenticated routes take `Authorization: Bearer <token>` (from
`POST /api/auth/login`) and, for location-scoped data, `X-Location-Id`.

```
POST /api/auth/login                          GET  /api/auth/me
GET  /api/agency/overview                     POST /api/agency/locations   (snapshotFromLocationId to clone)
GET  /api/agency/locations/:id/snapshot       POST /api/agency/users
GET/POST /api/contacts                        GET/PATCH/DELETE /api/contacts/:id
POST /api/contacts/import                     POST /api/contacts/:id/tags
GET/POST /api/pipelines                       GET/POST/PATCH /api/opportunities
GET/POST /api/conversations                   GET/POST /api/conversations/:id/messages
GET/POST /api/tasks                           GET/POST /api/appointments
GET/POST/PATCH /api/automations               GET /api/automation-runs
GET/POST /api/custom-fields                   GET/POST /api/smart-lists
GET/POST /api/api-keys                        GET /api/dashboard
```
