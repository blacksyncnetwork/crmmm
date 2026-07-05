// BlackSync CRM — standalone server.
//   node crm/server.js            (or: npm run crm)
// Runs alongside the SRCA phone bridge; the bridge posts call events to
// /webhooks/calls so every phone call lands in the CRM automatically.

require('dotenv').config();
const path = require('path');
const express = require('express');
const { router: apiRouter } = require('./api');
const webhooks = require('./webhooks');
const { ensureSeed } = require('./seed');
const sequences = require('./lib/sequences');

const app = express();
app.use(express.json({ limit: '5mb' }));

// CORS for embedding forms / external dialers
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Location-Id, X-Api-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'blacksync-crm', uptime: process.uptime() }));

// Process due sequence steps opportunistically on traffic (covers serverless
// hosts where the interval timer below never runs between invocations).
app.use((req, res, next) => { sequences.lazyTick(); next(); });

app.use('/api', apiRouter);
app.use('/webhooks', webhooks);

// SPA
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const seeded = ensureSeed();
if (seeded) console.log('🌱 Seeded BlackSync demo data (admin@blacksync.capital / blacksync123)');

const PORT = process.env.CRM_PORT || process.env.PORT || 8090;
if (require.main === module) {
  sequences.startTicker();
  app.listen(PORT, () => console.log(`🚀 BlackSync CRM listening on :${PORT}`));
}

module.exports = app;
