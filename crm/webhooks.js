// Public (unauthenticated) webhook endpoints, keyed by a location API key.
// - POST /webhooks/forms/:apiKey   — website form submissions → contact upsert
// - POST /webhooks/calls           — call events from the SRCA phone bridge

const express = require('express');
const db = require('./lib/db');
const engine = require('./lib/engine');

const router = express.Router();

function locationForKey(key) {
  const row = key && db.findOne('apiKeys', { key });
  return row ? db.get('locations', row.locationId) : null;
}

function upsertContactByPhoneOrEmail(locationId, data) {
  const phone = (data.phone || '').replace(/[^\d+]/g, '');
  let contact = null;
  if (phone) contact = db.findOne('contacts', c => c.locationId === locationId && (c.phone || '').replace(/[^\d+]/g, '') === phone);
  if (!contact && data.email) {
    contact = db.findOne('contacts', c => c.locationId === locationId &&
      c.email && c.email.toLowerCase() === String(data.email).toLowerCase());
  }
  if (contact) return { contact, created: false };

  contact = db.insert('contacts', {
    locationId,
    firstName: data.firstName || '', lastName: data.lastName || '',
    email: data.email || '', phone: data.phone || '',
    company: data.company || '', tags: data.tags || [],
    source: data.source || 'webhook', customFields: {}, dnd: false, leadScore: 0
  });
  engine.fireEvent(locationId, 'contact.created', { contact, summary: `Contact created (${contact.source})` });
  return { contact, created: true };
}

// Website form → lead
router.post('/forms/:apiKey', (req, res) => {
  const location = locationForKey(req.params.apiKey);
  if (!location) return res.status(401).json({ error: 'invalid api key' });
  const body = req.body || {};
  const { contact, created } = upsertContactByPhoneOrEmail(location.id, { ...body, source: 'form' });
  engine.fireEvent(location.id, 'form.submitted', {
    contact,
    summary: `Form submitted: ${body.formName || 'website form'}`,
    data: body
  });
  res.json({ ok: true, contactId: contact.id, created });
});

// Call event from the phone bridge (or any dialer).
// { apiKey, from, to, direction, durationSeconds, status, transcript, recordingUrl }
router.post('/calls', (req, res) => {
  const body = req.body || {};
  const location = locationForKey(body.apiKey || req.headers['x-api-key']);
  if (!location) return res.status(401).json({ error: 'invalid api key' });

  const callerNumber = body.direction === 'outbound' ? body.to : body.from;
  const { contact } = upsertContactByPhoneOrEmail(location.id, {
    phone: callerNumber, firstName: 'Caller', lastName: callerNumber || '', source: 'phone'
  });

  const summary = [
    `${body.direction || 'inbound'} call`,
    body.durationSeconds != null ? `${body.durationSeconds}s` : null,
    body.status || 'completed'
  ].filter(Boolean).join(' · ');

  engine.sendMessage(location.id, contact.id, {
    channel: 'call',
    direction: body.direction === 'outbound' ? 'outbound' : 'inbound',
    body: body.transcript ? `${summary}\n${body.transcript}` : summary,
    meta: {
      from: body.from, to: body.to,
      durationSeconds: body.durationSeconds || 0,
      recordingUrl: body.recordingUrl || null,
      hangupCause: body.hangupCause || null
    },
    source: 'phone-bridge'
  });

  engine.fireEvent(location.id, 'call.completed', {
    contact,
    summary,
    data: { from: body.from, to: body.to, durationSeconds: body.durationSeconds || 0 }
  });

  res.json({ ok: true, contactId: contact.id });
});

module.exports = router;
