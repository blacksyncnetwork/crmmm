// BlackSync CRM — REST API.
// Multi-tenant: agency → sub-accounts (locations). Location-scoped routes
// require the X-Location-Id header; agency routes require agency_admin.

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('./lib/db');
const auth = require('./lib/auth');
const engine = require('./lib/engine');

const router = express.Router();

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.findOne('users', u => u.email.toLowerCase() === String(email || '').toLowerCase());
  if (!user || !auth.verifyPassword(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const token = auth.signToken({ sub: user.id });
  res.json({ token, user: auth.publicUser(user), locations: accessibleLocations(user) });
});

router.use(auth.requireAuth);

router.get('/auth/me', (req, res) => {
  res.json({ user: auth.publicUser(req.user), locations: accessibleLocations(req.user) });
});

function accessibleLocations(user) {
  const locations = db.all('locations');
  if (user.role === 'agency_admin') return locations;
  return locations.filter(l => (user.locationIds || []).includes(l.id));
}

// ---------------------------------------------------------------------------
// Agency: sub-accounts, users, snapshots
// ---------------------------------------------------------------------------

router.get('/agency/overview', auth.requireAgencyAdmin, (req, res) => {
  const locations = db.all('locations').map(loc => {
    const opps = db.find('opportunities', { locationId: loc.id });
    const open = opps.filter(o => o.status === 'open');
    return {
      ...loc,
      contacts: db.find('contacts', { locationId: loc.id }).length,
      openOpportunities: open.length,
      pipelineValue: open.reduce((s, o) => s + (o.value || 0), 0),
      wonValue: opps.filter(o => o.status === 'won').reduce((s, o) => s + (o.value || 0), 0),
      users: db.find('users', u => (u.locationIds || []).includes(loc.id)).length
    };
  });
  res.json({ locations });
});

router.post('/agency/locations', auth.requireAgencyAdmin, (req, res) => {
  const { name, industry, phone, email, website, snapshotFromLocationId } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const location = db.insert('locations', {
    name, industry: industry || '', phone: phone || '', email: email || '', website: website || '',
    agencyId: 'blacksync', settings: { timezone: 'America/New_York' }
  });

  if (snapshotFromLocationId && db.get('locations', snapshotFromLocationId)) {
    applySnapshot(location.id, buildSnapshot(snapshotFromLocationId));
  } else {
    seedLocationDefaults(location.id);
  }
  res.status(201).json(location);
});

router.patch('/agency/locations/:id', auth.requireAgencyAdmin, (req, res) => {
  const { name, industry, phone, email, website, settings } = req.body || {};
  const loc = db.update('locations', req.params.id, prune({ name, industry, phone, email, website, settings }));
  if (!loc) return res.status(404).json({ error: 'not found' });
  res.json(loc);
});

router.delete('/agency/locations/:id', auth.requireAgencyAdmin, (req, res) => {
  const id = req.params.id;
  if (!db.get('locations', id)) return res.status(404).json({ error: 'not found' });
  for (const c of ['contacts', 'pipelines', 'opportunities', 'conversations', 'messages',
    'tasks', 'appointments', 'calendars', 'automations', 'automationRuns',
    'activities', 'customFields', 'smartLists', 'apiKeys']) {
    db.removeWhere(c, { locationId: id });
  }
  db.remove('locations', id);
  res.json({ ok: true });
});

// Snapshot = pipelines + automations + custom fields + smart lists + calendars.
router.get('/agency/locations/:id/snapshot', auth.requireAgencyAdmin, (req, res) => {
  if (!db.get('locations', req.params.id)) return res.status(404).json({ error: 'not found' });
  res.json(buildSnapshot(req.params.id));
});

function buildSnapshot(locationId) {
  const strip = r => { const { id, locationId: _l, createdAt, updatedAt, ...rest } = r; return rest; };
  return {
    pipelines: db.find('pipelines', { locationId }).map(strip),
    automations: db.find('automations', { locationId }).map(strip),
    customFields: db.find('customFields', { locationId }).map(strip),
    smartLists: db.find('smartLists', { locationId }).map(strip),
    calendars: db.find('calendars', { locationId }).map(strip)
  };
}

function applySnapshot(locationId, snapshot) {
  for (const p of snapshot.pipelines || []) {
    db.insert('pipelines', {
      ...p, locationId,
      stages: (p.stages || []).map(s => ({ ...s, id: uuidv4() }))
    });
  }
  for (const a of snapshot.automations || []) db.insert('automations', { ...a, locationId });
  for (const f of snapshot.customFields || []) db.insert('customFields', { ...f, locationId });
  for (const s of snapshot.smartLists || []) db.insert('smartLists', { ...s, locationId });
  for (const c of snapshot.calendars || []) db.insert('calendars', { ...c, locationId });
}

function seedLocationDefaults(locationId) {
  db.insert('pipelines', {
    locationId,
    name: 'Sales Pipeline',
    stages: [
      { id: uuidv4(), name: 'New Lead' },
      { id: uuidv4(), name: 'Contacted' },
      { id: uuidv4(), name: 'Qualified' },
      { id: uuidv4(), name: 'Proposal Sent' },
      { id: uuidv4(), name: 'Negotiation' },
      { id: uuidv4(), name: 'Closed' }
    ]
  });
  db.insert('calendars', { locationId, name: 'Main Calendar', slotMinutes: 30 });
}

// Users
router.get('/agency/users', auth.requireAgencyAdmin, (req, res) => {
  res.json(db.all('users').map(auth.publicUser));
});

router.post('/agency/users', auth.requireAgencyAdmin, (req, res) => {
  const { name, email, password, role, locationIds } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
  if (db.findOne('users', u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'email already exists' });
  }
  const user = db.insert('users', {
    name, email,
    passwordHash: auth.hashPassword(password),
    role: ['agency_admin', 'account_admin', 'user'].includes(role) ? role : 'user',
    locationIds: locationIds || []
  });
  res.status(201).json(auth.publicUser(user));
});

router.patch('/agency/users/:id', auth.requireAgencyAdmin, (req, res) => {
  const { name, role, locationIds, disabled, password } = req.body || {};
  const patch = prune({ name, role, locationIds, disabled });
  if (password) patch.passwordHash = auth.hashPassword(password);
  const user = db.update('users', req.params.id, patch);
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json(auth.publicUser(user));
});

// ---------------------------------------------------------------------------
// Everything below is scoped to a sub-account via X-Location-Id
// ---------------------------------------------------------------------------

router.use(auth.requireLocation);

const loc = req => req.location.id;

// --- Contacts ---------------------------------------------------------------

router.get('/contacts', (req, res) => {
  let rows = db.find('contacts', { locationId: loc(req) });
  const { q, tag, smartListId, sort } = req.query;

  if (smartListId) {
    const sl = db.get('smartLists', smartListId);
    if (sl) rows = rows.filter(c => smartListMatches(sl, c));
  }
  if (tag) rows = rows.filter(c => (c.tags || []).includes(tag));
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(c =>
      `${c.firstName} ${c.lastName} ${c.email} ${c.phone} ${c.company}`.toLowerCase().includes(needle));
  }
  rows.sort(sort === 'score'
    ? (a, b) => (b.leadScore || 0) - (a.leadScore || 0)
    : (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(200, parseInt(req.query.limit || '50', 10));
  const users = new Map(db.all('users').map(u => [u.id, u.name]));
  res.json({
    total: rows.length,
    page,
    contacts: rows.slice((page - 1) * limit, page * limit)
      .map(c => ({ ...c, ownerName: c.ownerId ? users.get(c.ownerId) || null : null }))
  });
});

function smartListMatches(sl, contact) {
  const f = sl.filters || {};
  if (f.tag && !(contact.tags || []).includes(f.tag)) return false;
  if (f.minScore != null && (contact.leadScore || 0) < f.minScore) return false;
  if (f.source && contact.source !== f.source) return false;
  if (f.dnd != null && !!contact.dnd !== !!f.dnd) return false;
  return true;
}

router.post('/contacts', (req, res) => {
  const contact = createContact(loc(req), req.body || {}, req.user.id);
  if (contact.error) return res.status(400).json(contact);
  res.status(201).json(contact);
});

function createContact(locationId, body, userId) {
  const { firstName, lastName, email, phone, company, tags, source, customFields, dnd } = body;
  if (!firstName && !lastName && !email && !phone) return { error: 'at least a name, email or phone is required' };
  const contact = db.insert('contacts', {
    locationId,
    firstName: firstName || '', lastName: lastName || '',
    email: email || '', phone: phone || '', company: company || '',
    tags: tags || [], source: source || 'manual',
    customFields: customFields || {}, dnd: !!dnd, leadScore: 0
  });
  engine.fireEvent(locationId, 'contact.created', {
    contact, userId, summary: `Contact created (${contact.source})`
  });
  return contact;
}

router.get('/contacts/:id', (req, res) => {
  const contact = scoped(req, 'contacts');
  if (!contact) return res.status(404).json({ error: 'not found' });
  const activities = db.find('activities', { contactId: contact.id })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  res.json({
    contact,
    activities,
    opportunities: db.find('opportunities', { contactId: contact.id }),
    tasks: db.find('tasks', { contactId: contact.id }),
    appointments: db.find('appointments', { contactId: contact.id }),
    conversation: db.findOne('conversations', { locationId: loc(req), contactId: contact.id })
  });
});

router.patch('/contacts/:id', (req, res) => {
  const contact = scoped(req, 'contacts');
  if (!contact) return res.status(404).json({ error: 'not found' });
  const { firstName, lastName, email, phone, company, source, customFields, dnd } = req.body || {};
  res.json(db.update('contacts', contact.id, prune({ firstName, lastName, email, phone, company, source, customFields, dnd })));
});

router.delete('/contacts/:id', (req, res) => {
  const contact = scoped(req, 'contacts');
  if (!contact) return res.status(404).json({ error: 'not found' });
  db.remove('contacts', contact.id);
  db.removeWhere('opportunities', { contactId: contact.id });
  db.removeWhere('tasks', { contactId: contact.id });
  db.removeWhere('activities', { contactId: contact.id });
  res.json({ ok: true });
});

router.post('/contacts/:id/tags', (req, res) => {
  const contact = scoped(req, 'contacts');
  if (!contact) return res.status(404).json({ error: 'not found' });
  const tag = String((req.body || {}).tag || '').trim();
  if (!tag) return res.status(400).json({ error: 'tag required' });
  if (!(contact.tags || []).includes(tag)) {
    db.update('contacts', contact.id, { tags: [...(contact.tags || []), tag] });
    engine.fireEvent(loc(req), 'contact.tag_added', { contact, tag, summary: `Tag added: ${tag}` });
  }
  res.json(db.get('contacts', contact.id));
});

router.delete('/contacts/:id/tags/:tag', (req, res) => {
  const contact = scoped(req, 'contacts');
  if (!contact) return res.status(404).json({ error: 'not found' });
  db.update('contacts', contact.id, { tags: (contact.tags || []).filter(t => t !== req.params.tag) });
  res.json(db.get('contacts', contact.id));
});

// Claim a lead — assigns it to the calling user and fires contact.claimed,
// which is the trigger to hang "send personalized intro email" and
// "enroll in nurture sequence" automations on.
router.post('/contacts/:id/claim', (req, res) => {
  const contact = scoped(req, 'contacts');
  if (!contact) return res.status(404).json({ error: 'not found' });
  if (contact.ownerId && contact.ownerId !== req.user.id && !(req.body || {}).force) {
    const owner = db.get('users', contact.ownerId);
    return res.status(409).json({ error: `already claimed by ${owner ? owner.name : 'another user'}` });
  }
  const updated = db.update('contacts', contact.id, { ownerId: req.user.id, claimedAt: new Date().toISOString() });
  engine.fireEvent(loc(req), 'contact.claimed', {
    contact: updated, userId: req.user.id,
    summary: `Lead claimed by ${req.user.name}`
  });
  res.json(updated);
});

router.post('/contacts/:id/unclaim', (req, res) => {
  const contact = scoped(req, 'contacts');
  if (!contact) return res.status(404).json({ error: 'not found' });
  res.json(db.update('contacts', contact.id, { ownerId: null, claimedAt: null }));
});

// CSV import: header row with firstName,lastName,email,phone,company,tags
router.post('/contacts/import', (req, res) => {
  const csv = String((req.body || {}).csv || '');
  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return res.status(400).json({ error: 'csv with a header row and at least one data row required' });
  const headers = lines[0].split(',').map(h => h.trim());
  let imported = 0, skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map(c => c.trim());
    const row = Object.fromEntries(headers.map((h, i) => [h, cells[i] || '']));
    const result = createContact(loc(req), {
      firstName: row.firstName, lastName: row.lastName, email: row.email,
      phone: row.phone, company: row.company,
      tags: row.tags ? row.tags.split(';').map(t => t.trim()).filter(Boolean) : [],
      source: 'import'
    }, req.user.id);
    result.error ? skipped++ : imported++;
  }
  res.json({ imported, skipped });
});

router.get('/tags', (req, res) => {
  const counts = {};
  for (const c of db.find('contacts', { locationId: loc(req) })) {
    for (const t of c.tags || []) counts[t] = (counts[t] || 0) + 1;
  }
  res.json(Object.entries(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count));
});

// --- Custom fields & smart lists ---------------------------------------------

router.get('/custom-fields', (req, res) => res.json(db.find('customFields', { locationId: loc(req) })));
router.post('/custom-fields', (req, res) => {
  const { name, key, type } = req.body || {};
  if (!name || !key) return res.status(400).json({ error: 'name and key required' });
  res.status(201).json(db.insert('customFields', { locationId: loc(req), name, key, type: type || 'text' }));
});
router.delete('/custom-fields/:id', (req, res) => {
  const row = scoped(req, 'customFields');
  if (!row) return res.status(404).json({ error: 'not found' });
  db.remove('customFields', row.id);
  res.json({ ok: true });
});

router.get('/smart-lists', (req, res) => res.json(db.find('smartLists', { locationId: loc(req) })));
router.post('/smart-lists', (req, res) => {
  const { name, filters } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  res.status(201).json(db.insert('smartLists', { locationId: loc(req), name, filters: filters || {} }));
});
router.delete('/smart-lists/:id', (req, res) => {
  const row = scoped(req, 'smartLists');
  if (!row) return res.status(404).json({ error: 'not found' });
  db.remove('smartLists', row.id);
  res.json({ ok: true });
});

// --- Pipelines & opportunities ------------------------------------------------

router.get('/pipelines', (req, res) => res.json(db.find('pipelines', { locationId: loc(req) })));

router.post('/pipelines', (req, res) => {
  const { name, stages } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  res.status(201).json(db.insert('pipelines', {
    locationId: loc(req), name,
    stages: (stages || ['New Lead', 'Contacted', 'Qualified', 'Closed']).map(s =>
      typeof s === 'string' ? { id: uuidv4(), name: s } : { id: s.id || uuidv4(), name: s.name })
  }));
});

router.patch('/pipelines/:id', (req, res) => {
  const pipeline = scoped(req, 'pipelines');
  if (!pipeline) return res.status(404).json({ error: 'not found' });
  const { name, stages } = req.body || {};
  const patch = prune({ name });
  if (stages) patch.stages = stages.map(s => ({ id: s.id || uuidv4(), name: s.name }));
  res.json(db.update('pipelines', pipeline.id, patch));
});

router.delete('/pipelines/:id', (req, res) => {
  const pipeline = scoped(req, 'pipelines');
  if (!pipeline) return res.status(404).json({ error: 'not found' });
  db.remove('pipelines', pipeline.id);
  db.removeWhere('opportunities', { pipelineId: pipeline.id });
  res.json({ ok: true });
});

router.get('/opportunities', (req, res) => {
  let rows = db.find('opportunities', { locationId: loc(req) });
  if (req.query.pipelineId) rows = rows.filter(o => o.pipelineId === req.query.pipelineId);
  if (req.query.status) rows = rows.filter(o => o.status === req.query.status);
  const contacts = new Map(db.find('contacts', { locationId: loc(req) }).map(c => [c.id, c]));
  res.json(rows.map(o => ({ ...o, contact: contacts.get(o.contactId) || null })));
});

router.post('/opportunities', (req, res) => {
  const { contactId, pipelineId, stageId, name, value } = req.body || {};
  const contact = db.get('contacts', contactId);
  const pipeline = db.get('pipelines', pipelineId);
  if (!contact || contact.locationId !== loc(req)) return res.status(400).json({ error: 'unknown contact' });
  if (!pipeline || pipeline.locationId !== loc(req)) return res.status(400).json({ error: 'unknown pipeline' });
  const opp = db.insert('opportunities', {
    locationId: loc(req), contactId, pipelineId,
    stageId: stageId || pipeline.stages[0].id,
    name: name || `${contact.firstName} ${contact.lastName}`.trim() || 'New opportunity',
    value: Number(value) || 0, status: 'open', source: 'manual'
  });
  engine.fireEvent(loc(req), 'opportunity.created', {
    contact, opportunity: opp, userId: req.user.id, summary: `Opportunity created: ${opp.name}`
  });
  res.status(201).json(opp);
});

router.patch('/opportunities/:id', (req, res) => {
  const opp = scoped(req, 'opportunities');
  if (!opp) return res.status(404).json({ error: 'not found' });
  const { stageId, name, value, status } = req.body || {};
  const stageChanged = stageId && stageId !== opp.stageId;
  const statusChanged = status && status !== opp.status;
  const updated = db.update('opportunities', opp.id, prune({ stageId, name, value: value != null ? Number(value) : undefined, status }));
  const contact = db.get('contacts', opp.contactId);

  if (stageChanged && contact) {
    const pipeline = db.get('pipelines', opp.pipelineId);
    const stage = pipeline && pipeline.stages.find(s => s.id === stageId);
    engine.fireEvent(loc(req), 'opportunity.stage_changed', {
      contact, opportunity: updated, userId: req.user.id,
      summary: `Moved to ${stage ? stage.name : 'new stage'}`
    });
  }
  if (statusChanged && contact && (status === 'won' || status === 'lost')) {
    engine.fireEvent(loc(req), `opportunity.${status}`, {
      contact, opportunity: updated, userId: req.user.id,
      summary: `Opportunity ${status}: ${updated.name} ($${updated.value})`
    });
  }
  res.json(updated);
});

router.delete('/opportunities/:id', (req, res) => {
  const opp = scoped(req, 'opportunities');
  if (!opp) return res.status(404).json({ error: 'not found' });
  db.remove('opportunities', opp.id);
  res.json({ ok: true });
});

// --- Conversations -------------------------------------------------------------

router.get('/conversations', (req, res) => {
  const convos = db.find('conversations', { locationId: loc(req) })
    .sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));
  const contacts = new Map(db.find('contacts', { locationId: loc(req) }).map(c => [c.id, c]));
  res.json(convos.map(c => ({ ...c, contact: contacts.get(c.contactId) || null })));
});

router.post('/conversations', (req, res) => {
  const { contactId } = req.body || {};
  const contact = db.get('contacts', contactId);
  if (!contact || contact.locationId !== loc(req)) return res.status(400).json({ error: 'unknown contact' });
  res.status(201).json(engine.ensureConversation(loc(req), contactId));
});

router.get('/conversations/:id/messages', (req, res) => {
  const convo = scoped(req, 'conversations');
  if (!convo) return res.status(404).json({ error: 'not found' });
  db.update('conversations', convo.id, { unread: 0 });
  res.json(db.find('messages', { conversationId: convo.id })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
});

router.post('/conversations/:id/messages', (req, res) => {
  const convo = scoped(req, 'conversations');
  if (!convo) return res.status(404).json({ error: 'not found' });
  const { channel, body, subject, direction } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body required' });
  const contact = db.get('contacts', convo.contactId);
  if (contact && contact.dnd && direction !== 'inbound') {
    return res.status(422).json({ error: 'contact is on Do Not Disturb' });
  }
  const message = engine.sendMessage(loc(req), convo.contactId, {
    channel: channel || 'sms',
    direction: direction === 'inbound' ? 'inbound' : 'outbound',
    subject, body, userId: req.user.id
  });
  res.status(201).json(message);
});

// --- Tasks ----------------------------------------------------------------------

router.get('/tasks', (req, res) => {
  let rows = db.find('tasks', { locationId: loc(req) });
  if (req.query.status) rows = rows.filter(t => t.status === req.query.status);
  const contacts = new Map(db.find('contacts', { locationId: loc(req) }).map(c => [c.id, c]));
  rows.sort((a, b) => (a.dueAt || '9999').localeCompare(b.dueAt || '9999'));
  res.json(rows.map(t => ({ ...t, contact: contacts.get(t.contactId) || null })));
});

router.post('/tasks', (req, res) => {
  const { title, description, contactId, dueAt, assignedTo } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  res.status(201).json(db.insert('tasks', {
    locationId: loc(req), title, description: description || '',
    contactId: contactId || null, dueAt: dueAt || null,
    assignedTo: assignedTo || req.user.id, status: 'open', source: 'manual'
  }));
});

router.patch('/tasks/:id', (req, res) => {
  const task = scoped(req, 'tasks');
  if (!task) return res.status(404).json({ error: 'not found' });
  const { title, description, dueAt, status, assignedTo } = req.body || {};
  res.json(db.update('tasks', task.id, prune({ title, description, dueAt, status, assignedTo })));
});

router.delete('/tasks/:id', (req, res) => {
  const task = scoped(req, 'tasks');
  if (!task) return res.status(404).json({ error: 'not found' });
  db.remove('tasks', task.id);
  res.json({ ok: true });
});

// --- Calendar & appointments -------------------------------------------------------

router.get('/calendars', (req, res) => res.json(db.find('calendars', { locationId: loc(req) })));
router.post('/calendars', (req, res) => {
  const { name, slotMinutes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  res.status(201).json(db.insert('calendars', { locationId: loc(req), name, slotMinutes: slotMinutes || 30 }));
});

router.get('/appointments', (req, res) => {
  let rows = db.find('appointments', { locationId: loc(req) });
  const { from, to } = req.query;
  if (from) rows = rows.filter(a => a.startAt >= from);
  if (to) rows = rows.filter(a => a.startAt <= to);
  const contacts = new Map(db.find('contacts', { locationId: loc(req) }).map(c => [c.id, c]));
  rows.sort((a, b) => a.startAt.localeCompare(b.startAt));
  res.json(rows.map(a => ({ ...a, contact: contacts.get(a.contactId) || null })));
});

router.post('/appointments', (req, res) => {
  const { contactId, calendarId, title, startAt, endAt, notes } = req.body || {};
  const contact = db.get('contacts', contactId);
  if (!contact || contact.locationId !== loc(req)) return res.status(400).json({ error: 'unknown contact' });
  if (!startAt) return res.status(400).json({ error: 'startAt required' });
  const appt = db.insert('appointments', {
    locationId: loc(req), contactId,
    calendarId: calendarId || (db.findOne('calendars', { locationId: loc(req) }) || {}).id || null,
    title: title || 'Appointment', startAt,
    endAt: endAt || new Date(new Date(startAt).getTime() + 30 * 60000).toISOString(),
    notes: notes || '', status: 'booked'
  });
  engine.fireEvent(loc(req), 'appointment.booked', {
    contact, userId: req.user.id, summary: `Appointment booked: ${appt.title}`
  });
  res.status(201).json(appt);
});

router.patch('/appointments/:id', (req, res) => {
  const appt = scoped(req, 'appointments');
  if (!appt) return res.status(404).json({ error: 'not found' });
  const { title, startAt, endAt, notes, status } = req.body || {};
  res.json(db.update('appointments', appt.id, prune({ title, startAt, endAt, notes, status })));
});

router.delete('/appointments/:id', (req, res) => {
  const appt = scoped(req, 'appointments');
  if (!appt) return res.status(404).json({ error: 'not found' });
  db.remove('appointments', appt.id);
  res.json({ ok: true });
});

// --- Automations ----------------------------------------------------------------

router.get('/automations', (req, res) => res.json(db.find('automations', { locationId: loc(req) })));

router.post('/automations', (req, res) => {
  const { name, trigger, actions, enabled } = req.body || {};
  if (!name || !trigger || !trigger.type) return res.status(400).json({ error: 'name and trigger.type required' });
  res.status(201).json(db.insert('automations', {
    locationId: loc(req), name, trigger, actions: actions || [], enabled: enabled !== false
  }));
});

router.patch('/automations/:id', (req, res) => {
  const automation = scoped(req, 'automations');
  if (!automation) return res.status(404).json({ error: 'not found' });
  const { name, trigger, actions, enabled } = req.body || {};
  res.json(db.update('automations', automation.id, prune({ name, trigger, actions, enabled })));
});

router.delete('/automations/:id', (req, res) => {
  const automation = scoped(req, 'automations');
  if (!automation) return res.status(404).json({ error: 'not found' });
  db.remove('automations', automation.id);
  res.json({ ok: true });
});

router.get('/automation-runs', (req, res) => {
  res.json(db.find('automationRuns', { locationId: loc(req) })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100));
});

// Dry-run an automation against a contact.
router.post('/automations/:id/test', (req, res) => {
  const automation = scoped(req, 'automations');
  if (!automation) return res.status(404).json({ error: 'not found' });
  const contact = db.get('contacts', (req.body || {}).contactId) ||
    db.findOne('contacts', { locationId: loc(req) });
  if (!contact) return res.status(400).json({ error: 'no contact available to test with' });
  const results = [];
  for (const action of automation.actions || []) {
    try {
      results.push({ action: action.type, ok: true, result: engine.executeAction(loc(req), action, { contact }) });
    } catch (e) {
      results.push({ action: action.type, ok: false, error: e.message });
    }
  }
  res.json({ contactId: contact.id, results });
});

// --- API keys (for forms / phone-bridge webhooks) --------------------------------

router.get('/api-keys', (req, res) => res.json(db.find('apiKeys', { locationId: loc(req) })));
router.post('/api-keys', (req, res) => {
  res.status(201).json(db.insert('apiKeys', {
    locationId: loc(req),
    name: (req.body || {}).name || 'default',
    key: 'bsk_' + crypto.randomBytes(18).toString('hex')
  }));
});
router.delete('/api-keys/:id', (req, res) => {
  const row = scoped(req, 'apiKeys');
  if (!row) return res.status(404).json({ error: 'not found' });
  db.remove('apiKeys', row.id);
  res.json({ ok: true });
});

// --- Email sequences ---------------------------------------------------------------

const sequences = require('./lib/sequences');
const mailer = require('./lib/mailer');

router.get('/sequences', (req, res) => {
  const rows = db.find('sequences', { locationId: loc(req) });
  const enrollments = db.find('sequenceEnrollments', { locationId: loc(req) });
  res.json(rows.map(s => ({
    ...s,
    stats: {
      active: enrollments.filter(e => e.sequenceId === s.id && e.status === 'active').length,
      completed: enrollments.filter(e => e.sequenceId === s.id && e.status === 'completed').length,
      stopped: enrollments.filter(e => e.sequenceId === s.id && e.status === 'stopped').length
    }
  })));
});

router.post('/sequences', (req, res) => {
  const { name, steps, enabled } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!Array.isArray(steps) || !steps.length) return res.status(400).json({ error: 'at least one step required' });
  res.status(201).json(db.insert('sequences', {
    locationId: loc(req), name, enabled: enabled !== false,
    steps: steps.map(s => ({ delayDays: Number(s.delayDays) || 0, subject: s.subject || '', body: s.body || '' }))
  }));
});

router.patch('/sequences/:id', (req, res) => {
  const seq = scoped(req, 'sequences');
  if (!seq) return res.status(404).json({ error: 'not found' });
  const { name, steps, enabled } = req.body || {};
  const patch = prune({ name, enabled });
  if (steps) patch.steps = steps.map(s => ({ delayDays: Number(s.delayDays) || 0, subject: s.subject || '', body: s.body || '' }));
  res.json(db.update('sequences', seq.id, patch));
});

router.delete('/sequences/:id', (req, res) => {
  const seq = scoped(req, 'sequences');
  if (!seq) return res.status(404).json({ error: 'not found' });
  db.remove('sequences', seq.id);
  db.removeWhere('sequenceEnrollments', { sequenceId: seq.id });
  res.json({ ok: true });
});

router.post('/sequences/:id/enroll', (req, res) => {
  const seq = scoped(req, 'sequences');
  if (!seq) return res.status(404).json({ error: 'not found' });
  try {
    res.status(201).json(sequences.enroll(loc(req), seq.id, (req.body || {}).contactId, 'manual'));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/sequence-enrollments', (req, res) => {
  let rows = db.find('sequenceEnrollments', { locationId: loc(req) });
  if (req.query.sequenceId) rows = rows.filter(e => e.sequenceId === req.query.sequenceId);
  const contacts = new Map(db.find('contacts', { locationId: loc(req) }).map(c => [c.id, c]));
  res.json(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200)
    .map(e => ({ ...e, contact: contacts.get(e.contactId) || null })));
});

router.post('/sequence-enrollments/:id/stop', (req, res) => {
  const enr = scoped(req, 'sequenceEnrollments');
  if (!enr) return res.status(404).json({ error: 'not found' });
  res.json(sequences.stop(enr.id, 'manual'));
});

// Email delivery status — the UI shows whether Google/SMTP is live.
router.get('/email-status', (req, res) => {
  res.json({
    configured: mailer.configured(),
    mode: mailer.configured() ? 'live' : 'simulated',
    user: mailer.configured() ? process.env.SMTP_USER : null
  });
});

// --- Power dialer -----------------------------------------------------------------
//
// A dialer session is a queue of contacts to call one by one. Each contact
// gets a disposition (answered / voicemail / no_answer / busy / callback /
// wrong_number) which logs the call into their conversation, fires
// call.completed automations, and applies the session's disposition rules
// (move pipeline stage on answer, tag on voicemail, callback task, ...).

const DISPOSITIONS = ['answered', 'voicemail', 'no_answer', 'busy', 'callback', 'wrong_number'];

router.get('/dialer/sessions', (req, res) => {
  res.json(db.find('dialerSessions', { locationId: loc(req) })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(dialerSummary));
});

function dialerSummary(s) {
  const done = s.queue.filter(q => q.disposition).length;
  return { ...s, total: s.queue.length, completedCount: done };
}

router.post('/dialer/sessions', (req, res) => {
  const { name, smartListId, tag, contactIds, pipelineId, rules } = req.body || {};
  let contacts = db.find('contacts', { locationId: loc(req) });
  if (contactIds && contactIds.length) contacts = contacts.filter(c => contactIds.includes(c.id));
  if (smartListId) {
    const sl = db.get('smartLists', smartListId);
    if (sl) contacts = contacts.filter(c => smartListMatches(sl, c));
  }
  if (tag) contacts = contacts.filter(c => (c.tags || []).includes(tag));

  const skipped = { dnd: 0, noPhone: 0 };
  const dialable = contacts.filter(c => {
    if (c.dnd) { skipped.dnd++; return false; }
    if (!c.phone) { skipped.noPhone++; return false; }
    return true;
  });
  if (!dialable.length) return res.status(400).json({ error: 'no dialable contacts (check DND / phone numbers / filters)', skipped });

  // highest lead score first — call the hottest leads before they cool off
  dialable.sort((a, b) => (b.leadScore || 0) - (a.leadScore || 0));

  const session = db.insert('dialerSessions', {
    locationId: loc(req),
    name: name || `Dial session ${new Date().toISOString().slice(0, 10)}`,
    status: 'active',                          // active | paused | completed
    pipelineId: pipelineId || null,
    rules: {
      answeredStageId: (rules && rules.answeredStageId) || null,
      voicemailTag: (rules && rules.voicemailTag) || 'voicemail-left',
      noAnswerTag: (rules && rules.noAnswerTag) || 'no-answer',
      callbackInDays: (rules && rules.callbackInDays) != null ? rules.callbackInDays : 1
    },
    queue: dialable.map(c => ({ contactId: c.id, disposition: null, notes: '', dialedAt: null, durationSeconds: 0 })),
    cursor: 0,
    createdBy: req.user.id
  });
  res.status(201).json({ ...dialerSummary(session), skipped });
});

// Current position + full context for the agent screen.
router.get('/dialer/sessions/:id', (req, res) => {
  const session = scoped(req, 'dialerSessions');
  if (!session) return res.status(404).json({ error: 'not found' });
  const entry = session.queue[session.cursor] || null;
  const contact = entry ? db.get('contacts', entry.contactId) : null;
  res.json({
    session: dialerSummary(session),
    entry,
    contact,
    contactActivities: contact
      ? db.find('activities', { contactId: contact.id }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10)
      : [],
    contactOpportunities: contact ? db.find('opportunities', { contactId: contact.id }) : []
  });
});

router.patch('/dialer/sessions/:id', (req, res) => {
  const session = scoped(req, 'dialerSessions');
  if (!session) return res.status(404).json({ error: 'not found' });
  const { status } = req.body || {};
  if (!['active', 'paused', 'completed'].includes(status)) return res.status(400).json({ error: 'bad status' });
  res.json(dialerSummary(db.update('dialerSessions', session.id, { status })));
});

router.delete('/dialer/sessions/:id', (req, res) => {
  const session = scoped(req, 'dialerSessions');
  if (!session) return res.status(404).json({ error: 'not found' });
  db.remove('dialerSessions', session.id);
  res.json({ ok: true });
});

// Start the call for the contact at the cursor. Places a real outbound call
// through Telnyx Call Control when TELNYX_API_KEY + TELNYX_CONNECTION_ID +
// TELNYX_PHONE_NUMBER are configured; otherwise records a simulated dial so
// the workflow is fully usable without telephony credentials.
router.post('/dialer/sessions/:id/dial', async (req, res) => {
  const session = scoped(req, 'dialerSessions');
  if (!session) return res.status(404).json({ error: 'not found' });
  const entry = session.queue[session.cursor];
  if (!entry) return res.status(400).json({ error: 'queue finished' });
  const contact = db.get('contacts', entry.contactId);
  if (!contact) return res.status(400).json({ error: 'contact no longer exists' });

  entry.dialedAt = new Date().toISOString();
  let mode = 'simulated';
  const { TELNYX_API_KEY, TELNYX_CONNECTION_ID, TELNYX_PHONE_NUMBER } = process.env;
  if (TELNYX_API_KEY && TELNYX_CONNECTION_ID && TELNYX_PHONE_NUMBER) {
    try {
      const axios = require('axios');
      await axios.post('https://api.telnyx.com/v2/calls', {
        connection_id: TELNYX_CONNECTION_ID,
        to: contact.phone,
        from: TELNYX_PHONE_NUMBER
      }, { headers: { Authorization: `Bearer ${TELNYX_API_KEY}` }, timeout: 8000 });
      mode = 'telnyx';
    } catch (e) {
      mode = 'simulated';
      console.error('[dialer] telnyx dial failed, falling back to simulated:', e.message);
    }
  }
  db.update('dialerSessions', session.id, { queue: session.queue });
  res.json({ ok: true, mode, telUri: 'tel:' + String(contact.phone).replace(/[^\d+]/g, '') });
});

// Record the outcome, apply disposition rules, advance the cursor.
router.post('/dialer/sessions/:id/disposition', (req, res) => {
  const session = scoped(req, 'dialerSessions');
  if (!session) return res.status(404).json({ error: 'not found' });
  const entry = session.queue[session.cursor];
  if (!entry) return res.status(400).json({ error: 'queue finished' });
  const { result, notes, durationSeconds, skip } = req.body || {};

  if (!skip) {
    if (!DISPOSITIONS.includes(result)) return res.status(400).json({ error: `result must be one of ${DISPOSITIONS.join(', ')}` });
    const contact = db.get('contacts', entry.contactId);
    entry.disposition = result;
    entry.notes = notes || '';
    entry.durationSeconds = Number(durationSeconds) || 0;

    if (contact) {
      const summary = `outbound call · ${entry.durationSeconds}s · ${result.replace('_', ' ')}`;
      engine.sendMessage(loc(req), contact.id, {
        channel: 'call', direction: 'outbound',
        body: notes ? `${summary}\n${notes}` : summary,
        meta: { disposition: result, durationSeconds: entry.durationSeconds, dialerSessionId: session.id },
        source: 'power-dialer', userId: req.user.id
      });
      engine.fireEvent(loc(req), 'call.completed', {
        contact, userId: req.user.id, summary,
        data: { disposition: result, durationSeconds: entry.durationSeconds }
      });
      applyDispositionRules(loc(req), session, contact, result, req.user.id);
    }
  } else {
    entry.disposition = 'skipped';
  }

  session.cursor += 1;
  const finished = session.cursor >= session.queue.length;
  db.update('dialerSessions', session.id, {
    queue: session.queue, cursor: session.cursor,
    status: finished ? 'completed' : session.status
  });
  res.json({ ...dialerSummary(db.get('dialerSessions', session.id)), finished });
});

function applyDispositionRules(locationId, session, contact, result, userId) {
  const rules = session.rules || {};
  const addTag = tag => {
    if (!tag) return;
    const fresh = db.get('contacts', contact.id);
    if (!(fresh.tags || []).includes(tag)) db.update('contacts', fresh.id, { tags: [...(fresh.tags || []), tag] });
  };

  if (result === 'answered' && rules.answeredStageId && session.pipelineId) {
    const opp = db.findOne('opportunities', o =>
      o.contactId === contact.id && o.pipelineId === session.pipelineId && o.status === 'open');
    if (opp && opp.stageId !== rules.answeredStageId) {
      db.update('opportunities', opp.id, { stageId: rules.answeredStageId });
      const pipeline = db.get('pipelines', session.pipelineId);
      const stage = pipeline && pipeline.stages.find(s => s.id === rules.answeredStageId);
      engine.fireEvent(locationId, 'opportunity.stage_changed', {
        contact, opportunity: db.get('opportunities', opp.id), userId,
        summary: `Dialer: moved to ${stage ? stage.name : 'stage'} after answered call`
      });
    }
  }
  if (result === 'voicemail') addTag(rules.voicemailTag);
  if (result === 'no_answer' || result === 'busy') addTag(rules.noAnswerTag);
  if (result === 'wrong_number') db.update('contacts', contact.id, { dnd: true });
  if (result === 'callback') {
    db.insert('tasks', {
      locationId, contactId: contact.id,
      title: `Callback: ${contact.firstName} ${contact.lastName}`.trim(),
      description: 'Requested during power-dialer session',
      dueAt: new Date(Date.now() + (rules.callbackInDays != null ? rules.callbackInDays : 1) * 86400000).toISOString(),
      assignedTo: userId, status: 'open', source: 'power-dialer'
    });
  }
}

// --- Dashboard --------------------------------------------------------------------

router.get('/dashboard', (req, res) => {
  const locationId = loc(req);
  const days = Math.min(90, parseInt(req.query.days || '30', 10));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const contacts = db.find('contacts', { locationId });
  const opps = db.find('opportunities', { locationId });
  const open = opps.filter(o => o.status === 'open');
  const won = opps.filter(o => o.status === 'won');
  const activities = db.find('activities', a => a.locationId === locationId && a.createdAt >= since);
  const tasks = db.find('tasks', { locationId });

  // daily series for leads + conversations
  const series = {};
  for (let i = days - 1; i >= 0; i--) {
    series[new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)] = { leads: 0, messages: 0, calls: 0 };
  }
  for (const a of activities) {
    const day = a.createdAt.slice(0, 10);
    if (!series[day]) continue;
    if (a.type === 'contact.created') series[day].leads++;
    if (a.type === 'message.inbound' || a.type === 'message.outbound') series[day].messages++;
    if (a.type === 'call.completed') series[day].calls++;
  }

  // funnel by pipeline stage (first pipeline)
  const pipeline = db.findOne('pipelines', { locationId });
  const funnel = pipeline ? pipeline.stages.map(s => ({
    stage: s.name,
    count: open.filter(o => o.pipelineId === pipeline.id && o.stageId === s.id).length,
    value: open.filter(o => o.pipelineId === pipeline.id && o.stageId === s.id)
      .reduce((sum, o) => sum + (o.value || 0), 0)
  })) : [];

  res.json({
    kpis: {
      contacts: contacts.length,
      newLeads: activities.filter(a => a.type === 'contact.created').length,
      openOpportunities: open.length,
      pipelineValue: open.reduce((s, o) => s + (o.value || 0), 0),
      wonValue: won.reduce((s, o) => s + (o.value || 0), 0),
      winRate: opps.filter(o => o.status !== 'open').length
        ? Math.round(100 * won.length / opps.filter(o => o.status !== 'open').length) : 0,
      openTasks: tasks.filter(t => t.status === 'open').length,
      callsCompleted: activities.filter(a => a.type === 'call.completed').length
    },
    series: Object.entries(series).map(([date, v]) => ({ date, ...v })),
    funnel,
    pipelineName: pipeline ? pipeline.name : null,
    recentActivities: db.find('activities', { locationId })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12)
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// fetch a row by :id and verify it belongs to the active location
function scoped(req, collection) {
  const row = db.get(collection, req.params.id);
  return row && row.locationId === req.location.id ? row : null;
}

function prune(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

module.exports = { router, createContact };
