// BlackSync CRM — event bus, activity timeline, lead scoring and the
// workflow automation engine (GHL-style triggers → actions).

const db = require('./db');
const mailer = require('./mailer');

// ---------------------------------------------------------------------------
// Activity timeline
// ---------------------------------------------------------------------------

function logActivity(locationId, entry) {
  return db.insert('activities', {
    locationId,
    type: entry.type,               // e.g. contact.created, call.completed
    contactId: entry.contactId || null,
    opportunityId: entry.opportunityId || null,
    userId: entry.userId || null,
    summary: entry.summary || '',
    data: entry.data || {}
  });
}

// ---------------------------------------------------------------------------
// Lead scoring — recomputed from the contact's footprint each time it changes.
// ---------------------------------------------------------------------------

const SCORE_RULES = [
  { type: 'call.completed', points: 15 },
  { type: 'message.inbound', points: 10 },
  { type: 'message.outbound', points: 2 },
  { type: 'appointment.booked', points: 20 },
  { type: 'form.submitted', points: 12 },
  { type: 'opportunity.won', points: 30 }
];

function recomputeLeadScore(contactId) {
  const contact = db.get('contacts', contactId);
  if (!contact) return;
  const acts = db.find('activities', { contactId });
  let score = 0;
  for (const a of acts) {
    const rule = SCORE_RULES.find(r => r.type === a.type);
    if (rule) score += rule.points;
  }
  score = Math.min(100, score);
  if (contact.leadScore !== score) db.update('contacts', contactId, { leadScore: score });
}

// ---------------------------------------------------------------------------
// Automation engine
//
// automation = {
//   id, locationId, name, enabled,
//   trigger: { type, ...filters }         e.g. { type: 'contact.created' }
//   actions: [{ type, ...params }]        executed in order
// }
//
// Trigger types:  contact.created | contact.tag_added | form.submitted |
//                 opportunity.stage_changed | call.completed | message.inbound |
//                 appointment.booked
// Action types:   add_tag | remove_tag | send_sms | send_email | create_task |
//                 create_opportunity | move_opportunity | notify_webhook | add_note
// ---------------------------------------------------------------------------

function fireEvent(locationId, eventType, ctx = {}) {
  // ctx: { contact, opportunity, message, extra }
  if (ctx.contact) {
    logActivity(locationId, {
      type: eventType,
      contactId: ctx.contact.id,
      opportunityId: ctx.opportunity ? ctx.opportunity.id : null,
      userId: ctx.userId || null,
      summary: ctx.summary || eventType,
      data: ctx.data || {}
    });
    recomputeLeadScore(ctx.contact.id);
  }

  const automations = db.find('automations', a =>
    a.locationId === locationId && a.enabled && a.trigger && a.trigger.type === eventType);

  for (const automation of automations) {
    if (!triggerMatches(automation.trigger, ctx)) continue;
    runAutomation(automation, ctx);
  }
}

function triggerMatches(trigger, ctx) {
  if (trigger.tag && ctx.tag !== trigger.tag) return false;
  if (trigger.pipelineId && (!ctx.opportunity || ctx.opportunity.pipelineId !== trigger.pipelineId)) return false;
  if (trigger.stageId && (!ctx.opportunity || ctx.opportunity.stageId !== trigger.stageId)) return false;
  return true;
}

function runAutomation(automation, ctx) {
  const run = db.insert('automationRuns', {
    locationId: automation.locationId,
    automationId: automation.id,
    automationName: automation.name,
    contactId: ctx.contact ? ctx.contact.id : null,
    status: 'running',
    steps: []
  });

  for (const action of automation.actions || []) {
    try {
      const result = executeAction(automation.locationId, action, ctx);
      run.steps.push({ action: action.type, ok: true, result });
    } catch (e) {
      run.steps.push({ action: action.type, ok: false, error: e.message });
    }
  }

  db.update('automationRuns', run.id, { status: 'completed', steps: run.steps });
}

function renderTemplate(text, ctx) {
  const c = ctx.contact || {};
  return String(text || '')
    .replace(/\{\{\s*contact\.first_name\s*\}\}/gi, c.firstName || '')
    .replace(/\{\{\s*contact\.last_name\s*\}\}/gi, c.lastName || '')
    .replace(/\{\{\s*contact\.name\s*\}\}/gi, `${c.firstName || ''} ${c.lastName || ''}`.trim())
    .replace(/\{\{\s*contact\.email\s*\}\}/gi, c.email || '')
    .replace(/\{\{\s*contact\.phone\s*\}\}/gi, c.phone || '');
}

function executeAction(locationId, action, ctx) {
  const contact = ctx.contact ? db.get('contacts', ctx.contact.id) : null;

  switch (action.type) {
    case 'add_tag': {
      if (!contact) throw new Error('no contact in context');
      const tags = new Set(contact.tags || []);
      tags.add(action.tag);
      db.update('contacts', contact.id, { tags: [...tags] });
      return { tag: action.tag };
    }

    case 'remove_tag': {
      if (!contact) throw new Error('no contact in context');
      db.update('contacts', contact.id, { tags: (contact.tags || []).filter(t => t !== action.tag) });
      return { tag: action.tag };
    }

    case 'send_sms':
    case 'send_email': {
      if (!contact) throw new Error('no contact in context');
      const channel = action.type === 'send_sms' ? 'sms' : 'email';
      const body = renderTemplate(action.body, { contact });
      const message = sendMessage(locationId, contact.id, {
        channel,
        direction: 'outbound',
        subject: action.subject ? renderTemplate(action.subject, { contact }) : undefined,
        body,
        source: 'automation'
      });
      return { messageId: message.id };
    }

    case 'create_task': {
      const task = db.insert('tasks', {
        locationId,
        contactId: contact ? contact.id : null,
        title: renderTemplate(action.title || 'Follow up', { contact }),
        description: renderTemplate(action.description || '', { contact }),
        dueAt: action.dueInDays != null
          ? new Date(Date.now() + action.dueInDays * 86400000).toISOString()
          : null,
        assignedTo: action.assignedTo || null,
        status: 'open',
        source: 'automation'
      });
      return { taskId: task.id };
    }

    case 'create_opportunity': {
      if (!contact) throw new Error('no contact in context');
      const pipeline = db.get('pipelines', action.pipelineId) ||
        db.findOne('pipelines', { locationId });
      if (!pipeline) throw new Error('no pipeline available');
      const stageId = action.stageId || (pipeline.stages[0] && pipeline.stages[0].id);
      const opp = db.insert('opportunities', {
        locationId,
        contactId: contact.id,
        pipelineId: pipeline.id,
        stageId,
        name: renderTemplate(action.name || '{{contact.name}} — new opportunity', { contact }),
        value: action.value || 0,
        status: 'open',
        source: 'automation'
      });
      return { opportunityId: opp.id };
    }

    case 'move_opportunity': {
      const opp = ctx.opportunity && db.get('opportunities', ctx.opportunity.id);
      if (!opp) throw new Error('no opportunity in context');
      db.update('opportunities', opp.id, { stageId: action.stageId });
      return { opportunityId: opp.id, stageId: action.stageId };
    }

    case 'add_note': {
      if (!contact) throw new Error('no contact in context');
      logActivity(locationId, {
        type: 'note.added',
        contactId: contact.id,
        summary: renderTemplate(action.body || '', { contact })
      });
      return { ok: true };
    }

    case 'enroll_sequence': {
      if (!contact) throw new Error('no contact in context');
      const sequences = require('./sequences');   // lazy — avoids require cycle
      const enrollment = sequences.enroll(locationId, action.sequenceId, contact.id, 'automation');
      return { enrollmentId: enrollment.id };
    }

    case 'notify_webhook': {
      // Fire-and-forget outbound webhook.
      const axios = require('axios');
      axios.post(action.url, {
        event: 'automation.action',
        locationId,
        contact: contact || null,
        opportunity: ctx.opportunity || null
      }, { timeout: 5000 }).catch(() => {});
      return { url: action.url };
    }

    default:
      throw new Error(`unknown action type: ${action.type}`);
  }
}

// ---------------------------------------------------------------------------
// Unified conversations — every sms/email/call/note lands in one thread per
// contact. Outbound sends are recorded and handed to the provider layer
// (Telnyx/SMTP) when configured; without credentials they are logged as
// 'simulated' so the full flow is testable end-to-end.
// ---------------------------------------------------------------------------

function ensureConversation(locationId, contactId) {
  let convo = db.findOne('conversations', { locationId, contactId });
  if (!convo) {
    convo = db.insert('conversations', {
      locationId, contactId, lastMessageAt: null, lastPreview: '', unread: 0
    });
  }
  return convo;
}

function sendMessage(locationId, contactId, msg) {
  const convo = ensureConversation(locationId, contactId);
  const contactRow = db.get('contacts', contactId);
  const canReallyEmail = msg.channel === 'email' && msg.direction === 'outbound' &&
    mailer.configured() && contactRow && contactRow.email;
  const message = db.insert('messages', {
    locationId,
    conversationId: convo.id,
    contactId,
    channel: msg.channel,                 // sms | email | call | note | voicemail
    direction: msg.direction,             // inbound | outbound
    subject: msg.subject || null,
    body: msg.body || '',
    status: msg.direction === 'outbound' ? (canReallyEmail ? 'queued' : 'simulated') : 'received',
    meta: msg.meta || {},
    source: msg.source || 'user',
    userId: msg.userId || null
  });

  if (canReallyEmail) {
    const location = db.get('locations', locationId);
    mailer.send({
      to: contactRow.email,
      subject: msg.subject || '',
      text: msg.body || '',
      fromName: location ? location.name : undefined
    }).then(() => db.update('messages', message.id, { status: 'sent' }))
      .catch(err => {
        console.error('[mailer] send failed:', err.message);
        db.update('messages', message.id, { status: 'failed', meta: { ...message.meta, error: err.message } });
      });
  }

  // A reply from the contact stops any active email sequences — never keep
  // nurturing someone who already answered.
  if (msg.direction === 'inbound') {
    for (const enr of db.find('sequenceEnrollments', e => e.contactId === contactId && e.status === 'active')) {
      db.update('sequenceEnrollments', enr.id, { status: 'stopped', stopReason: 'replied' });
    }
  }
  db.update('conversations', convo.id, {
    lastMessageAt: message.createdAt,
    lastPreview: (msg.subject || msg.body || '').slice(0, 120),
    unread: msg.direction === 'inbound' ? (convo.unread || 0) + 1 : convo.unread || 0
  });

  const eventType = msg.direction === 'inbound' ? 'message.inbound' : 'message.outbound';
  const contact = db.get('contacts', contactId);
  if (contact) {
    logActivity(locationId, {
      type: eventType,
      contactId,
      summary: `${msg.channel} ${msg.direction}: ${(msg.body || '').slice(0, 80)}`
    });
    recomputeLeadScore(contactId);
    if (msg.direction === 'inbound' && msg.source !== 'automation') {
      // fire automations for inbound messages
      const automations = db.find('automations', a =>
        a.locationId === locationId && a.enabled && a.trigger && a.trigger.type === 'message.inbound');
      for (const automation of automations) runAutomation(automation, { contact, message });
    }
  }
  return message;
}

module.exports = { fireEvent, logActivity, recomputeLeadScore, sendMessage, ensureConversation, executeAction, renderTemplate };
