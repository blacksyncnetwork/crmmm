// Real email delivery via SMTP — designed for Google Workspace / Gmail:
//   SMTP_HOST=smtp.gmail.com  SMTP_PORT=465
//   SMTP_USER=you@yourdomain.com
//   SMTP_PASS=<Google App Password>          (Google Account → Security →
//                                             2-Step Verification → App passwords)
//   SMTP_FROM="BlackSync Capital <you@yourdomain.com>"   (optional)
//
// Without these vars the CRM stays in simulated mode: every send is recorded
// in the conversation with status 'simulated' instead of going out.

const nodemailer = require('nodemailer');

let transport = null;

function configured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport() {
  if (!configured()) return null;
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transport;
}

async function send({ to, subject, text, fromName }) {
  const t = getTransport();
  if (!t) throw new Error('smtp not configured');
  const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER;
  const from = fromName && !/</.test(fromAddr) ? `"${fromName}" <${fromAddr}>` : fromAddr;
  return t.sendMail({ from, to, subject: subject || '(no subject)', text: text || '' });
}

module.exports = { configured, send };
