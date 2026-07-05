// Email sequences — GHL-style timed drips.
//
// sequence   = { id, locationId, name, enabled,
//                steps: [{ delayDays, subject, body }] }   // delay from previous step
// enrollment = { id, locationId, sequenceId, contactId, stepIndex,
//                nextAt, status: active|completed|stopped, stopReason }
//
// tick() sends every due step; it runs on an interval when the CRM runs as a
// long-lived server and lazily on API traffic when serverless (Vercel).
// Replies stop an enrollment automatically (see engine.sendMessage), and DND
// or a missing email address pauses sends safely.

const db = require('./db');
const engine = require('./engine');

function enroll(locationId, sequenceId, contactId, source = 'manual') {
  const sequence = db.get('sequences', sequenceId);
  const contact = db.get('contacts', contactId);
  if (!sequence || sequence.locationId !== locationId) throw new Error('unknown sequence');
  if (!contact || contact.locationId !== locationId) throw new Error('unknown contact');
  if (!sequence.steps || !sequence.steps.length) throw new Error('sequence has no steps');

  const existing = db.findOne('sequenceEnrollments', e =>
    e.sequenceId === sequenceId && e.contactId === contactId && e.status === 'active');
  if (existing) return existing;

  const firstDelayMs = (sequence.steps[0].delayDays || 0) * 86400000;
  const enrollment = db.insert('sequenceEnrollments', {
    locationId, sequenceId, contactId,
    sequenceName: sequence.name,
    stepIndex: 0,
    nextAt: new Date(Date.now() + firstDelayMs).toISOString(),
    status: 'active',
    stopReason: null,
    source
  });
  engine.logActivity(locationId, {
    type: 'sequence.enrolled', contactId,
    summary: `Enrolled in sequence: ${sequence.name}`
  });
  // step 0 with no delay goes out immediately
  tick();
  return enrollment;
}

function stop(enrollmentId, reason = 'manual') {
  const enr = db.get('sequenceEnrollments', enrollmentId);
  if (!enr || enr.status !== 'active') return enr;
  return db.update('sequenceEnrollments', enr.id, { status: 'stopped', stopReason: reason });
}

let ticking = false;
function tick() {
  if (ticking) return;           // re-entrancy guard — enroll() calls tick()
  ticking = true;
  try {
    const now = new Date().toISOString();
    const due = db.find('sequenceEnrollments', e => e.status === 'active' && e.nextAt <= now);
    for (const enr of due) {
      const sequence = db.get('sequences', enr.sequenceId);
      const contact = db.get('contacts', enr.contactId);
      if (!sequence || !sequence.enabled || !contact) {
        db.update('sequenceEnrollments', enr.id, { status: 'stopped', stopReason: 'sequence or contact removed/disabled' });
        continue;
      }
      if (contact.dnd) {
        db.update('sequenceEnrollments', enr.id, { status: 'stopped', stopReason: 'contact is DND' });
        continue;
      }
      const step = sequence.steps[enr.stepIndex];
      if (!step) {
        db.update('sequenceEnrollments', enr.id, { status: 'completed' });
        continue;
      }

      engine.sendMessage(enr.locationId, contact.id, {
        channel: 'email',
        direction: 'outbound',
        subject: engine.renderTemplate(step.subject || '', { contact }),
        body: engine.renderTemplate(step.body || '', { contact }),
        source: `sequence:${sequence.name}`,
        meta: { sequenceId: sequence.id, stepIndex: enr.stepIndex }
      });

      const nextIndex = enr.stepIndex + 1;
      if (nextIndex >= sequence.steps.length) {
        db.update('sequenceEnrollments', enr.id, { stepIndex: nextIndex, status: 'completed' });
      } else {
        db.update('sequenceEnrollments', enr.id, {
          stepIndex: nextIndex,
          nextAt: new Date(Date.now() + (sequence.steps[nextIndex].delayDays || 0) * 86400000).toISOString()
        });
      }
    }
  } finally {
    ticking = false;
  }
}

let lastLazyTick = 0;
// Cheap middleware hook: on serverless hosts there is no interval timer, so
// due steps are processed as requests come in (at most every 30s).
function lazyTick() {
  if (Date.now() - lastLazyTick < 30000) return;
  lastLazyTick = Date.now();
  try { tick(); } catch (e) { console.error('[sequences] tick error:', e.message); }
}

function startTicker() {
  const t = setInterval(() => {
    try { tick(); } catch (e) { console.error('[sequences] tick error:', e.message); }
  }, 60000);
  if (t.unref) t.unref();
}

module.exports = { enroll, stop, tick, lazyTick, startTicker };
