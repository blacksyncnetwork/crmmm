/* BlackSync CRM — single-page app (vanilla JS, no build step) */
(() => {
  'use strict';

  // ------------------------------------------------------------------ state
  const state = {
    token: localStorage.getItem('bs_token') || null,
    user: null,
    locations: [],
    locationId: localStorage.getItem('bs_location') || null,
    route: location.hash.replace('#/', '') || 'dashboard',
    convoId: null,
    theme: localStorage.getItem('bs_theme') || 'dark'
  };

  const $app = document.getElementById('app');

  // ------------------------------------------------------------------ api
  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
        ...(state.locationId ? { 'X-Location-Id': state.locationId } : {}),
        ...(opts.headers || {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (res.status === 401 && !path.startsWith('/auth/login')) { logout(); throw new Error('session expired'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function logout() {
    localStorage.removeItem('bs_token');
    localStorage.removeItem('bs_location');
    state.token = null; state.user = null;
    render();
  }

  // ------------------------------------------------------------------ utils
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = n => '$' + Number(n || 0).toLocaleString();
  const initials = c => ((c.firstName || '')[0] || '' ) + ((c.lastName || '')[0] || '') || '?';
  const fullName = c => `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || c.phone || 'Unknown';

  function timeAgo(iso) {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
    return new Date(iso).toLocaleDateString();
  }
  const fmtDT = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

  function toast(msg, err = false) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  function modal(html) {
    closeModal();
    const ov = document.createElement('div');
    ov.className = 'overlay'; ov.id = 'modal-overlay';
    ov.innerHTML = `<div class="modal">${html}</div>`;
    ov.addEventListener('mousedown', e => { if (e.target === ov) closeModal(); });
    document.body.appendChild(ov);
    return ov;
  }
  function closeModal() { const m = document.getElementById('modal-overlay'); if (m) m.remove(); }
  function closeDrawer() { const d = document.getElementById('drawer'); if (d) d.remove(); }

  const scoreClass = n => n >= 40 ? 'hot' : n >= 15 ? 'warm' : 'cold';

  // ------------------------------------------------------------------ charts
  // series colors come from CSS custom properties so they follow the theme
  function seriesDefs() {
    const css = getComputedStyle(document.body);
    return [
      { key: 'leads', label: 'New leads', hex: css.getPropertyValue('--series-1').trim() || '#3987e5' },
      { key: 'messages', label: 'Messages', hex: css.getPropertyValue('--series-2').trim() || '#199e70' },
      { key: 'calls', label: 'Calls', hex: css.getPropertyValue('--series-3').trim() || '#c98500' }
    ];
  }
  let SERIES = [];

  function lineChart(rows) {
    SERIES = seriesDefs();
    const W = 640, H = 200, P = { l: 34, r: 76, t: 10, b: 22 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const max = Math.max(2, ...rows.flatMap(r => SERIES.map(s => r[s.key] || 0)));
    const x = i => P.l + (rows.length < 2 ? iw / 2 : i * iw / (rows.length - 1));
    const y = v => P.t + ih - (v / max) * ih;
    const ticks = [0, Math.ceil(max / 2), max];

    const paths = SERIES.map(s =>
      `<path d="${rows.map((r, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r[s.key] || 0).toFixed(1)).join(' ')}"
        fill="none" stroke="${s.hex}" stroke-width="2" stroke-linejoin="round"/>`).join('');

    const grid = ticks.map(t =>
      `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/>
       <text x="${P.l - 7}" y="${y(t) + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)" class="tnum">${t}</text>`).join('');

    const xlabels = rows.length ? [0, Math.floor(rows.length / 2), rows.length - 1].map(i =>
      `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${rows[i].date.slice(5)}</text>`).join('') : '';

    // direct labels at each line's end (relief for low-contrast series in
    // light mode); nudge apart when they'd collide
    const ends = SERIES.map(s => ({ label: s.label, y: y(rows.length ? rows[rows.length - 1][s.key] || 0 : 0) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) {
      if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
    }
    const endLabels = ends.map(e =>
      `<text x="${W - P.r + 6}" y="${e.y + 3}" font-size="10" fill="var(--ink-2)">${e.label}</text>`).join('');

    const legend = SERIES.map(s =>
      `<span class="li"><span class="sw" style="background:${s.hex}"></span>${s.label}</span>`).join('');

    return `
      <div class="chart-wrap" data-chart="line">
        <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Activity over time">
          ${grid}${paths}${endLabels}
          <line class="cross" x1="0" x2="0" y1="${P.t}" y2="${P.t + ih}" stroke="var(--border-strong)" stroke-width="1" style="display:none"/>
          <rect class="hover-zone" x="${P.l}" y="${P.t}" width="${iw}" height="${ih}" fill="transparent"/>
        </svg>
        <div class="chart-tip"></div>
        <div class="legend">${legend}</div>
      </div>`;
  }

  function bindLineChart(wrap, rows) {
    const svg = wrap.querySelector('svg');
    const zone = wrap.querySelector('.hover-zone');
    const cross = wrap.querySelector('.cross');
    const tip = wrap.querySelector('.chart-tip');
    const P = { l: 34, r: 76 }, W = 640;
    zone.addEventListener('mousemove', e => {
      const rect = svg.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width * W;
      const iw = W - P.l - P.r;
      const i = Math.max(0, Math.min(rows.length - 1, Math.round((relX - P.l) / iw * (rows.length - 1))));
      const cx = P.l + (rows.length < 2 ? iw / 2 : i * iw / (rows.length - 1));
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.display = '';
      tip.style.display = 'block';
      tip.innerHTML = `<strong>${esc(rows[i].date)}</strong><br>` +
        SERIES.map(s => `<span style="color:${s.hex}">●</span> ${s.label}: <strong class="tnum">${rows[i][s.key] || 0}</strong>`).join('<br>');
      const px = cx / W * rect.width;
      tip.style.left = Math.min(rect.width - 170, Math.max(0, px + 12)) + 'px';
      tip.style.top = '8px';
    });
    zone.addEventListener('mouseleave', () => { cross.style.display = 'none'; tip.style.display = 'none'; });
  }

  // ordinal single-hue ramp (validated blue steps, dark surface band)
  const FUNNEL_RAMP = ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab'];

  function funnelChart(funnel) {
    const max = Math.max(1, ...funnel.map(f => f.count));
    return `<div class="grid" style="gap:7px">` + funnel.map((f, i) => {
      const w = f.count === 0 ? 0 : Math.max(2, f.count / max * 100);
      const color = FUNNEL_RAMP[Math.min(i, FUNNEL_RAMP.length - 1)];
      return `
        <div title="${esc(f.stage)}: ${f.count} open · ${money(f.value)}">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
            <span class="muted">${esc(f.stage)}</span>
            <span class="tnum">${f.count} · <span class="muted">${money(f.value)}</span></span>
          </div>
          <div style="background:var(--surface-2);border-radius:4px;height:14px;overflow:hidden">
            <div style="width:${w}%;height:100%;background:${color};border-radius:0 4px 4px 0"></div>
          </div>
        </div>`;
    }).join('') + `</div>`;
  }

  // ------------------------------------------------------------------ shell
  const NAV = [
    { route: 'dashboard', label: 'Dashboard', ico: '◧' },
    { route: 'contacts', label: 'Contacts', ico: '◉' },
    { route: 'conversations', label: 'Conversations', ico: '💬' },
    { route: 'pipeline', label: 'Pipeline', ico: '▤' },
    { route: 'dialer', label: 'Power Dialer', ico: '📞' },
    { route: 'calendar', label: 'Calendar', ico: '▦' },
    { route: 'tasks', label: 'Tasks', ico: '☑' },
    { route: 'automations', label: 'Automations', ico: '⚡' },
    { route: 'sequences', label: 'Sequences', ico: '✉' },
    { route: 'settings', label: 'Settings', ico: '⚙' }
  ];

  function shell(content) {
    const isAdmin = state.user.role === 'agency_admin';
    const locOptions = state.locations.map(l =>
      `<option value="${l.id}" ${l.id === state.locationId ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
    return `
    <div class="shell">
      <div class="topbar">
        <div class="brand"><div class="logo">B</div><div class="word">BLACK<em>SYNC</em> CRM</div></div>
        <div class="spacer"></div>
        <button class="btn small" id="theme-btn" title="Toggle light/dark">${state.theme === 'light' ? '🌙 Dark' : '☀ Light'}</button>
        <div class="loc-switch">
          <span class="muted small">Sub-account</span>
          <select id="loc-select">${locOptions}</select>
        </div>
        <div class="userchip">
          <div class="avatar">${esc((state.user.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2))}</div>
          <div>${esc(state.user.name)}<div class="muted small">${esc(state.user.role.replace('_', ' '))}</div></div>
          <button class="btn small" id="logout-btn">Sign out</button>
        </div>
      </div>
      <div class="sidebar">
        ${NAV.map(n => `<div class="nav-item ${state.route === n.route ? 'active' : ''}" data-route="${n.route}">
            <span class="ico">${n.ico}</span>${n.label}</div>`).join('')}
        ${isAdmin ? `<div class="nav-sep">Agency</div>
          <div class="nav-item ${state.route === 'agency' ? 'active' : ''}" data-route="agency">
            <span class="ico">◫</span>Sub-accounts</div>` : ''}
      </div>
      <div class="main" id="main">${content}</div>
    </div>`;
  }

  function bindShell() {
    document.querySelectorAll('.nav-item').forEach(el =>
      el.addEventListener('click', () => { location.hash = '#/' + el.dataset.route; }));
    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('theme-btn').addEventListener('click', () => {
      state.theme = state.theme === 'light' ? 'dark' : 'light';
      localStorage.setItem('bs_theme', state.theme);
      render();
    });
    document.getElementById('loc-select').addEventListener('change', e => {
      state.locationId = e.target.value;
      localStorage.setItem('bs_location', state.locationId);
      render();
    });
  }

  // ------------------------------------------------------------------ login
  function renderLogin() {
    $app.innerHTML = `
    <div class="login-wrap"><div class="login-card">
      <div class="brand"><div class="logo">B</div><div class="word">BLACK<em>SYNC</em> CRM</div></div>
      <h1>Welcome back</h1>
      <div class="sub">Sign in to your workspace</div>
      <div class="field"><label>Email</label><input id="li-email" type="email" autocomplete="username" value=""></div>
      <div class="field"><label>Password</label><input id="li-pass" type="password" autocomplete="current-password"></div>
      <button class="btn primary block" id="li-btn">Sign in</button>
      <div class="login-error" id="li-err"></div>
      <div class="login-hint">Demo login: <code>admin@blacksync.capital</code> / <code>blacksync123</code></div>
    </div></div>`;
    const go = async () => {
      const err = document.getElementById('li-err');
      err.textContent = '';
      try {
        const data = await api('/auth/login', {
          method: 'POST',
          body: { email: document.getElementById('li-email').value, password: document.getElementById('li-pass').value }
        });
        state.token = data.token; state.user = data.user; state.locations = data.locations;
        localStorage.setItem('bs_token', data.token);
        if (!state.locationId || !data.locations.find(l => l.id === state.locationId)) {
          state.locationId = data.locations[0] ? data.locations[0].id : null;
          localStorage.setItem('bs_location', state.locationId || '');
        }
        render();
      } catch (e) { err.textContent = e.message; }
    };
    document.getElementById('li-btn').addEventListener('click', go);
    $app.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }));
  }

  // ------------------------------------------------------------------ dashboard
  async function renderDashboard() {
    const d = await api('/dashboard?days=30');
    const k = d.kpis;
    setMain(`
      <div class="page-head"><h2>Dashboard</h2><span class="muted">last 30 days</span></div>
      <div class="grid kpis">
        ${kpi('Contacts', k.contacts)}
        ${kpi('New leads', k.newLeads)}
        ${kpi('Open opportunities', k.openOpportunities)}
        ${kpi('Pipeline value', money(k.pipelineValue))}
        ${kpi('Won revenue', money(k.wonValue))}
        ${kpi('Win rate', k.winRate + '%')}
        ${kpi('Calls (30d)', k.callsCompleted)}
        ${kpi('Open tasks', k.openTasks)}
      </div>
      <div class="grid two-col" style="margin-top:14px">
        <div class="card"><h3>Activity — leads, messages & calls per day</h3>${lineChart(d.series)}</div>
        <div class="card"><h3>${esc(d.pipelineName || 'Pipeline')} — open opportunities by stage</h3>${funnelChart(d.funnel)}</div>
      </div>
      <div class="card" style="margin-top:14px"><h3>Recent activity</h3>
        <div class="timeline">
          ${d.recentActivities.map(a => `
            <div class="tl-item ${/won|appointment|form/.test(a.type) ? 'hot' : ''}">
              <div>${esc(a.summary)}</div><div class="when">${esc(a.type)} · ${timeAgo(a.createdAt)}</div>
            </div>`).join('') || '<div class="empty">No activity yet</div>'}
        </div>
      </div>`);
    const wrap = document.querySelector('[data-chart="line"]');
    if (wrap) bindLineChart(wrap, d.series);
  }
  const kpi = (label, value) => `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div></div>`;

  // ------------------------------------------------------------------ contacts
  async function renderContacts(params = {}) {
    const [data, tags, smartLists] = await Promise.all([
      api('/contacts?limit=100'
        + (params.q ? '&q=' + encodeURIComponent(params.q) : '')
        + (params.tag ? '&tag=' + encodeURIComponent(params.tag) : '')
        + (params.smartListId ? '&smartListId=' + params.smartListId : '')
        + (params.sort ? '&sort=' + params.sort : '')),
      api('/tags'),
      api('/smart-lists')
    ]);
    setMain(`
      <div class="page-head">
        <h2>Contacts</h2><span class="muted">${data.total}</span>
        <div class="spacer"></div>
        <input class="input" id="c-search" placeholder="Search name, email, phone…" style="width:230px" value="${esc(params.q || '')}">
        <select class="input" id="c-smart" style="width:170px">
          <option value="">All contacts</option>
          ${smartLists.map(s => `<option value="${s.id}" ${params.smartListId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>
        <select class="input" id="c-tag" style="width:140px">
          <option value="">Any tag</option>
          ${tags.map(t => `<option value="${esc(t.tag)}" ${params.tag === t.tag ? 'selected' : ''}>${esc(t.tag)} (${t.count})</option>`).join('')}
        </select>
        <button class="btn" id="c-sort">${params.sort === 'score' ? '★ By score' : '↕ Recent'}</button>
        <button class="btn" id="c-import">Import CSV</button>
        <button class="btn primary" id="c-add">+ Contact</button>
      </div>
      <div class="card" style="padding:0">
        <table class="data">
          <thead><tr><th>Name</th><th>Company</th><th>Phone</th><th>Email</th><th>Tags</th><th>Owner</th><th>Score</th></tr></thead>
          <tbody>
            ${data.contacts.map(c => `
              <tr class="clickable" data-id="${c.id}">
                <td><strong>${esc(fullName(c))}</strong>${c.dnd ? ' <span class="tag">DND</span>' : ''}</td>
                <td>${esc(c.company)}</td>
                <td class="tnum">${esc(c.phone)}</td>
                <td>${esc(c.email)}</td>
                <td>${(c.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</td>
                <td>${c.ownerName
                  ? `<span class="tag gold">${esc(c.ownerName)}</span>`
                  : `<button class="btn small" data-claim="${c.id}">Claim</button>`}</td>
                <td><span class="score ${scoreClass(c.leadScore || 0)}">${c.leadScore || 0}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
        ${data.contacts.length ? '' : '<div class="empty">No contacts match</div>'}
      </div>`);

    const rerun = patch => renderContacts({ ...params, ...patch });
    let deb;
    document.getElementById('c-search').addEventListener('input', e => {
      clearTimeout(deb); deb = setTimeout(() => rerun({ q: e.target.value }), 350);
    });
    document.getElementById('c-smart').addEventListener('change', e => rerun({ smartListId: e.target.value || undefined }));
    document.getElementById('c-tag').addEventListener('change', e => rerun({ tag: e.target.value || undefined }));
    document.getElementById('c-sort').addEventListener('click', () => rerun({ sort: params.sort === 'score' ? undefined : 'score' }));
    document.getElementById('c-add').addEventListener('click', () => contactModal(() => renderContacts(params)));
    document.getElementById('c-import').addEventListener('click', () => importModal(() => renderContacts(params)));
    document.querySelectorAll('tr.clickable').forEach(tr =>
      tr.addEventListener('click', () => openContactDrawer(tr.dataset.id, () => renderContacts(params))));
    document.querySelectorAll('[data-claim]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      try {
        await api(`/contacts/${b.dataset.claim}/claim`, { method: 'POST', body: {} });
        toast('Lead claimed — intro email & sequence automations fired');
        renderContacts(params);
      } catch (err) { toast(err.message, true); }
    }));
  }

  function contactModal(onDone, existing) {
    const c = existing || {};
    modal(`
      <h3>${existing ? 'Edit contact' : 'New contact'}</h3>
      <div class="row">
        <div class="field"><label>First name</label><input id="m-first" value="${esc(c.firstName)}"></div>
        <div class="field"><label>Last name</label><input id="m-last" value="${esc(c.lastName)}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Phone</label><input id="m-phone" value="${esc(c.phone)}"></div>
        <div class="field"><label>Email</label><input id="m-email" value="${esc(c.email)}"></div>
      </div>
      <div class="field"><label>Company</label><input id="m-company" value="${esc(c.company)}"></div>
      <div class="field"><label>Source</label>
        <select id="m-source">${['manual', 'form', 'phone', 'referral', 'import'].map(s =>
          `<option ${c.source === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="modal-actions">
        <button class="btn" id="m-cancel">Cancel</button>
        <button class="btn primary" id="m-save">${existing ? 'Save' : 'Create'}</button>
      </div>`);
    document.getElementById('m-cancel').addEventListener('click', closeModal);
    document.getElementById('m-save').addEventListener('click', async () => {
      const body = {
        firstName: v('m-first'), lastName: v('m-last'), phone: v('m-phone'),
        email: v('m-email'), company: v('m-company'), source: v('m-source')
      };
      try {
        if (existing) await api('/contacts/' + existing.id, { method: 'PATCH', body });
        else await api('/contacts', { method: 'POST', body });
        closeModal(); toast(existing ? 'Contact updated' : 'Contact created — automations fired');
        onDone && onDone();
      } catch (e) { toast(e.message, true); }
    });
  }
  const v = id => document.getElementById(id).value.trim();

  function importModal(onDone) {
    modal(`
      <h3>Import contacts (CSV)</h3>
      <p class="muted small" style="margin-bottom:10px">Header row: <code>firstName,lastName,email,phone,company,tags</code> — tags separated by <code>;</code></p>
      <div class="field"><textarea id="m-csv" rows="8" placeholder="firstName,lastName,email,phone,company,tags&#10;Jane,Doe,jane@x.com,+13055550000,Acme,vip;new-lead"></textarea></div>
      <div class="modal-actions">
        <button class="btn" id="m-cancel">Cancel</button>
        <button class="btn primary" id="m-go">Import</button>
      </div>`);
    document.getElementById('m-cancel').addEventListener('click', closeModal);
    document.getElementById('m-go').addEventListener('click', async () => {
      try {
        const r = await api('/contacts/import', { method: 'POST', body: { csv: document.getElementById('m-csv').value } });
        closeModal(); toast(`Imported ${r.imported}, skipped ${r.skipped}`);
        onDone && onDone();
      } catch (e) { toast(e.message, true); }
    });
  }

  async function openContactDrawer(id, onChange) {
    closeDrawer();
    const d = await api('/contacts/' + id);
    const c = d.contact;
    const cf = Object.entries(c.customFields || {});
    const el = document.createElement('div');
    el.className = 'drawer'; el.id = 'drawer';
    el.innerHTML = `
      <div class="drawer-head">
        <div class="avatar">${esc(initials(c))}</div>
        <div style="flex:1">
          <h3>${esc(fullName(c))}</h3>
          <div class="muted small">${esc(c.company || '')} ${c.company ? '·' : ''} ${esc(c.source)} · score
            <span class="score ${scoreClass(c.leadScore || 0)}">${c.leadScore || 0}</span>
            ${c.ownerId ? '· <span class="tag gold">claimed</span>' : ''}</div>
        </div>
        <button class="btn small" id="d-close">✕</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${c.ownerId ? '' : '<button class="btn small primary" id="d-claim">Claim lead</button>'}
        <button class="btn small" id="d-edit">Edit</button>
        <button class="btn small" id="d-msg">Message</button>
        <button class="btn small" id="d-dnd">${c.dnd ? 'DND on ✓' : 'DND off'}</button>
        <button class="btn small danger" id="d-del">Delete</button>
      </div>
      <section><h4>Details</h4>
        <div class="small">${esc(c.phone) || '<span class="muted">no phone</span>'} · ${esc(c.email) || '<span class="muted">no email</span>'}</div>
        ${cf.length ? `<div class="small" style="margin-top:6px">${cf.map(([k, val]) =>
          `<span class="tag">${esc(k)}: ${esc(val)}</span>`).join('')}</div>` : ''}
      </section>
      <section><h4>Tags</h4>
        <div>${(c.tags || []).map(t =>
          `<span class="tag gold">${esc(t)} <a href="#" data-untag="${esc(t)}" style="color:inherit">✕</a></span>`).join('')}
          <span class="tag" id="d-addtag" style="cursor:pointer">+ tag</span></div>
      </section>
      <section><h4>Opportunities (${d.opportunities.length})</h4>
        ${d.opportunities.map(o => `<div class="small" style="margin-bottom:5px">
          <span class="pill ${o.status}">${o.status}</span> ${esc(o.name)} — <strong class="tnum">${money(o.value)}</strong></div>`).join('')
          || '<div class="muted small">none</div>'}
      </section>
      <section><h4>Tasks (${d.tasks.filter(t => t.status === 'open').length} open)</h4>
        ${d.tasks.slice(0, 5).map(t => `<div class="small" style="margin-bottom:4px">${t.status === 'done' ? '✓' : '○'} ${esc(t.title)}
          <span class="muted">${t.dueAt ? '· due ' + fmtDT(t.dueAt) : ''}</span></div>`).join('') || '<div class="muted small">none</div>'}
      </section>
      <section><h4>Timeline</h4>
        <div class="timeline">
          ${d.activities.slice(0, 25).map(a => `
            <div class="tl-item ${/won|appointment|form|call/.test(a.type) ? 'hot' : ''}">
              <div>${esc(a.summary)}</div><div class="when">${timeAgo(a.createdAt)}</div>
            </div>`).join('') || '<div class="muted small">no activity</div>'}
        </div>
      </section>`;
    document.body.appendChild(el);

    el.querySelector('#d-close').addEventListener('click', closeDrawer);
    const claimBtn = el.querySelector('#d-claim');
    if (claimBtn) claimBtn.addEventListener('click', async () => {
      try {
        await api(`/contacts/${id}/claim`, { method: 'POST', body: {} });
        toast('Lead claimed — intro email & sequence automations fired');
        openContactDrawer(id, onChange); onChange && onChange();
      } catch (e) { toast(e.message, true); }
    });
    el.querySelector('#d-edit').addEventListener('click', () => contactModal(() => { openContactDrawer(id, onChange); onChange && onChange(); }, c));
    el.querySelector('#d-msg').addEventListener('click', async () => {
      const convo = await api('/conversations', { method: 'POST', body: { contactId: id } });
      state.convoId = convo.id;
      closeDrawer();
      location.hash = '#/conversations';
      if (state.route === 'conversations') render();
    });
    el.querySelector('#d-dnd').addEventListener('click', async () => {
      await api('/contacts/' + id, { method: 'PATCH', body: { dnd: !c.dnd } });
      openContactDrawer(id, onChange); onChange && onChange();
    });
    el.querySelector('#d-del').addEventListener('click', async () => {
      if (!confirm('Delete this contact and all their records?')) return;
      await api('/contacts/' + id, { method: 'DELETE' });
      closeDrawer(); toast('Contact deleted'); onChange && onChange();
    });
    el.querySelector('#d-addtag').addEventListener('click', async () => {
      const tag = prompt('Tag name');
      if (!tag) return;
      await api(`/contacts/${id}/tags`, { method: 'POST', body: { tag } });
      openContactDrawer(id, onChange); onChange && onChange();
    });
    el.querySelectorAll('[data-untag]').forEach(a => a.addEventListener('click', async e => {
      e.preventDefault();
      await api(`/contacts/${id}/tags/${encodeURIComponent(a.dataset.untag)}`, { method: 'DELETE' });
      openContactDrawer(id, onChange); onChange && onChange();
    }));
  }

  // ------------------------------------------------------------------ pipeline
  async function renderPipeline() {
    const pipelines = await api('/pipelines');
    if (!pipelines.length) return setMain('<div class="empty">No pipeline yet — create one in Settings.</div>');
    const active = pipelines.find(p => p.id === state.pipelineId) || pipelines[0];
    state.pipelineId = active.id;
    const opps = await api('/opportunities?pipelineId=' + active.id);
    const open = opps.filter(o => o.status === 'open');

    setMain(`
      <div class="page-head">
        <h2>Pipeline</h2>
        <select class="input" id="p-select" style="width:200px">
          ${pipelines.map(p => `<option value="${p.id}" ${p.id === active.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
        <span class="muted">${open.length} open · ${money(open.reduce((s, o) => s + o.value, 0))}</span>
        <div class="spacer"></div>
        <button class="btn" id="p-manage">⚙ Manage pipelines</button>
        <button class="btn primary" id="p-add">+ Opportunity</button>
      </div>
      <div class="kanban">
        ${active.stages.map(stage => {
          const cards = open.filter(o => o.stageId === stage.id);
          return `
          <div class="kcol" data-stage="${stage.id}">
            <div class="kcol-head"><span class="name">${esc(stage.name)}</span>
              <span class="sum">${cards.length} · ${money(cards.reduce((s, o) => s + o.value, 0))}</span></div>
            ${cards.map(o => `
              <div class="kcard" draggable="true" data-opp="${o.id}">
                <div class="oname">${esc(o.name)}</div>
                <div class="ometa"><span>${esc(o.contact ? fullName(o.contact) : '')}</span>
                  <span class="val">${money(o.value)}</span></div>
                <div class="actions">
                  <button class="btn small" data-won="${o.id}">Won</button>
                  <button class="btn small danger" data-lost="${o.id}">Lost</button>
                </div>
              </div>`).join('')}
          </div>`;
        }).join('')}
      </div>`);

    document.getElementById('p-select').addEventListener('change', e => { state.pipelineId = e.target.value; renderPipeline(); });
    document.getElementById('p-add').addEventListener('click', () => oppModal(active, renderPipeline));
    document.getElementById('p-manage').addEventListener('click', () => pipelineManageModal(active, renderPipeline));

    // drag & drop
    let dragged = null;
    document.querySelectorAll('.kcard').forEach(card => {
      card.addEventListener('dragstart', () => { dragged = card.dataset.opp; });
    });
    document.querySelectorAll('.kcol').forEach(col => {
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('dragover'); });
      col.addEventListener('dragleave', () => col.classList.remove('dragover'));
      col.addEventListener('drop', async e => {
        e.preventDefault(); col.classList.remove('dragover');
        if (!dragged) return;
        try {
          await api('/opportunities/' + dragged, { method: 'PATCH', body: { stageId: col.dataset.stage } });
          toast('Moved — stage automations fired');
          renderPipeline();
        } catch (err) { toast(err.message, true); }
      });
    });
    document.querySelectorAll('[data-won]').forEach(b => b.addEventListener('click', async () => {
      await api('/opportunities/' + b.dataset.won, { method: 'PATCH', body: { status: 'won' } });
      toast('Marked won 🎉'); renderPipeline();
    }));
    document.querySelectorAll('[data-lost]').forEach(b => b.addEventListener('click', async () => {
      await api('/opportunities/' + b.dataset.lost, { method: 'PATCH', body: { status: 'lost' } });
      toast('Marked lost'); renderPipeline();
    }));
  }

  function pipelineManageModal(pipeline, onDone) {
    // working copy — nothing is saved until Save is clicked
    const work = { name: pipeline.name, stages: pipeline.stages.map(s => ({ ...s })) };
    const rows = () => work.stages.map((s, i) => `
      <div class="action-row" data-i="${i}">
        <div class="params"><input data-stage value="${esc(s.name)}"></div>
        <button class="btn small" data-up ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn small" data-down ${i === work.stages.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn small danger" data-rm ${work.stages.length <= 1 ? 'disabled' : ''}>✕</button>
      </div>`).join('');

    const m = modal(`
      <h3>Manage pipeline</h3>
      <div class="field"><label>Pipeline name</label><input id="pm-name" value="${esc(work.name)}"></div>
      <div class="field"><label>Stages (order = board order; deals in a deleted stage move to the first stage)</label>
        <div id="pm-stages">${rows()}</div>
        <button class="btn small" id="pm-addstage">+ Add stage</button></div>
      <div class="modal-actions" style="justify-content:space-between">
        <button class="btn" id="pm-newpipe">+ New pipeline instead</button>
        <div style="display:flex;gap:8px">
          <button class="btn danger" id="pm-delete">Delete pipeline</button>
          <button class="btn" id="m-cancel">Cancel</button>
          <button class="btn primary" id="m-save">Save</button>
        </div>
      </div>`);

    const readNames = () => m.querySelectorAll('#pm-stages [data-stage]').forEach((inp, i) => { work.stages[i].name = inp.value; });
    const redraw = () => { m.querySelector('#pm-stages').innerHTML = rows(); rebind(); };
    const rebind = () => {
      m.querySelectorAll('#pm-stages .action-row').forEach(row => {
        const i = Number(row.dataset.i);
        const up = row.querySelector('[data-up]'), down = row.querySelector('[data-down]'), rm = row.querySelector('[data-rm]');
        up.addEventListener('click', () => { readNames(); [work.stages[i - 1], work.stages[i]] = [work.stages[i], work.stages[i - 1]]; redraw(); });
        down.addEventListener('click', () => { readNames(); [work.stages[i + 1], work.stages[i]] = [work.stages[i], work.stages[i + 1]]; redraw(); });
        rm.addEventListener('click', () => { readNames(); work.stages.splice(i, 1); redraw(); });
      });
    };
    rebind();
    m.querySelector('#pm-addstage').addEventListener('click', () => { readNames(); work.stages.push({ name: 'New stage' }); redraw(); });

    m.querySelector('#m-cancel').addEventListener('click', closeModal);
    m.querySelector('#m-save').addEventListener('click', async () => {
      readNames();
      const stages = work.stages.filter(s => s.name.trim());
      if (!stages.length) return toast('at least one stage required', true);
      try {
        const saved = await api('/pipelines/' + pipeline.id, {
          method: 'PATCH',
          body: { name: m.querySelector('#pm-name').value.trim() || pipeline.name, stages }
        });
        // reparent any opportunity whose stage no longer exists
        const validIds = new Set(saved.stages.map(s => s.id));
        const opps = await api('/opportunities?pipelineId=' + pipeline.id);
        for (const o of opps.filter(o => !validIds.has(o.stageId))) {
          await api('/opportunities/' + o.id, { method: 'PATCH', body: { stageId: saved.stages[0].id } });
        }
        closeModal(); toast('Pipeline saved'); onDone && onDone();
      } catch (e) { toast(e.message, true); }
    });
    m.querySelector('#pm-delete').addEventListener('click', async () => {
      if (!confirm(`Delete "${pipeline.name}" and all its opportunities?`)) return;
      await api('/pipelines/' + pipeline.id, { method: 'DELETE' });
      state.pipelineId = null;
      closeModal(); toast('Pipeline deleted'); onDone && onDone();
    });
    m.querySelector('#pm-newpipe').addEventListener('click', () => {
      modal(`
        <h3>New pipeline</h3>
        <div class="field"><label>Name</label><input id="np-name" placeholder="e.g. Recruiting Pipeline"></div>
        <div class="field"><label>Stages (comma-separated)</label>
          <input id="np-stages" value="New Lead, Contacted, Qualified, Closed"></div>
        <div class="modal-actions">
          <button class="btn" id="m-cancel2">Cancel</button><button class="btn primary" id="np-save">Create</button>
        </div>`);
      document.getElementById('m-cancel2').addEventListener('click', closeModal);
      document.getElementById('np-save').addEventListener('click', async () => {
        try {
          const created = await api('/pipelines', {
            method: 'POST',
            body: { name: v('np-name'), stages: v('np-stages').split(',').map(s => s.trim()).filter(Boolean) }
          });
          state.pipelineId = created.id;
          closeModal(); toast('Pipeline created'); onDone && onDone();
        } catch (e) { toast(e.message, true); }
      });
    });
  }

  async function oppModal(pipeline, onDone) {
    const contacts = (await api('/contacts?limit=200')).contacts;
    modal(`
      <h3>New opportunity</h3>
      <div class="field"><label>Contact</label>
        <select id="m-contact">${contacts.map(c => `<option value="${c.id}">${esc(fullName(c))}</option>`).join('')}</select></div>
      <div class="field"><label>Name</label><input id="m-name" placeholder="Deal name"></div>
      <div class="row">
        <div class="field"><label>Value ($)</label><input id="m-value" type="number" value="0"></div>
        <div class="field"><label>Stage</label>
          <select id="m-stage">${pipeline.stages.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
      </div>
      <div class="modal-actions">
        <button class="btn" id="m-cancel">Cancel</button>
        <button class="btn primary" id="m-save">Create</button>
      </div>`);
    document.getElementById('m-cancel').addEventListener('click', closeModal);
    document.getElementById('m-save').addEventListener('click', async () => {
      try {
        await api('/opportunities', {
          method: 'POST',
          body: { contactId: v('m-contact'), pipelineId: pipeline.id, stageId: v('m-stage'), name: v('m-name'), value: Number(v('m-value')) }
        });
        closeModal(); toast('Opportunity created'); onDone && onDone();
      } catch (e) { toast(e.message, true); }
    });
  }

  // ------------------------------------------------------------------ power dialer
  const dialState = { timer: null, startedAt: null, dialing: false };
  function clearDialTimer() {
    if (dialState.timer) clearInterval(dialState.timer);
    dialState.timer = null; dialState.startedAt = null; dialState.dialing = false;
  }

  const DISPO_BTNS = [
    ['answered', '✓ Answered', 'primary'],
    ['voicemail', 'Voicemail', ''],
    ['no_answer', 'No answer', ''],
    ['busy', 'Busy', ''],
    ['callback', 'Callback', ''],
    ['wrong_number', 'Wrong #', 'danger']
  ];

  async function renderDialer() {
    clearDialTimer();
    if (state.dialerSessionId) return renderDialerSession(state.dialerSessionId);
    const sessions = await api('/dialer/sessions');
    setMain(`
      <div class="page-head"><h2>Power Dialer</h2>
        <span class="muted">queue up contacts, dial straight through, log every outcome</span>
        <div class="spacer"></div><button class="btn primary" id="dl-new">+ Dial session</button></div>
      <div class="card" style="padding:0">
        <table class="data">
          <thead><tr><th>Session</th><th>Progress</th><th>Outcomes</th><th>Status</th><th></th></tr></thead>
          <tbody>${sessions.map(s => {
            const counts = {};
            s.queue.forEach(q => { if (q.disposition) counts[q.disposition] = (counts[q.disposition] || 0) + 1; });
            return `
            <tr>
              <td><strong>${esc(s.name)}</strong><div class="muted small">${timeAgo(s.createdAt)}</div></td>
              <td class="tnum">${s.completedCount} / ${s.total}</td>
              <td class="small">${Object.entries(counts).map(([k, n]) => `<span class="tag">${esc(k.replace('_', ' '))} ${n}</span>`).join('') || '<span class="muted">—</span>'}</td>
              <td><span class="pill ${s.status === 'completed' ? 'won' : s.status === 'paused' ? 'lost' : 'open'}">${s.status}</span></td>
              <td style="text-align:right">
                ${s.status !== 'completed' ? `<button class="btn small primary" data-resume="${s.id}">▶ Dial</button>` : ''}
                <button class="btn small danger" data-del="${s.id}">✕</button>
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table>
        ${sessions.length ? '' : '<div class="empty">No dial sessions yet — build a queue and start calling</div>'}
      </div>`);
    document.getElementById('dl-new').addEventListener('click', dialerNewModal);
    document.querySelectorAll('[data-resume]').forEach(b => b.addEventListener('click', () => {
      state.dialerSessionId = b.dataset.resume; renderDialer();
    }));
    document.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this dial session?')) return;
      await api('/dialer/sessions/' + b.dataset.del, { method: 'DELETE' }); renderDialer();
    }));
  }

  async function dialerNewModal() {
    const [smartLists, tags, pipelines] = await Promise.all([api('/smart-lists'), api('/tags'), api('/pipelines')]);
    const stageOptions = p => p ? p.stages.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('') : '';
    const m = modal(`
      <h3>New dial session</h3>
      <div class="field"><label>Name</label><input id="dl-name" placeholder="Morning power hour"></div>
      <div class="row">
        <div class="field"><label>Smart list (optional)</label>
          <select id="dl-smart"><option value="">All contacts</option>
            ${smartLists.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Tag filter (optional)</label>
          <select id="dl-tag"><option value="">Any</option>
            ${tags.map(t => `<option value="${esc(t.tag)}">${esc(t.tag)} (${t.count})</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div class="field"><label>Pipeline (for stage moves)</label>
          <select id="dl-pipeline"><option value="">None</option>
            ${pipelines.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label>On answered → move to stage</label>
          <select id="dl-stage"><option value="">Don't move</option></select></div>
      </div>
      <div class="field"><label>Callback task due in (days)</label><input id="dl-cbdays" type="number" value="1"></div>
      <p class="muted small">Queue is sorted hottest-first by lead score. DND contacts and contacts without a phone number are skipped automatically.</p>
      <div class="modal-actions">
        <button class="btn" id="m-cancel">Cancel</button>
        <button class="btn primary" id="m-save">Build queue & start</button>
      </div>`);
    const pipeSel = m.querySelector('#dl-pipeline'), stageSel = m.querySelector('#dl-stage');
    pipeSel.addEventListener('change', () => {
      const p = pipelines.find(x => x.id === pipeSel.value);
      stageSel.innerHTML = `<option value="">Don't move</option>` + stageOptions(p);
    });
    m.querySelector('#m-cancel').addEventListener('click', closeModal);
    m.querySelector('#m-save').addEventListener('click', async () => {
      try {
        const created = await api('/dialer/sessions', {
          method: 'POST',
          body: {
            name: v('dl-name'),
            smartListId: v('dl-smart') || undefined,
            tag: v('dl-tag') || undefined,
            pipelineId: v('dl-pipeline') || undefined,
            rules: { answeredStageId: v('dl-stage') || undefined, callbackInDays: Number(v('dl-cbdays') || 1) }
          }
        });
        closeModal();
        toast(`Queue built: ${created.total} contacts` +
          (created.skipped && (created.skipped.dnd || created.skipped.noPhone)
            ? ` (skipped ${created.skipped.dnd} DND, ${created.skipped.noPhone} without phone)` : ''));
        state.dialerSessionId = created.id;
        renderDialer();
      } catch (e) { toast(e.message, true); }
    });
  }

  async function renderDialerSession(id) {
    clearDialTimer();
    let data;
    try { data = await api('/dialer/sessions/' + id); }
    catch (e) { state.dialerSessionId = null; return renderDialer(); }
    const { session, contact } = data;

    if (session.status === 'completed' || !contact) {
      state.dialerSessionId = null;
      const counts = {};
      session.queue.forEach(q => { if (q.disposition) counts[q.disposition] = (counts[q.disposition] || 0) + 1; });
      setMain(`
        <div class="page-head"><h2>Session complete 🎉</h2><div class="spacer"></div>
          <button class="btn" id="dl-back">← Back to dialer</button></div>
        <div class="grid kpis">
          ${kpi('Dialed', session.completedCount)}
          ${Object.entries(counts).map(([k, n]) => kpi(k.replace('_', ' '), n)).join('')}
        </div>`);
      document.getElementById('dl-back').addEventListener('click', renderDialer);
      return;
    }

    const done = session.completedCount;
    const pct = Math.round(done / session.total * 100);
    const cf = Object.entries(contact.customFields || {});
    setMain(`
      <div class="page-head">
        <h2>${esc(session.name)}</h2>
        <span class="muted tnum">${done + 1} of ${session.total}</span>
        <div class="spacer"></div>
        <button class="btn" id="dl-pause">⏸ Pause & exit</button>
      </div>
      <div style="background:var(--surface-2);border-radius:999px;height:6px;margin-bottom:18px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:var(--gold)"></div>
      </div>
      <div class="grid two-col">
        <div class="card">
          <div class="drawer-head" style="margin-bottom:8px">
            <div class="avatar">${esc(initials(contact))}</div>
            <div style="flex:1">
              <h3 style="font-size:20px">${esc(fullName(contact))}</h3>
              <div class="muted">${esc(contact.company || '')} ${contact.company ? '·' : ''} score
                <span class="score ${scoreClass(contact.leadScore || 0)}">${contact.leadScore || 0}</span></div>
            </div>
          </div>
          <div style="font-size:22px;font-weight:700;letter-spacing:0.02em" class="tnum">${esc(contact.phone)}</div>
          <div class="small muted" style="margin:2px 0 10px">${esc(contact.email || '')}</div>
          <div>${(contact.tags || []).map(t => `<span class="tag gold">${esc(t)}</span>`).join('')}</div>
          ${cf.length ? `<div class="small" style="margin-top:8px">${cf.map(([k, val]) => `<span class="tag">${esc(k)}: ${esc(val)}</span>`).join('')}</div>` : ''}

          <div style="display:flex;align-items:center;gap:12px;margin-top:18px">
            <button class="btn primary" id="dl-dial" style="font-size:16px;padding:12px 22px">📞 Dial</button>
            <span id="dl-timer" class="tnum" style="font-size:20px;font-weight:700;display:none">00:00</span>
            <span id="dl-mode" class="muted small"></span>
            <div class="spacer"></div>
            <button class="btn" id="dl-skip">Skip →</button>
          </div>

          <div class="field" style="margin-top:14px"><label>Call notes</label>
            <textarea id="dl-notes" rows="2" placeholder="What happened on the call…"></textarea></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${DISPO_BTNS.map(([key, label, cls]) => `<button class="btn ${cls}" data-dispo="${key}">${label}</button>`).join('')}
          </div>
          <p class="muted small" style="margin-top:10px">
            Answered${session.rules.answeredStageId ? ' moves the deal stage' : ''} · Voicemail/No-answer tags the contact ·
            Callback creates a task due in ${session.rules.callbackInDays}d · Wrong # sets DND. Every outcome logs to the conversation and fires call automations.</p>
        </div>
        <div class="card"><h3>Recent history</h3>
          <div class="timeline">
            ${data.contactActivities.map(a => `
              <div class="tl-item ${/call|won|form/.test(a.type) ? 'hot' : ''}">
                <div>${esc(a.summary)}</div><div class="when">${timeAgo(a.createdAt)}</div>
              </div>`).join('') || '<div class="muted small">no history</div>'}
          </div>
          ${data.contactOpportunities.length ? `<h3 style="margin-top:16px">Deals</h3>
            ${data.contactOpportunities.map(o => `<div class="small" style="margin-bottom:4px">
              <span class="pill ${o.status}">${o.status}</span> ${esc(o.name)} — <strong class="tnum">${money(o.value)}</strong></div>`).join('')}` : ''}
        </div>
      </div>`);

    document.getElementById('dl-pause').addEventListener('click', async () => {
      await api('/dialer/sessions/' + id, { method: 'PATCH', body: { status: 'paused' } });
      clearDialTimer(); state.dialerSessionId = null; renderDialer();
    });

    document.getElementById('dl-dial').addEventListener('click', async () => {
      if (dialState.dialing) return;
      try {
        const r = await api(`/dialer/sessions/${id}/dial`, { method: 'POST', body: {} });
        dialState.dialing = true;
        dialState.startedAt = Date.now();
        const timerEl = document.getElementById('dl-timer');
        timerEl.style.display = '';
        document.getElementById('dl-mode').textContent =
          r.mode === 'telnyx' ? 'ringing via Telnyx…' : 'simulated call (no Telnyx creds) — or tap: ' + r.telUri;
        dialState.timer = setInterval(() => {
          const s = Math.floor((Date.now() - dialState.startedAt) / 1000);
          timerEl.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
        }, 500);
      } catch (e) { toast(e.message, true); }
    });

    document.getElementById('dl-skip').addEventListener('click', async () => {
      await api(`/dialer/sessions/${id}/disposition`, { method: 'POST', body: { skip: true } });
      clearDialTimer(); renderDialerSession(id);
    });

    document.querySelectorAll('[data-dispo]').forEach(b => b.addEventListener('click', async () => {
      const durationSeconds = dialState.startedAt ? Math.floor((Date.now() - dialState.startedAt) / 1000) : 0;
      try {
        const r = await api(`/dialer/sessions/${id}/disposition`, {
          method: 'POST',
          body: { result: b.dataset.dispo, notes: v('dl-notes'), durationSeconds }
        });
        clearDialTimer();
        toast(`Logged: ${b.dataset.dispo.replace('_', ' ')}`);
        renderDialerSession(id);
      } catch (e) { toast(e.message, true); }
    }));
  }

  // ------------------------------------------------------------------ conversations
  async function renderConversations() {
    const convos = await api('/conversations');
    if (!state.convoId && convos[0]) state.convoId = convos[0].id;
    const active = convos.find(c => c.id === state.convoId);
    const messages = active ? await api(`/conversations/${active.id}/messages`) : [];

    setMain(`
      <div class="page-head"><h2>Conversations</h2><span class="muted">${convos.length} threads · unified SMS / email / calls</span></div>
      <div class="inbox">
        <div class="card convo-list">
          ${convos.map(c => `
            <div class="convo-item ${c.id === state.convoId ? 'active' : ''}" data-id="${c.id}">
              <div class="who"><span>${esc(c.contact ? fullName(c.contact) : 'Unknown')}${c.unread ? '<span class="unread-dot"></span>' : ''}</span>
                <span class="when">${timeAgo(c.lastMessageAt)}</span></div>
              <div class="prev">${esc(c.lastPreview)}</div>
            </div>`).join('') || '<div class="empty">No conversations yet</div>'}
        </div>
        <div class="card thread" style="padding:0">
          ${active ? `
            <div class="thread-head">
              <strong>${esc(active.contact ? fullName(active.contact) : 'Unknown')}</strong>
              <span class="muted small">${esc(active.contact ? active.contact.phone : '')}</span>
              ${active.contact && active.contact.dnd ? '<span class="tag">DND</span>' : ''}
            </div>
            <div class="thread-msgs" id="thread-msgs">
              ${messages.map(m => `
                <div class="msg ${m.direction} ${m.channel === 'call' ? 'call' : ''}">
                  ${m.subject ? `<strong>${esc(m.subject)}</strong><br>` : ''}${esc(m.body)}
                  <div class="mmeta">${esc(m.channel)} · ${esc(m.direction)} · ${fmtDT(m.createdAt)}${m.status === 'simulated' ? ' · simulated' : ''}</div>
                </div>`).join('')}
            </div>
            <div class="composer">
              <select class="input" id="msg-channel"><option value="sms">SMS</option><option value="email">Email</option><option value="note">Note</option></select>
              <input class="input" id="msg-body" placeholder="Type a message… ({{contact.first_name}} works)">
              <button class="btn primary" id="msg-send">Send</button>
            </div>` : '<div class="empty">Select a conversation</div>'}
        </div>
      </div>`);

    document.querySelectorAll('.convo-item').forEach(el =>
      el.addEventListener('click', () => { state.convoId = el.dataset.id; renderConversations(); }));
    const msgsEl = document.getElementById('thread-msgs');
    if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
    const send = async () => {
      const body = v('msg-body');
      if (!body) return;
      try {
        await api(`/conversations/${state.convoId}/messages`, {
          method: 'POST', body: { channel: v('msg-channel'), body }
        });
        renderConversations();
      } catch (e) { toast(e.message, true); }
    };
    const sendBtn = document.getElementById('msg-send');
    if (sendBtn) {
      sendBtn.addEventListener('click', send);
      document.getElementById('msg-body').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    }
  }

  // ------------------------------------------------------------------ calendar
  async function renderCalendar() {
    const appts = await api('/appointments');
    const upcoming = appts.filter(a => a.startAt >= new Date(Date.now() - 86400000).toISOString());
    setMain(`
      <div class="page-head"><h2>Calendar</h2><span class="muted">${upcoming.length} upcoming</span>
        <div class="spacer"></div><button class="btn primary" id="a-add">+ Book appointment</button></div>
      <div class="card" style="padding:0">
        <table class="data">
          <thead><tr><th>When</th><th>Title</th><th>Contact</th><th>Status</th><th></th></tr></thead>
          <tbody>${appts.map(a => `
            <tr>
              <td class="tnum">${fmtDT(a.startAt)}</td>
              <td><strong>${esc(a.title)}</strong>${a.notes ? `<div class="muted small">${esc(a.notes)}</div>` : ''}</td>
              <td>${esc(a.contact ? fullName(a.contact) : '')}</td>
              <td><span class="pill ${a.status === 'booked' ? 'booked' : a.status === 'completed' ? 'won' : 'lost'}">${esc(a.status)}</span></td>
              <td style="text-align:right">
                ${a.status === 'booked' ? `<button class="btn small" data-done="${a.id}">Complete</button>
                <button class="btn small danger" data-cancel="${a.id}">Cancel</button>` : ''}
              </td>
            </tr>`).join('')}</tbody>
        </table>
        ${appts.length ? '' : '<div class="empty">Nothing booked</div>'}
      </div>`);
    document.getElementById('a-add').addEventListener('click', async () => {
      const contacts = (await api('/contacts?limit=200')).contacts;
      modal(`
        <h3>Book appointment</h3>
        <div class="field"><label>Contact</label>
          <select id="m-contact">${contacts.map(c => `<option value="${c.id}">${esc(fullName(c))}</option>`).join('')}</select></div>
        <div class="field"><label>Title</label><input id="m-title" placeholder="Consult call"></div>
        <div class="row">
          <div class="field"><label>Start</label><input id="m-start" type="datetime-local"></div>
          <div class="field"><label>Minutes</label><input id="m-mins" type="number" value="30"></div>
        </div>
        <div class="field"><label>Notes</label><input id="m-notes"></div>
        <div class="modal-actions">
          <button class="btn" id="m-cancel">Cancel</button><button class="btn primary" id="m-save">Book</button>
        </div>`);
      document.getElementById('m-cancel').addEventListener('click', closeModal);
      document.getElementById('m-save').addEventListener('click', async () => {
        try {
          const start = new Date(v('m-start'));
          if (isNaN(start)) throw new Error('pick a start time');
          await api('/appointments', {
            method: 'POST',
            body: {
              contactId: v('m-contact'), title: v('m-title') || 'Appointment',
              startAt: start.toISOString(),
              endAt: new Date(start.getTime() + Number(v('m-mins') || 30) * 60000).toISOString(),
              notes: v('m-notes')
            }
          });
          closeModal(); toast('Appointment booked — automations fired'); renderCalendar();
        } catch (e) { toast(e.message, true); }
      });
    });
    document.querySelectorAll('[data-done]').forEach(b => b.addEventListener('click', async () => {
      await api('/appointments/' + b.dataset.done, { method: 'PATCH', body: { status: 'completed' } }); renderCalendar();
    }));
    document.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', async () => {
      await api('/appointments/' + b.dataset.cancel, { method: 'PATCH', body: { status: 'cancelled' } }); renderCalendar();
    }));
  }

  // ------------------------------------------------------------------ tasks
  async function renderTasks() {
    const tasks = await api('/tasks');
    const open = tasks.filter(t => t.status === 'open');
    setMain(`
      <div class="page-head"><h2>Tasks</h2><span class="muted">${open.length} open</span>
        <div class="spacer"></div><button class="btn primary" id="t-add">+ Task</button></div>
      <div class="card" style="padding:0">
        <table class="data">
          <thead><tr><th style="width:36px"></th><th>Task</th><th>Contact</th><th>Due</th><th>Source</th><th></th></tr></thead>
          <tbody>${tasks.map(t => `
            <tr style="${t.status === 'done' ? 'opacity:0.45' : ''}">
              <td><input type="checkbox" data-toggle="${t.id}" ${t.status === 'done' ? 'checked' : ''}></td>
              <td><strong>${esc(t.title)}</strong>${t.description ? `<div class="muted small">${esc(t.description)}</div>` : ''}</td>
              <td>${esc(t.contact ? fullName(t.contact) : '')}</td>
              <td class="tnum ${t.dueAt && t.dueAt < new Date().toISOString() && t.status === 'open' ? '' : 'muted'}"
                style="${t.dueAt && t.dueAt < new Date().toISOString() && t.status === 'open' ? 'color:var(--warning)' : ''}">${fmtDT(t.dueAt)}</td>
              <td class="muted">${esc(t.source)}</td>
              <td style="text-align:right"><button class="btn small danger" data-del="${t.id}">✕</button></td>
            </tr>`).join('')}</tbody>
        </table>
        ${tasks.length ? '' : '<div class="empty">No tasks</div>'}
      </div>`);
    document.getElementById('t-add').addEventListener('click', async () => {
      const contacts = (await api('/contacts?limit=200')).contacts;
      modal(`
        <h3>New task</h3>
        <div class="field"><label>Title</label><input id="m-title"></div>
        <div class="field"><label>Contact (optional)</label>
          <select id="m-contact"><option value="">—</option>${contacts.map(c => `<option value="${c.id}">${esc(fullName(c))}</option>`).join('')}</select></div>
        <div class="field"><label>Due</label><input id="m-due" type="datetime-local"></div>
        <div class="modal-actions"><button class="btn" id="m-cancel">Cancel</button><button class="btn primary" id="m-save">Create</button></div>`);
      document.getElementById('m-cancel').addEventListener('click', closeModal);
      document.getElementById('m-save').addEventListener('click', async () => {
        try {
          const due = v('m-due') ? new Date(v('m-due')).toISOString() : null;
          await api('/tasks', { method: 'POST', body: { title: v('m-title'), contactId: v('m-contact') || null, dueAt: due } });
          closeModal(); renderTasks();
        } catch (e) { toast(e.message, true); }
      });
    });
    document.querySelectorAll('[data-toggle]').forEach(cb => cb.addEventListener('change', async () => {
      await api('/tasks/' + cb.dataset.toggle, { method: 'PATCH', body: { status: cb.checked ? 'done' : 'open' } });
      renderTasks();
    }));
    document.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      await api('/tasks/' + b.dataset.del, { method: 'DELETE' }); renderTasks();
    }));
  }

  // ------------------------------------------------------------------ automations
  const TRIGGERS = [
    ['contact.created', 'Contact created'],
    ['contact.claimed', 'Lead claimed'],
    ['contact.tag_added', 'Tag added'],
    ['form.submitted', 'Form submitted'],
    ['opportunity.stage_changed', 'Opportunity stage changed'],
    ['call.completed', 'Call completed'],
    ['message.inbound', 'Inbound message'],
    ['appointment.booked', 'Appointment booked']
  ];
  const ACTIONS = [
    ['send_sms', 'Send SMS'],
    ['send_email', 'Send email'],
    ['add_tag', 'Add tag'],
    ['remove_tag', 'Remove tag'],
    ['create_task', 'Create task'],
    ['create_opportunity', 'Create opportunity'],
    ['enroll_sequence', 'Enroll in sequence'],
    ['notify_webhook', 'Call webhook'],
    ['add_note', 'Add note']
  ];
  const actionLabel = t => (ACTIONS.find(a => a[0] === t) || [t, t])[1];
  const triggerLabel = t => (TRIGGERS.find(a => a[0] === t) || [t, t])[1];

  async function renderAutomations() {
    const [autos, runs] = await Promise.all([api('/automations'), api('/automation-runs')]);
    setMain(`
      <div class="page-head"><h2>Automations</h2><span class="muted">${autos.filter(a => a.enabled).length} active</span>
        <div class="spacer"></div><button class="btn primary" id="au-add">+ Automation</button></div>
      <div class="grid" style="grid-template-columns:1fr">
        ${autos.map(a => `
          <div class="card auto-card">
            <label class="switch"><input type="checkbox" data-en="${a.id}" ${a.enabled ? 'checked' : ''}><span class="track"></span></label>
            <div class="flow">
              <div class="name">${esc(a.name)}</div>
              <div class="steps">⚡ ${esc(triggerLabel(a.trigger.type))} → ${(a.actions || []).map(x => esc(actionLabel(x.type))).join(' → ') || 'no actions'}</div>
            </div>
            <button class="btn small" data-test="${a.id}">Test run</button>
            <button class="btn small" data-edit="${a.id}">Edit</button>
            <button class="btn small danger" data-del="${a.id}">✕</button>
          </div>`).join('') || '<div class="empty">No automations yet</div>'}
      </div>
      <div class="card" style="margin-top:16px"><h3>Recent runs</h3>
        <table class="data">
          <thead><tr><th>When</th><th>Automation</th><th>Steps</th></tr></thead>
          <tbody>${runs.slice(0, 12).map(r => `
            <tr><td class="muted tnum">${timeAgo(r.createdAt)}</td><td>${esc(r.automationName)}</td>
              <td class="small">${(r.steps || []).map(s => `${s.ok ? '✓' : '✗'} ${esc(actionLabel(s.action))}`).join(' · ')}</td></tr>`).join('')}
          </tbody>
        </table>
        ${runs.length ? '' : '<div class="empty">No runs yet</div>'}
      </div>`);

    document.getElementById('au-add').addEventListener('click', () => automationModal(null, renderAutomations));
    document.querySelectorAll('[data-en]').forEach(cb => cb.addEventListener('change', async () => {
      await api('/automations/' + cb.dataset.en, { method: 'PATCH', body: { enabled: cb.checked } });
      toast(cb.checked ? 'Automation enabled' : 'Automation paused');
    }));
    document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () =>
      automationModal(autos.find(a => a.id === b.dataset.edit), renderAutomations)));
    document.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this automation?')) return;
      await api('/automations/' + b.dataset.del, { method: 'DELETE' }); renderAutomations();
    }));
    document.querySelectorAll('[data-test]').forEach(b => b.addEventListener('click', async () => {
      const r = await api(`/automations/${b.dataset.test}/test`, { method: 'POST', body: {} });
      toast('Test: ' + r.results.map(x => `${x.action} ${x.ok ? '✓' : '✗ ' + x.error}`).join(', '));
      renderAutomations();
    }));
  }

  async function automationModal(existing, onDone) {
    const seqList = await api('/sequences');
    const a = existing || { name: '', trigger: { type: 'contact.created' }, actions: [{ type: 'send_sms', body: '' }] };
    const paramsFor = (action) => {
      switch (action.type) {
        case 'send_sms': return `<input placeholder="Message… use {{contact.first_name}}" data-p="body" value="${esc(action.body)}">`;
        case 'send_email': return `<input placeholder="Subject" data-p="subject" value="${esc(action.subject)}">
          <input placeholder="Body" data-p="body" value="${esc(action.body)}">`;
        case 'add_tag': case 'remove_tag': return `<input placeholder="tag-name" data-p="tag" value="${esc(action.tag)}">`;
        case 'create_task': return `<input placeholder="Task title" data-p="title" value="${esc(action.title)}">
          <input placeholder="Due in days (0 = today)" type="number" data-p="dueInDays" value="${esc(action.dueInDays != null ? action.dueInDays : 0)}">`;
        case 'create_opportunity': return `<input placeholder="Deal name" data-p="name" value="${esc(action.name)}">
          <input placeholder="Value" type="number" data-p="value" value="${esc(action.value || 0)}">`;
        case 'enroll_sequence': return seqList.length
          ? `<select data-p="sequenceId">${seqList.map(s =>
              `<option value="${s.id}" ${action.sequenceId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`
          : `<span class="muted small">No sequences yet — create one under Sequences first</span>`;
        case 'notify_webhook': return `<input placeholder="https://…" data-p="url" value="${esc(action.url)}">`;
        case 'add_note': return `<input placeholder="Note text" data-p="body" value="${esc(action.body)}">`;
        default: return '';
      }
    };
    const renderRows = () => a.actions.map((action, i) => `
      <div class="action-row" data-i="${i}">
        <select data-type>${ACTIONS.map(([val, label]) => `<option value="${val}" ${action.type === val ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <div class="params">${paramsFor(action)}</div>
        <button class="btn small danger" data-rm>✕</button>
      </div>`).join('');

    const m = modal(`
      <h3>${existing ? 'Edit automation' : 'New automation'}</h3>
      <div class="field"><label>Name</label><input id="au-name" value="${esc(a.name)}"></div>
      <div class="field"><label>Trigger — when this happens…</label>
        <select id="au-trigger">${TRIGGERS.map(([val, label]) => `<option value="${val}" ${a.trigger.type === val ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      <div class="field"><label>Actions — do this, in order</label><div id="au-actions">${renderRows()}</div>
        <button class="btn small" id="au-addaction">+ Add action</button></div>
      <div class="modal-actions">
        <button class="btn" id="m-cancel">Cancel</button>
        <button class="btn primary" id="m-save">${existing ? 'Save' : 'Create'}</button>
      </div>`);

    const rebind = () => {
      m.querySelectorAll('.action-row [data-type]').forEach(sel => sel.addEventListener('change', () => {
        const i = Number(sel.closest('.action-row').dataset.i);
        a.actions[i] = { type: sel.value };
        m.querySelector('#au-actions').innerHTML = renderRows(); rebind();
      }));
      m.querySelectorAll('.action-row [data-rm]').forEach(btn => btn.addEventListener('click', () => {
        a.actions.splice(Number(btn.closest('.action-row').dataset.i), 1);
        m.querySelector('#au-actions').innerHTML = renderRows(); rebind();
      }));
    };
    rebind();
    m.querySelector('#au-addaction').addEventListener('click', () => {
      a.actions.push({ type: 'add_tag' });
      m.querySelector('#au-actions').innerHTML = renderRows(); rebind();
    });
    m.querySelector('#m-cancel').addEventListener('click', closeModal);
    m.querySelector('#m-save').addEventListener('click', async () => {
      // read params from inputs
      m.querySelectorAll('.action-row').forEach(row => {
        const i = Number(row.dataset.i);
        row.querySelectorAll('[data-p]').forEach(inp => {
          a.actions[i][inp.dataset.p] = inp.type === 'number' ? Number(inp.value) : inp.value;
        });
      });
      const body = {
        name: m.querySelector('#au-name').value.trim(),
        trigger: { type: m.querySelector('#au-trigger').value },
        actions: a.actions
      };
      if (!body.name) return toast('name required', true);
      try {
        if (existing) await api('/automations/' + existing.id, { method: 'PATCH', body });
        else await api('/automations', { method: 'POST', body });
        closeModal(); toast('Automation saved'); onDone && onDone();
      } catch (e) { toast(e.message, true); }
    });
  }

  // ------------------------------------------------------------------ sequences
  async function renderSequences() {
    const [seqs, enrollments, email] = await Promise.all([
      api('/sequences'), api('/sequence-enrollments'), api('/email-status')
    ]);
    setMain(`
      <div class="page-head"><h2>Email Sequences</h2>
        <span class="${email.configured ? '' : 'muted'}" style="${email.configured ? 'color:var(--good)' : ''}">
          ${email.configured ? '● live — sending as ' + esc(email.user) : '● simulated — connect Google in Settings → Email'}</span>
        <div class="spacer"></div><button class="btn primary" id="sq-add">+ Sequence</button></div>
      <div class="grid" style="grid-template-columns:1fr">
        ${seqs.map(s => `
          <div class="card auto-card">
            <label class="switch"><input type="checkbox" data-en="${s.id}" ${s.enabled ? 'checked' : ''}><span class="track"></span></label>
            <div class="flow">
              <div class="name">${esc(s.name)}</div>
              <div class="steps">${s.steps.map((st, i) =>
                `${i === 0 && !st.delayDays ? 'Immediately' : '+' + st.delayDays + 'd'}: ${esc(st.subject || '(no subject)')}`).join(' → ')}</div>
              <div class="small muted" style="margin-top:3px">
                ${s.stats.active} active · ${s.stats.completed} completed · ${s.stats.stopped} stopped</div>
            </div>
            <button class="btn small" data-enroll="${s.id}">Enroll contact</button>
            <button class="btn small" data-edit="${s.id}">Edit</button>
            <button class="btn small danger" data-del="${s.id}">✕</button>
          </div>`).join('') || '<div class="empty">No sequences yet — build a drip and enroll leads (or let a "Lead claimed" automation do it)</div>'}
      </div>
      <div class="card" style="margin-top:16px"><h3>Enrollments</h3>
        <table class="data">
          <thead><tr><th>Contact</th><th>Sequence</th><th>Step</th><th>Next send</th><th>Status</th><th></th></tr></thead>
          <tbody>${enrollments.slice(0, 20).map(e => `
            <tr>
              <td>${esc(e.contact ? fullName(e.contact) : '?')}</td>
              <td>${esc(e.sequenceName)}</td>
              <td class="tnum">${e.stepIndex}</td>
              <td class="muted tnum">${e.status === 'active' ? fmtDT(e.nextAt) : '—'}</td>
              <td><span class="pill ${e.status === 'active' ? 'open' : e.status === 'completed' ? 'won' : 'lost'}">${e.status}</span>
                ${e.stopReason ? `<span class="muted small"> ${esc(e.stopReason)}</span>` : ''}</td>
              <td style="text-align:right">${e.status === 'active' ? `<button class="btn small danger" data-stop="${e.id}">Stop</button>` : ''}</td>
            </tr>`).join('')}</tbody>
        </table>
        ${enrollments.length ? '' : '<div class="empty">No enrollments yet</div>'}
      </div>`);

    document.getElementById('sq-add').addEventListener('click', () => sequenceModal(null, renderSequences));
    document.querySelectorAll('[data-en]').forEach(cb => cb.addEventListener('change', async () => {
      await api('/sequences/' + cb.dataset.en, { method: 'PATCH', body: { enabled: cb.checked } });
      toast(cb.checked ? 'Sequence enabled' : 'Sequence paused');
    }));
    document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () =>
      sequenceModal(seqs.find(s => s.id === b.dataset.edit), renderSequences)));
    document.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this sequence and its enrollments?')) return;
      await api('/sequences/' + b.dataset.del, { method: 'DELETE' }); renderSequences();
    }));
    document.querySelectorAll('[data-stop]').forEach(b => b.addEventListener('click', async () => {
      await api(`/sequence-enrollments/${b.dataset.stop}/stop`, { method: 'POST', body: {} }); renderSequences();
    }));
    document.querySelectorAll('[data-enroll]').forEach(b => b.addEventListener('click', async () => {
      const contacts = (await api('/contacts?limit=200')).contacts.filter(c => c.email);
      modal(`
        <h3>Enroll contact</h3>
        <div class="field"><label>Contact (must have an email)</label>
          <select id="en-contact">${contacts.map(c => `<option value="${c.id}">${esc(fullName(c))} — ${esc(c.email)}</option>`).join('')}</select></div>
        <div class="modal-actions"><button class="btn" id="m-cancel">Cancel</button>
          <button class="btn primary" id="m-save">Enroll</button></div>`);
      document.getElementById('m-cancel').addEventListener('click', closeModal);
      document.getElementById('m-save').addEventListener('click', async () => {
        try {
          await api(`/sequences/${b.dataset.enroll}/enroll`, { method: 'POST', body: { contactId: v('en-contact') } });
          closeModal(); toast('Enrolled — step 1 sends now'); renderSequences();
        } catch (e) { toast(e.message, true); }
      });
    }));
  }

  function sequenceModal(existing, onDone) {
    const s = existing
      ? { name: existing.name, steps: existing.steps.map(x => ({ ...x })) }
      : { name: '', steps: [{ delayDays: 0, subject: '', body: '' }] };
    const rows = () => s.steps.map((st, i) => `
      <div class="card" data-i="${i}" style="margin-bottom:10px;padding:12px">
        <div class="row">
          <div class="field" style="flex:0 0 130px"><label>${i === 0 ? 'Send after (days)' : 'Days after previous'}</label>
            <input type="number" data-delay value="${esc(st.delayDays)}"></div>
          <div class="field"><label>Subject</label><input data-subject value="${esc(st.subject)}"></div>
          <button class="btn small danger" data-rmstep style="align-self:flex-end;margin-bottom:14px" ${s.steps.length <= 1 ? 'disabled' : ''}>✕</button>
        </div>
        <div class="field" style="margin-bottom:0"><label>Body — {{contact.first_name}}, {{contact.name}}, {{contact.email}} work</label>
          <textarea data-body rows="3">${esc(st.body)}</textarea></div>
      </div>`).join('');

    const m = modal(`
      <h3>${existing ? 'Edit sequence' : 'New sequence'}</h3>
      <div class="field"><label>Name</label><input id="sq-name" value="${esc(s.name)}"></div>
      <div id="sq-steps">${rows()}</div>
      <button class="btn small" id="sq-addstep">+ Add step</button>
      <p class="muted small" style="margin-top:8px">Sequences stop automatically when a contact replies, is set to DND, or the sequence is paused.</p>
      <div class="modal-actions">
        <button class="btn" id="m-cancel">Cancel</button>
        <button class="btn primary" id="m-save">${existing ? 'Save' : 'Create'}</button>
      </div>`);

    const read = () => m.querySelectorAll('#sq-steps [data-i]').forEach((card, i) => {
      s.steps[i].delayDays = Number(card.querySelector('[data-delay]').value) || 0;
      s.steps[i].subject = card.querySelector('[data-subject]').value;
      s.steps[i].body = card.querySelector('[data-body]').value;
    });
    const redraw = () => { m.querySelector('#sq-steps').innerHTML = rows(); rebind(); };
    const rebind = () => m.querySelectorAll('[data-rmstep]').forEach(btn =>
      btn.addEventListener('click', () => { read(); s.steps.splice(Number(btn.closest('[data-i]').dataset.i), 1); redraw(); }));
    rebind();
    m.querySelector('#sq-addstep').addEventListener('click', () => { read(); s.steps.push({ delayDays: 2, subject: '', body: '' }); redraw(); });
    m.querySelector('#m-cancel').addEventListener('click', closeModal);
    m.querySelector('#m-save').addEventListener('click', async () => {
      read();
      const body = { name: m.querySelector('#sq-name').value.trim(), steps: s.steps };
      if (!body.name) return toast('name required', true);
      try {
        if (existing) await api('/sequences/' + existing.id, { method: 'PATCH', body });
        else await api('/sequences', { method: 'POST', body });
        closeModal(); toast('Sequence saved'); onDone && onDone();
      } catch (e) { toast(e.message, true); }
    });
  }

  // ------------------------------------------------------------------ settings
  async function renderSettings() {
    const [fields, lists, keys, tags, email] = await Promise.all([
      api('/custom-fields'), api('/smart-lists'), api('/api-keys'), api('/tags'), api('/email-status')
    ]);
    const locHost = location.origin;
    setMain(`
      <div class="page-head"><h2>Settings</h2><span class="muted">${esc(currentLocation().name)}</span></div>
      <div class="grid" style="grid-template-columns:1fr 1fr">
        <div class="card"><h3>Custom fields</h3>
          ${fields.map(f => `<div class="small" style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span><strong>${esc(f.name)}</strong> <span class="muted">(${esc(f.key)} · ${esc(f.type)})</span></span>
            <a href="#" data-delfield="${f.id}">✕</a></div>`).join('') || '<div class="muted small">none</div>'}
          <div style="display:flex;gap:6px;margin-top:10px">
            <input class="input" id="cf-name" placeholder="Field name">
            <select class="input" id="cf-type" style="width:90px"><option>text</option><option>number</option><option>date</option></select>
            <button class="btn small" id="cf-add">Add</button></div>
        </div>
        <div class="card"><h3>Smart lists</h3>
          ${lists.map(s => `<div class="small" style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span><strong>${esc(s.name)}</strong> <span class="muted">${esc(JSON.stringify(s.filters))}</span></span>
            <a href="#" data-dellist="${s.id}">✕</a></div>`).join('') || '<div class="muted small">none</div>'}
          <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
            <input class="input" id="sl-name" placeholder="List name" style="flex:1">
            <input class="input" id="sl-tag" placeholder="tag filter" style="width:110px">
            <input class="input" id="sl-score" placeholder="min score" type="number" style="width:90px">
            <button class="btn small" id="sl-add">Add</button></div>
        </div>
        <div class="card"><h3>API keys — forms & phone bridge</h3>
          ${keys.map(k => `<div class="small" style="margin-bottom:8px">
            <strong>${esc(k.name)}</strong><br><code style="font-size:11px">${esc(k.key)}</code>
            <a href="#" data-delkey="${k.id}" style="margin-left:6px">✕</a></div>`).join('') || '<div class="muted small">none</div>'}
          <div style="display:flex;gap:6px;margin-top:8px">
            <input class="input" id="ak-name" placeholder="Key name">
            <button class="btn small" id="ak-add">Generate</button></div>
          <p class="muted small" style="margin-top:10px">
            Form endpoint: <code>POST ${esc(locHost)}/webhooks/forms/&lt;key&gt;</code><br>
            Call log endpoint: <code>POST ${esc(locHost)}/webhooks/calls</code> with <code>{"apiKey": "…"}</code></p>
        </div>
        <div class="card"><h3>Email sending (Google / SMTP)</h3>
          ${email.configured
            ? `<div style="color:var(--good)">● Live — sending as <strong>${esc(email.user)}</strong></div>
               <p class="muted small" style="margin-top:8px">All outbound emails (automations, sequences, conversations) go out through this account.</p>`
            : `<div class="muted">● Simulated — emails are logged to conversations but not delivered.</div>
               <p class="muted small" style="margin-top:8px">To connect your Google account, set these on the server and restart:</p>
               <pre class="small" style="background:var(--surface-2);padding:10px;border-radius:8px;overflow-x:auto;margin-top:6px">SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=you@yourdomain.com
SMTP_PASS=&lt;Google App Password&gt;
SMTP_FROM="BlackSync Capital &lt;you@yourdomain.com&gt;"</pre>
               <p class="muted small" style="margin-top:6px">App password: Google Account → Security → 2-Step Verification → App passwords.</p>`}
        </div>
        <div class="card"><h3>Tags in use</h3>
          ${tags.map(t => `<span class="tag">${esc(t.tag)} · ${t.count}</span>`).join('') || '<div class="muted small">none</div>'}
        </div>
      </div>`);

    document.getElementById('cf-add').addEventListener('click', async () => {
      const name = v('cf-name'); if (!name) return;
      await api('/custom-fields', { method: 'POST', body: { name, key: name.toLowerCase().replace(/\W+/g, '_'), type: v('cf-type') } });
      renderSettings();
    });
    document.getElementById('sl-add').addEventListener('click', async () => {
      const name = v('sl-name'); if (!name) return;
      const filters = {};
      if (v('sl-tag')) filters.tag = v('sl-tag');
      if (v('sl-score')) filters.minScore = Number(v('sl-score'));
      await api('/smart-lists', { method: 'POST', body: { name, filters } });
      renderSettings();
    });
    document.getElementById('ak-add').addEventListener('click', async () => {
      await api('/api-keys', { method: 'POST', body: { name: v('ak-name') || 'default' } });
      renderSettings();
    });
    document.querySelectorAll('[data-delfield]').forEach(a => a.addEventListener('click', async e => {
      e.preventDefault(); await api('/custom-fields/' + a.dataset.delfield, { method: 'DELETE' }); renderSettings();
    }));
    document.querySelectorAll('[data-dellist]').forEach(a => a.addEventListener('click', async e => {
      e.preventDefault(); await api('/smart-lists/' + a.dataset.dellist, { method: 'DELETE' }); renderSettings();
    }));
    document.querySelectorAll('[data-delkey]').forEach(a => a.addEventListener('click', async e => {
      e.preventDefault(); await api('/api-keys/' + a.dataset.delkey, { method: 'DELETE' }); renderSettings();
    }));
  }

  // ------------------------------------------------------------------ agency
  async function renderAgency() {
    const { locations } = await api('/agency/overview');
    setMain(`
      <div class="page-head"><h2>Sub-accounts</h2><span class="muted">${locations.length} locations under BlackSync</span>
        <div class="spacer"></div><button class="btn primary" id="ag-add">+ Sub-account</button></div>
      <div class="grid loc-grid">
        ${locations.map(l => `
          <div class="card loc-card">
            <div class="head"><div class="ic">${esc((l.name || '?')[0])}</div>
              <div><strong>${esc(l.name)}</strong><div class="muted small">${esc(l.industry || '—')}</div></div></div>
            <div class="stats">
              <div class="stat"><div class="v tnum">${l.contacts}</div><div class="l">contacts</div></div>
              <div class="stat"><div class="v tnum">${l.openOpportunities}</div><div class="l">open deals</div></div>
              <div class="stat"><div class="v tnum">${money(l.pipelineValue)}</div><div class="l">pipeline</div></div>
              <div class="stat"><div class="v tnum">${money(l.wonValue)}</div><div class="l">won</div></div>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn small" data-open="${l.id}">Open →</button>
              <button class="btn small" data-clone="${l.id}">Clone as snapshot</button>
            </div>
          </div>`).join('')}
      </div>`);

    const openCreate = (snapshotFromLocationId) => {
      const src = snapshotFromLocationId && locations.find(l => l.id === snapshotFromLocationId);
      modal(`
        <h3>New sub-account${src ? ` — snapshot of ${esc(src.name)}` : ''}</h3>
        <div class="field"><label>Business name</label><input id="m-name"></div>
        <div class="row">
          <div class="field"><label>Industry</label><input id="m-industry"></div>
          <div class="field"><label>Phone</label><input id="m-phone"></div>
        </div>
        <div class="field"><label>Snapshot from</label>
          <select id="m-snap">
            <option value="">Blank (default pipeline)</option>
            ${locations.map(l => `<option value="${l.id}" ${l.id === snapshotFromLocationId ? 'selected' : ''}>${esc(l.name)} — pipelines, automations, fields</option>`).join('')}
          </select></div>
        <div class="modal-actions">
          <button class="btn" id="m-cancel">Cancel</button><button class="btn primary" id="m-save">Create</button>
        </div>`);
      document.getElementById('m-cancel').addEventListener('click', closeModal);
      document.getElementById('m-save').addEventListener('click', async () => {
        try {
          const created = await api('/agency/locations', {
            method: 'POST',
            body: { name: v('m-name'), industry: v('m-industry'), phone: v('m-phone'), snapshotFromLocationId: v('m-snap') || undefined }
          });
          closeModal(); toast(`Sub-account "${created.name}" created`);
          const me = await api('/auth/me');
          state.locations = me.locations;
          renderAgency();
        } catch (e) { toast(e.message, true); }
      });
    };
    document.getElementById('ag-add').addEventListener('click', () => openCreate());
    document.querySelectorAll('[data-clone]').forEach(b => b.addEventListener('click', () => openCreate(b.dataset.clone)));
    document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
      state.locationId = b.dataset.open;
      localStorage.setItem('bs_location', state.locationId);
      location.hash = '#/dashboard';
      render();
    }));
  }

  // ------------------------------------------------------------------ router
  function currentLocation() {
    return state.locations.find(l => l.id === state.locationId) || { name: '' };
  }

  function setMain(html) {
    document.getElementById('main').innerHTML = html;
  }

  const VIEWS = {
    dashboard: renderDashboard,
    contacts: () => renderContacts(),
    conversations: renderConversations,
    pipeline: renderPipeline,
    dialer: renderDialer,
    calendar: renderCalendar,
    tasks: renderTasks,
    automations: renderAutomations,
    sequences: renderSequences,
    settings: renderSettings,
    agency: renderAgency
  };

  async function render() {
    document.body.classList.toggle('light', state.theme === 'light');
    closeModal(); closeDrawer();
    if (!state.token) return renderLogin();
    if (!state.user) {
      try {
        const me = await api('/auth/me');
        state.user = me.user; state.locations = me.locations;
        if (!state.locationId || !me.locations.find(l => l.id === state.locationId)) {
          state.locationId = me.locations[0] ? me.locations[0].id : null;
          localStorage.setItem('bs_location', state.locationId || '');
        }
      } catch { return; /* logout already triggered */ }
    }
    $app.innerHTML = shell('<div class="empty">Loading…</div>');
    bindShell();
    const view = VIEWS[state.route] || renderDashboard;
    try { await view(); }
    catch (e) { setMain(`<div class="empty">⚠ ${esc(e.message)}</div>`); }
  }

  window.addEventListener('hashchange', () => {
    state.route = location.hash.replace('#/', '') || 'dashboard';
    state.convoId = state.route === 'conversations' ? state.convoId : null;
    render();
  });

  render();
})();
