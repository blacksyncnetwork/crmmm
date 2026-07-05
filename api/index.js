// Vercel serverless entrypoint — wraps the BlackSync CRM express app.
// All routes (API, webhooks, and the SPA) are rewritten here via vercel.json.
module.exports = require('../crm/server');
