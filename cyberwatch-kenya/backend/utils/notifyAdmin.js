/**
 * utils/notifyAdmin.js
 * Sends Samuel an instant notification when someone new subscribes
 */

const axios = require('axios');
const AfricasTalking = require('africastalking');

const SAMUEL_PHONE = '+254743355434';
const SAMUEL_EMAIL = 'securedatakenya@gmail.com';

const AT = AfricasTalking({
  apiKey:   process.env.AT_API_KEY,
  username: process.env.AT_USERNAME
});

// ── NOTIFY VIA SMS ───────────────────────────
async function notifyAdminSMS(message) {
  try {
    const options = { to: [SAMUEL_PHONE], message };
    if (process.env.AT_SENDER_ID) options.from = process.env.AT_SENDER_ID;
    await AT.SMS.send(options);
    console.log('📱 Admin SMS notification sent');
  } catch (err) {
    console.error('Admin SMS notification error:', err.message);
  }
}

// ── NOTIFY VIA EMAIL ─────────────────────────
async function notifyAdminEmail(subject, html) {
  try {
    await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: 'CyberWatch Kenya', email: 'securedatakenya@gmail.com' },
        to: [{ email: SAMUEL_EMAIL, name: 'Samuel Adikah' }],
        subject,
        htmlContent: html
      },
      { headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' } }
    );
    console.log('📧 Admin email notification sent');
  } catch (err) {
    console.error('Admin email notification error:', err.message);
  }
}

// ── NEW SUBSCRIBER NOTIFICATION ──────────────
async function notifyNewSubscriber(subscriber) {
  const plan      = subscriber.plan === 'premium' ? '⭐ PREMIUM' : '📡 FREE';
  const planColor = subscriber.plan === 'premium' ? '#00ccff' : '#00ff41';
  const revenue   = subscriber.plan === 'premium' ? '+KSh 99/month 💰' : 'Free';

  // SMS to Samuel
  const smsMsg =
    `🛡️ CyberWatch Kenya\n` +
    `NEW SUBSCRIBER! 🎉\n\n` +
    `Name: ${subscriber.name}\n` +
    `Plan: ${subscriber.plan === 'premium' ? 'PREMIUM ⭐' : 'FREE'}\n` +
    (subscriber.plan === 'premium' ? `Revenue: +KSh 99/month\n` : '') +
    `Total subscribers growing! 🇰🇪`;

  // Email to Samuel
  const emailHTML = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#050a05;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#050a05;padding:32px 0;">
  <tr><td align="center">
    <table width="500" cellpadding="0" cellspacing="0" style="max-width:500px;width:100%;">
      <tr>
        <td style="background:linear-gradient(135deg,#0a1a0a,#0d2010);border-radius:12px 12px 0 0;padding:32px;text-align:center;border:1px solid #1a3a1a;border-bottom:none;">
          <div style="font-size:48px;margin-bottom:12px;">🎉</div>
          <h1 style="margin:0 0 6px;font-size:22px;color:#fff;font-weight:800;">New Subscriber!</h1>
          <p style="margin:0;font-size:13px;color:#557755;font-family:'Courier New',monospace;">CYBERWATCH KENYA IS GROWING</p>
        </td>
      </tr>
      <tr>
        <td style="background:${planColor};padding:12px 32px;border-left:1px solid #1a3a1a;border-right:1px solid #1a3a1a;">
          <p style="margin:0;font-size:13px;color:#000;font-weight:800;text-align:center;letter-spacing:1px;">
            ${plan} — ${revenue}
          </p>
        </td>
      </tr>
      <tr>
        <td style="background:#0a150a;padding:28px 32px;border:1px solid #1a3a1a;border-top:none;border-bottom:none;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#050f05;border:1px solid #1a3a1a;border-radius:8px;">
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid #1a2a1a;font-size:13px;">
                <span style="color:#557755;">Name</span>
                <span style="color:#fff;font-weight:700;float:right;">${subscriber.name}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid #1a2a1a;font-size:13px;">
                <span style="color:#557755;">Email</span>
                <span style="color:#fff;float:right;">${subscriber.email}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid #1a2a1a;font-size:13px;">
                <span style="color:#557755;">Plan</span>
                <span style="float:right;background:${planColor};color:#000;font-size:11px;font-weight:800;padding:3px 10px;border-radius:10px;">${plan}</span>
              </td>
            </tr>
            ${subscriber.phone ? `
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid #1a2a1a;font-size:13px;">
                <span style="color:#557755;">Phone</span>
                <span style="color:#fff;float:right;">📱 ${subscriber.phone}</span>
              </td>
            </tr>` : ''}
            <tr>
              <td style="padding:16px 20px;font-size:13px;">
                <span style="color:#557755;">Joined</span>
                <span style="color:#fff;float:right;">${new Date().toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </td>
            </tr>
          </table>
          <div style="text-align:center;margin-top:24px;">
            <a href="https://cyberwatch-kenya.onrender.com/dashboard.html"
              style="display:inline-block;background:#00ff41;color:#000;font-size:13px;font-weight:800;text-decoration:none;padding:12px 28px;border-radius:8px;font-family:'Courier New',monospace;">
              View Dashboard →
            </a>
          </div>
        </td>
      </tr>
      <tr>
        <td style="background:#030803;border:1px solid #1a3a1a;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#334433;font-family:'Courier New',monospace;">
            🛡️ CYBERWATCH KENYA — ADMIN NOTIFICATION
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  // Send both simultaneously
  await Promise.allSettled([
    notifyAdminSMS(smsMsg),
    notifyAdminEmail(`🎉 New ${subscriber.plan === 'premium' ? 'Premium ⭐' : 'Free'} Subscriber — ${subscriber.name}`, emailHTML)
  ]);
}

// ── NEW SCAM REPORT NOTIFICATION ─────────────
async function notifyNewReport(report) {
  const smsMsg =
    `🚨 NEW SCAM REPORT!\n\n` +
    `From: ${report.reporterName}\n` +
    `Type: ${report.scamType}\n` +
    `County: ${report.county || 'Not specified'}\n` +
    `Amount: ${report.amountLost > 0 ? 'KSh ' + report.amountLost.toLocaleString() : 'None'}\n\n` +
    `Review on your dashboard.`;

  const emailHTML = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#050a05;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#050a05;padding:32px 0;">
  <tr><td align="center">
    <table width="500" cellpadding="0" cellspacing="0" style="max-width:500px;width:100%;">
      <tr>
        <td style="background:linear-gradient(135deg,#1a0000,#2d0505);border-radius:12px 12px 0 0;padding:32px;text-align:center;border:1px solid rgba(255,34,68,0.3);border-bottom:none;">
          <div style="font-size:48px;margin-bottom:12px;">🚨</div>
          <h1 style="margin:0 0 6px;font-size:22px;color:#fff;font-weight:800;">New Scam Report!</h1>
          <p style="margin:0;font-size:13px;color:#ff2244;font-family:'Courier New',monospace;">NEEDS YOUR REVIEW</p>
        </td>
      </tr>
      <tr>
        <td style="background:#ff2244;padding:12px 32px;border-left:1px solid rgba(255,34,68,0.3);border-right:1px solid rgba(255,34,68,0.3);">
          <p style="margin:0;font-size:13px;color:#fff;font-weight:800;text-align:center;">${report.scamType.toUpperCase()}</p>
        </td>
      </tr>
      <tr>
        <td style="background:#0a0505;padding:28px 32px;border:1px solid rgba(255,34,68,0.2);border-top:none;border-bottom:none;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#050505;border:1px solid #2a1010;border-radius:8px;">
            <tr><td style="padding:14px 18px;border-bottom:1px solid #1a0a0a;font-size:13px;">
              <span style="color:#888;">From</span>
              <span style="color:#fff;font-weight:700;float:right;">${report.reporterName}</span>
            </td></tr>
            <tr><td style="padding:14px 18px;border-bottom:1px solid #1a0a0a;font-size:13px;">
              <span style="color:#888;">Type</span>
              <span style="color:#ff2244;font-weight:700;float:right;">${report.scamType}</span>
            </td></tr>
            <tr><td style="padding:14px 18px;border-bottom:1px solid #1a0a0a;font-size:13px;">
              <span style="color:#888;">County</span>
              <span style="color:#fff;float:right;">${report.county || 'Not specified'}</span>
            </td></tr>
            <tr><td style="padding:14px 18px;border-bottom:1px solid #1a0a0a;font-size:13px;">
              <span style="color:#888;">Amount Lost</span>
              <span style="color:${report.amountLost > 0 ? '#ff4444' : '#888'};float:right;font-weight:${report.amountLost > 0 ? '700' : '400'};">
                ${report.amountLost > 0 ? 'KSh ' + report.amountLost.toLocaleString() : 'None'}
              </span>
            </td></tr>
            <tr><td style="padding:14px 18px;font-size:13px;">
              <span style="color:#888;">Email</span>
              <span style="color:#fff;float:right;">${report.reporterEmail || 'Not provided'}</span>
            </td></tr>
          </table>
          <div style="margin-top:16px;background:#0d0505;border:1px solid #2a1010;border-radius:8px;padding:16px;">
            <p style="margin:0 0 8px;font-size:11px;color:#ff2244;letter-spacing:1px;font-family:'Courier New',monospace;">DESCRIPTION</p>
            <p style="margin:0;font-size:13px;color:#aabbaa;line-height:1.7;">${report.description.substring(0, 300)}${report.description.length > 300 ? '...' : ''}</p>
          </div>
          <div style="text-align:center;margin-top:20px;">
            <a href="https://cyberwatch-kenya.onrender.com/dashboard.html"
              style="display:inline-block;background:#ff2244;color:#fff;font-size:13px;font-weight:800;text-decoration:none;padding:12px 28px;border-radius:8px;">
              Review on Dashboard →
            </a>
          </div>
        </td>
      </tr>
      <tr>
        <td style="background:#030303;border:1px solid #1a1a1a;border-radius:0 0 12px 12px;padding:16px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#334433;font-family:'Courier New',monospace;">🛡️ CYBERWATCH KENYA — ADMIN NOTIFICATION</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  // Send both SMS and email simultaneously
  await Promise.allSettled([
    notifyAdminSMS(smsMsg),
    notifyAdminEmail(`🚨 New Scam Report — ${report.scamType} from ${report.reporterName}`, emailHTML)
  ]);
  console.log(`🚨 Admin notified of new scam report from ${report.reporterName}`);
}

module.exports = { notifyNewSubscriber, notifyNewReport };
