// BlackSync CRM — lightweight JSON datastore.
// Zero native dependencies so it runs anywhere the phone bridge runs.
// Collections are plain arrays of objects with `id`; writes are debounced
// to disk and flushed on process exit.

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// On Vercel (and other serverless hosts) the deploy bundle is read-only —
// only /tmp is writable, so data there lives per warm instance and reseeds
// on cold start. Mount a volume / set CRM_DATA_DIR for real persistence.
const DATA_DIR = process.env.CRM_DATA_DIR ||
  (process.env.VERCEL ? '/tmp/blacksync-crm-data' : path.join(__dirname, '..', 'data'));
const DATA_FILE = path.join(DATA_DIR, 'crm.json');

const COLLECTIONS = [
  'users', 'locations', 'contacts', 'pipelines', 'opportunities',
  'conversations', 'messages', 'tasks', 'appointments', 'calendars',
  'automations', 'automationRuns', 'activities', 'customFields',
  'smartLists', 'apiKeys', 'dialerSessions', 'sequences', 'sequenceEnrollments'
];

let state = null;
let writeTimer = null;

function blank() {
  const s = { meta: { createdAt: new Date().toISOString(), secret: uuidv4() + uuidv4() } };
  for (const c of COLLECTIONS) s[c] = [];
  return s;
}

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const c of COLLECTIONS) if (!Array.isArray(state[c])) state[c] = [];
    if (!state.meta) state.meta = { secret: uuidv4() + uuidv4() };
  } catch {
    state = blank();
  }
  return state;
}

function persistNow() {
  if (!state) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, DATA_FILE);
}

function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try { persistNow(); } catch (e) { console.error('[crm-db] persist error:', e.message); }
  }, 250);
}

process.on('exit', () => { try { if (writeTimer) { clearTimeout(writeTimer); } persistNow(); } catch {} });
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

const db = {
  get secret() { return load().meta.secret; },

  all(collection) { return load()[collection]; },

  find(collection, pred) {
    return load()[collection].filter(typeof pred === 'function' ? pred : matcher(pred));
  },

  findOne(collection, pred) {
    return load()[collection].find(typeof pred === 'function' ? pred : matcher(pred)) || null;
  },

  get(collection, id) { return load()[collection].find(r => r.id === id) || null; },

  insert(collection, record) {
    const now = new Date().toISOString();
    const row = { id: record.id || uuidv4(), createdAt: now, updatedAt: now, ...record };
    row.id = row.id || uuidv4();
    load()[collection].push(row);
    persist();
    return row;
  },

  update(collection, id, patch) {
    const row = db.get(collection, id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    persist();
    return row;
  },

  remove(collection, id) {
    const rows = load()[collection];
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) return false;
    rows.splice(idx, 1);
    persist();
    return true;
  },

  removeWhere(collection, pred) {
    const rows = load()[collection];
    const keep = rows.filter(r => !(typeof pred === 'function' ? pred(r) : matcher(pred)(r)));
    const removed = rows.length - keep.length;
    load()[collection] = keep;
    persist();
    return removed;
  },

  persistNow
};

function matcher(query) {
  const entries = Object.entries(query || {});
  return row => entries.every(([k, v]) => row[k] === v);
}

module.exports = db;
