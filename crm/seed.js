// Seeds the BlackSync agency, two sub-accounts, and 30 days of realistic
// demo data on first boot. Idempotent — runs only when the DB is empty.

const { v4: uuidv4 } = require('uuid');
const db = require('./lib/db');
const auth = require('./lib/auth');
const engine = require('./lib/engine');

function daysAgo(n, hourOffset = 0) {
  return new Date(Date.now() - n * 86400000 + hourOffset * 3600000).toISOString();
}

// insert with a backdated createdAt so dashboards have history
function insertAt(collection, record, when) {
  const row = db.insert(collection, record);
  return db.update(collection, row.id, { createdAt: when, updatedAt: when });
}

function ensureSeed() {
  if (db.all('users').length > 0) return false;

  // --- agency + sub-accounts -------------------------------------------------
  const hq = db.insert('locations', {
    name: 'BlackSync Capital — HQ', industry: 'Financial Services',
    phone: '+1 (786) 555-0140', email: 'deals@blacksync.capital',
    website: 'https://blacksync.capital', agencyId: 'blacksync',
    settings: { timezone: 'America/New_York' }
  });
  const realty = db.insert('locations', {
    name: 'BlackSync Realty', industry: 'Real Estate',
    phone: '+1 (786) 555-0177', email: 'listings@blacksyncrealty.com',
    website: 'https://blacksyncrealty.com', agencyId: 'blacksync',
    settings: { timezone: 'America/New_York' }
  });

  // --- users -------------------------------------------------------------------
  db.insert('users', {
    name: 'BlackSync Admin', email: 'admin@blacksync.capital',
    passwordHash: auth.hashPassword('blacksync123'),
    role: 'agency_admin', locationIds: []
  });
  db.insert('users', {
    name: 'Maya Torres', email: 'maya@blacksync.capital',
    passwordHash: auth.hashPassword('blacksync123'),
    role: 'account_admin', locationIds: [hq.id]
  });
  db.insert('users', {
    name: 'Devon Clarke', email: 'devon@blacksyncrealty.com',
    passwordHash: auth.hashPassword('blacksync123'),
    role: 'user', locationIds: [realty.id]
  });

  // --- pipelines ------------------------------------------------------------------
  const stages = names => names.map(name => ({ id: uuidv4(), name }));
  const hqPipeline = db.insert('pipelines', {
    locationId: hq.id, name: 'Funding Pipeline',
    stages: stages(['New Lead', 'Application Sent', 'Docs Received', 'Underwriting', 'Offer Out', 'Funded'])
  });
  const realtyPipeline = db.insert('pipelines', {
    locationId: realty.id, name: 'Buyer Pipeline',
    stages: stages(['New Lead', 'Contacted', 'Showing Booked', 'Offer Made', 'Under Contract', 'Closed'])
  });

  // --- calendars / custom fields / smart lists --------------------------------------
  db.insert('calendars', { locationId: hq.id, name: 'Funding Consults', slotMinutes: 30 });
  db.insert('calendars', { locationId: realty.id, name: 'Showings', slotMinutes: 60 });

  db.insert('customFields', { locationId: hq.id, name: 'Requested Amount', key: 'requested_amount', type: 'number' });
  db.insert('customFields', { locationId: hq.id, name: 'Credit Band', key: 'credit_band', type: 'text' });
  db.insert('customFields', { locationId: hq.id, name: 'Monthly Revenue', key: 'monthly_revenue', type: 'number' });
  db.insert('customFields', { locationId: realty.id, name: 'Budget', key: 'budget', type: 'number' });
  db.insert('customFields', { locationId: realty.id, name: 'Preferred Area', key: 'preferred_area', type: 'text' });

  db.insert('smartLists', { locationId: hq.id, name: 'Hot Leads (score 40+)', filters: { minScore: 40 } });
  db.insert('smartLists', { locationId: hq.id, name: 'Funding Ready', filters: { tag: 'funding-ready' } });
  db.insert('smartLists', { locationId: realty.id, name: 'Cash Buyers', filters: { tag: 'cash-buyer' } });

  // --- API keys (used by the phone bridge + website forms) ---------------------------
  db.insert('apiKeys', { locationId: hq.id, name: 'phone-bridge', key: 'bsk_demo_hq_phone_bridge' });
  db.insert('apiKeys', { locationId: realty.id, name: 'website-forms', key: 'bsk_demo_realty_forms' });

  // --- automations ---------------------------------------------------------------------
  db.insert('automations', {
    locationId: hq.id, name: 'New lead welcome + follow-up task', enabled: true,
    trigger: { type: 'contact.created' },
    actions: [
      { type: 'send_sms', body: 'Hi {{contact.first_name}}, thanks for reaching out to BlackSync Capital! A funding advisor will call you within the hour.' },
      { type: 'add_tag', tag: 'new-lead' },
      { type: 'create_task', title: 'Call {{contact.name}} — new lead', dueInDays: 0 }
    ]
  });
  db.insert('automations', {
    locationId: hq.id, name: 'Missed call text-back', enabled: true,
    trigger: { type: 'call.completed' },
    actions: [
      { type: 'add_tag', tag: 'called' }
    ]
  });
  db.insert('automations', {
    locationId: hq.id, name: 'Docs received → underwriting task', enabled: true,
    trigger: { type: 'opportunity.stage_changed', stageId: hqPipeline.stages[2].id },
    actions: [
      { type: 'create_task', title: 'Start underwriting for {{contact.name}}', dueInDays: 1 },
      { type: 'send_email', subject: 'We received your documents', body: 'Hi {{contact.first_name}}, your documents are in review. Expect an update within 48 hours. — BlackSync Capital' }
    ]
  });
  db.insert('automations', {
    locationId: realty.id, name: 'New buyer lead nurture', enabled: true,
    trigger: { type: 'contact.created' },
    actions: [
      { type: 'send_sms', body: 'Hi {{contact.first_name}}! Devon from BlackSync Realty here — what area are you looking to buy in?' },
      { type: 'add_tag', tag: 'buyer' }
    ]
  });

  // --- email sequence + claim automation ---------------------------------------------------
  const nurture = db.insert('sequences', {
    locationId: hq.id, name: 'New Lead Nurture', enabled: true,
    steps: [
      {
        delayDays: 0,
        subject: 'Your funding options at BlackSync Capital, {{contact.first_name}}',
        body: 'Hi {{contact.first_name}},\n\nThanks for your interest in funding for {{contact.name}}\'s business. I\'ve reviewed your inquiry and I\'m your dedicated advisor at BlackSync Capital.\n\nCould you reply with your last 4 months of bank statements so I can pull real numbers for you? Most clients see terms within 48 hours.\n\nTalk soon,\nBlackSync Capital'
      },
      {
        delayDays: 2,
        subject: 'Quick question, {{contact.first_name}}',
        body: 'Hi {{contact.first_name}},\n\nJust checking in — did you get a chance to gather those bank statements? If cash flow timing is the concern, we also have programs that fund in 24 hours.\n\nReply here or call us and we\'ll walk through it together.\n\nBlackSync Capital'
      },
      {
        delayDays: 5,
        subject: 'Should I close your file, {{contact.first_name}}?',
        body: 'Hi {{contact.first_name}},\n\nI don\'t want to clutter your inbox. If the timing isn\'t right, no problem — I\'ll close your file for now and you can reach back out whenever you\'re ready.\n\nIf you\'re still interested, a one-line reply keeps things moving.\n\nBlackSync Capital'
      }
    ]
  });
  db.insert('automations', {
    locationId: hq.id, name: 'Lead claimed → intro email + nurture sequence', enabled: true,
    trigger: { type: 'contact.claimed' },
    actions: [
      {
        type: 'send_email',
        subject: 'Great connecting, {{contact.first_name}} — your advisor at BlackSync',
        body: 'Hi {{contact.first_name}},\n\nI just picked up your file personally and I\'ll be your point of contact at BlackSync Capital from here on. Expect a call from me shortly.\n\nAnything you need in the meantime, just reply to this email.\n\n— Your BlackSync advisor'
      },
      { type: 'enroll_sequence', sequenceId: nurture.id },
      { type: 'add_tag', tag: 'claimed' },
      { type: 'create_task', title: 'First call with {{contact.name}} (claimed lead)', dueInDays: 0 }
    ]
  });

  // --- contacts + history (HQ) -------------------------------------------------------------
  const hqContacts = [
    ['Marcus', 'Reid', 'marcus.reid@gmail.com', '+13055550111', 'Reid Logistics LLC', ['funding-ready', 'called'], 'form', { requested_amount: 150000, credit_band: '680-720', monthly_revenue: 42000 }],
    ['Alicia', 'Nguyen', 'alicia@nguyenbuilds.com', '+13055550122', 'Nguyen Construction', ['new-lead'], 'phone', { requested_amount: 250000, credit_band: '720+', monthly_revenue: 88000 }],
    ['Jerome', 'Baptiste', 'jerome.b@outlook.com', '+17865550133', 'JB Trucking', ['funding-ready'], 'form', { requested_amount: 80000, credit_band: '640-680', monthly_revenue: 31000 }],
    ['Sandra', 'Okafor', 'sandra@okaforretail.com', '+13055550144', 'Okafor Retail Group', ['new-lead', 'called'], 'referral', { requested_amount: 320000, credit_band: '720+', monthly_revenue: 120000 }],
    ['Luis', 'Herrera', 'lherrera@herreraauto.com', '+17865550155', 'Herrera Auto Repair', [], 'form', { requested_amount: 60000, credit_band: '600-640', monthly_revenue: 22000 }],
    ['Tanya', 'Whitfield', 'tanya.whitfield@yahoo.com', '+13055550166', 'Whitfield Catering', ['new-lead'], 'phone', { requested_amount: 45000, credit_band: '680-720', monthly_revenue: 18000 }],
    ['Omar', 'Suleiman', 'omar@sulemanmedspa.com', '+17865550177', 'Suleiman MedSpa', ['funding-ready', 'vip'], 'referral', { requested_amount: 500000, credit_band: '720+', monthly_revenue: 210000 }],
    ['Keisha', 'Daniels', 'keisha.d@gmail.com', '+13055550188', 'Daniels Daycare', [], 'form', { requested_amount: 95000, credit_band: '640-680', monthly_revenue: 27000 }]
  ];

  const hqRows = hqContacts.map(([firstName, lastName, email, phone, company, tags, source, customFields], i) => {
    const created = daysAgo(28 - i * 3, i);
    const c = insertAt('contacts', {
      locationId: hq.id, firstName, lastName, email, phone, company,
      tags, source, customFields, dnd: false, leadScore: 0
    }, created);
    insertAt('activities', {
      locationId: hq.id, type: 'contact.created', contactId: c.id,
      summary: `Contact created (${source})`, data: {}
    }, created);
    return c;
  });

  // opportunities across the funnel
  const oppSpec = [
    [0, 1, 150000, 'open'], [1, 3, 250000, 'open'], [2, 2, 80000, 'open'],
    [3, 4, 320000, 'open'], [4, 0, 60000, 'open'], [5, 0, 45000, 'open'],
    [6, 5, 500000, 'won'], [7, 1, 95000, 'lost']
  ];
  for (const [ci, stageIdx, value, status] of oppSpec) {
    const contact = hqRows[ci];
    const when = daysAgo(20 - ci * 2);
    const opp = insertAt('opportunities', {
      locationId: hq.id, contactId: contact.id, pipelineId: hqPipeline.id,
      stageId: hqPipeline.stages[stageIdx].id,
      name: `${contact.company} — funding`, value, status, source: 'manual'
    }, when);
    if (status === 'won') {
      insertAt('activities', {
        locationId: hq.id, type: 'opportunity.won', contactId: contact.id,
        opportunityId: opp.id, summary: `Opportunity won: ${opp.name} ($${value})`, data: {}
      }, daysAgo(2));
    }
  }

  // conversations, calls, appointments, tasks
  hqRows.forEach((contact, i) => {
    const convo = engine.ensureConversation(hq.id, contact.id);
    const msgs = [
      ['sms', 'outbound', `Hi ${contact.firstName}, thanks for reaching out to BlackSync Capital! A funding advisor will call you shortly.`, 26 - i * 3],
      ['sms', 'inbound', 'Sounds good, what documents do you need from me?', 26 - i * 3],
      ['sms', 'outbound', 'Last 4 months of bank statements and a voided check to start. You can reply with photos here.', 25 - i * 3]
    ];
    if (i % 2 === 0) {
      msgs.push(['call', 'inbound', `inbound call · ${120 + i * 40}s · completed`, 20 - i * 2]);
    }
    let last = null;
    for (const [channel, direction, body, when] of msgs) {
      last = insertAt('messages', {
        locationId: hq.id, conversationId: convo.id, contactId: contact.id,
        channel, direction, subject: null, body,
        status: direction === 'outbound' ? 'simulated' : 'received',
        meta: {}, source: 'seed', userId: null
      }, daysAgo(Math.max(0, when)));
      insertAt('activities', {
        locationId: hq.id,
        type: channel === 'call' ? 'call.completed' : `message.${direction}`,
        contactId: contact.id, summary: `${channel} ${direction}: ${body.slice(0, 60)}`, data: {}
      }, daysAgo(Math.max(0, when)));
    }
    db.update('conversations', convo.id, {
      lastMessageAt: last.createdAt, lastPreview: last.body.slice(0, 120), unread: i % 3 === 0 ? 1 : 0
    });
    engine.recomputeLeadScore(contact.id);
  });

  const soon = h => new Date(Date.now() + h * 3600000).toISOString();
  db.insert('appointments', {
    locationId: hq.id, contactId: hqRows[0].id, calendarId: db.findOne('calendars', { locationId: hq.id }).id,
    title: 'Funding consult — Marcus Reid', startAt: soon(4), endAt: soon(4.5), notes: 'Wants $150k working capital', status: 'booked'
  });
  db.insert('appointments', {
    locationId: hq.id, contactId: hqRows[3].id, calendarId: db.findOne('calendars', { locationId: hq.id }).id,
    title: 'Docs review — Sandra Okafor', startAt: soon(28), endAt: soon(28.5), notes: '', status: 'booked'
  });

  db.insert('tasks', { locationId: hq.id, contactId: hqRows[2].id, title: 'Chase bank statements from Jerome', description: 'Missing March statement', dueAt: soon(6), assignedTo: null, status: 'open', source: 'manual' });
  db.insert('tasks', { locationId: hq.id, contactId: hqRows[1].id, title: 'Send Alicia the term sheet', description: '', dueAt: soon(24), assignedTo: null, status: 'open', source: 'manual' });
  db.insert('tasks', { locationId: hq.id, contactId: hqRows[6].id, title: 'Post-funding check-in with Omar', description: '', dueAt: soon(72), assignedTo: null, status: 'open', source: 'manual' });

  // --- contacts (Realty) — lighter seed ----------------------------------------------------
  const realtyContacts = [
    ['Brianna', 'Cole', 'brianna.cole@gmail.com', '+13055550201', '', ['buyer', 'cash-buyer'], 'form', { budget: 450000, preferred_area: 'Little River' }],
    ['Andre', 'Philips', 'andre.philips@gmail.com', '+17865550202', '', ['buyer'], 'form', { budget: 320000, preferred_area: 'North Miami' }],
    ['Chloe', 'Baptiste', 'chloe.b@gmail.com', '+13055550203', '', ['buyer'], 'referral', { budget: 600000, preferred_area: 'Wynwood' }]
  ];
  realtyContacts.forEach(([firstName, lastName, email, phone, company, tags, source, customFields], i) => {
    const created = daysAgo(12 - i * 4);
    const c = insertAt('contacts', {
      locationId: realty.id, firstName, lastName, email, phone, company,
      tags, source, customFields, dnd: false, leadScore: 0
    }, created);
    insertAt('activities', {
      locationId: realty.id, type: 'contact.created', contactId: c.id,
      summary: `Contact created (${source})`, data: {}
    }, created);
    insertAt('opportunities', {
      locationId: realty.id, contactId: c.id, pipelineId: realtyPipeline.id,
      stageId: realtyPipeline.stages[i].id,
      name: `${firstName} ${lastName} — home purchase`, value: customFields.budget,
      status: 'open', source: 'manual'
    }, created);
  });

  db.persistNow();
  return true;
}

module.exports = { ensureSeed };
