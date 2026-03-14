/**
 * routes/subscriberRoutes.js
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const Subscriber = require('../models/Subscriber');
const ScamReport = require('../models/ScamReport');
const { protect } = require('../middleware/authMiddleware');
const Subscription = require('../models/Subscription');

// ── PUBLIC: SUBSCRIBE ──────────────────────────
router.post('/subscribe', [
  body('name').notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { name, email } = req.body;
    const existing = await Subscriber.findOne({ email: email.toLowerCase() });
    if (existing) {
      // Already active - don't allow duplicate
      if (existing.active) {
        return res.status(400).json({ success: false, message: 'This email is already subscribed. Check your inbox for scam alerts!' });
      }
      // Was unsubscribed — check if they had a valid premium subscription
      existing.active = true;
      existing.name = name;
      if (req.body.phone) existing.phone = req.body.phone;

      if (existing.plan === 'premium') {
        // Check if their paid subscription is still valid
        const activeSub = await Subscription.findOne({
          subscriber: existing._id,
          status: 'active',
          expiryDate: { $gt: new Date() }
        });
        if (!activeSub) {
          // Premium expired — downgrade to free
          existing.plan = 'free';
        }
      }

      await existing.save();
      sendFreeWelcomeEmail(existing).catch(e => console.error('Welcome email error:', e.message));
      const msg = existing.plan === 'premium'
        ? 'Welcome back, Premium member! Your active subscription has been restored.'
        : 'Welcome back! You have been re-subscribed for free.';
      return res.json({ success: true, message: msg, plan: existing.plan });
    }

    // Brand new subscriber
    const phone = req.body.phone || null;
    const subscriber = await Subscriber.create({ name, email, plan: 'free', phone });
    sendFreeWelcomeEmail(subscriber).catch(e => console.error('Welcome email error:', e.message));
    res.status(201).json({ success: true, message: '✅ Successfully subscribed!' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ── PUBLIC: UNSUBSCRIBE ─────────────────────────
router.get('/unsubscribe/:token', async (req, res) => {
  try {
    const subscriber = await Subscriber.findOne({ unsubscribeToken: req.params.token });
    if (!subscriber) return res.status(404).send('<h2>Invalid unsubscribe link.</h2>');
    subscriber.active = false;
    await subscriber.save();
    res.send(`<!DOCTYPE html><html><head><style>body{font-family:Arial;background:#0a0a0a;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.box{text-align:center;padding:40px;border:1px solid #333;border-radius:8px;max-width:400px}h2{color:#00ff41}a{color:#00ff41}</style></head><body><div class="box"><h2>Unsubscribed</h2><p>You have been unsubscribed from CyberWatch Kenya alerts.</p><p><a href="/">Subscribe again</a></p></div></body></html>`);
  } catch (error) {
    res.status(500).send('<h2>Server error</h2>');
  }
});

// ── PUBLIC: SUBMIT SCAM REPORT ──────────────────
router.post('/report-scam', [
  body('reporterName').notEmpty().withMessage('Your name is required'),
  body('scamType').notEmpty().withMessage('Scam type is required'),
  body('description').isLength({ min: 30 }).withMessage('Please provide at least 30 characters describing the scam')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { reporterName, reporterEmail, scamType, description, amountLost, platform } = req.body;
    await ScamReport.create({ reporterName, reporterEmail, scamType, description, amountLost, platform });
    res.status(201).json({ success: true, message: '✅ Thank you for your report! Our team will review it shortly.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── PUBLIC: GET SUBSCRIBER COUNT ───────────────
router.get('/count', async (req, res) => {
  try {
    const count = await Subscriber.countDocuments({ active: true });
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, count: 0 });
  }
});

// ── PUBLIC: GET REPORTS COUNT ───────────────────
router.get('/reports/count', async (req, res) => {
  try {
    const count = await ScamReport.countDocuments();
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, count: 0 });
  }
});

// ── ADMIN: GET ALL SUBSCRIBERS ──────────────────
router.get('/admin/list', protect, async (req, res) => {
  try {
    const subscribers = await Subscriber.find().sort({ createdAt: -1 });
    res.json({ success: true, data: subscribers, total: subscribers.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── ADMIN: GET SCAM REPORTS ─────────────────────
router.get('/admin/reports', protect, async (req, res) => {
  try {
    const reports = await ScamReport.find().sort({ createdAt: -1 });
    res.json({ success: true, data: reports });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── ADMIN: PUBLISH REPORT → EMAIL ALL SUBSCRIBERS ──
// PUT /api/subscribers/admin/reports/:id/publish
router.put('/admin/reports/:id/publish', protect, async (req, res) => {
  try {
    // 1. Get the report
    const report = await ScamReport.findById(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: 'Report not found' });
    if (report.status === 'published') return res.status(400).json({ success: false, message: 'Already published' });

    // 2. Mark as published
    report.status = 'published';
    await report.save();

    // 3. Get all active subscribers
    const subscribers = await Subscriber.find({ active: true });
    if (subscribers.length === 0) {
      return res.json({ success: true, message: 'Published but no active subscribers to email.', sent: 0 });
    }

    // 4. Send alert email to every active subscriber via Brevo
    const amountText = report.amountLost > 0
      ? `KSh ${Number(report.amountLost).toLocaleString()}`
      : 'Not disclosed';

    let sent = 0;
    let failed = 0;

    for (const subscriber of subscribers) {
      try {
        await axios.post(
          'https://api.brevo.com/v3/smtp/email',
          {
            sender: { name: 'CyberWatch Kenya', email: 'securedatakenya@gmail.com' },
            to: [{ email: subscriber.email, name: subscriber.name }],
            subject: `🚨 SCAM ALERT: ${report.scamType} — CyberWatch Kenya`,
            htmlContent: buildAlertEmail(subscriber, report, amountText)
          },
          {
            headers: {
              'api-key': process.env.BREVO_API_KEY,
              'Content-Type': 'application/json'
            }
          }
        );
        sent++;
      } catch (emailErr) {
        console.error(`Failed to send to ${subscriber.email}:`, emailErr.response?.data || emailErr.message);
        failed++;
      }
    }

    console.log(`📢 Report published — ${sent} emails sent, ${failed} failed`);
    res.json({ success: true, message: `✅ Published! Alert sent to ${sent} subscriber${sent !== 1 ? 's' : ''}.`, sent, failed });

  } catch (error) {
    console.error('Publish error full:', error.message, error.stack);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
});

// ─────────────────────────────────────────────
// BUILD ALERT EMAIL HTML
// ─────────────────────────────────────────────
function buildAlertEmail(subscriber, report, amountText) {
  const siteUrl = process.env.SITE_URL || 'http://localhost:5000';
  const unsubUrl = `${siteUrl}/api/subscribers/unsubscribe/${subscriber.unsubscribeToken || ''}`;
  const firstName = subscriber.name.split(' ')[0];

  // Severity color based on scam type
  const severityColors = {
    'Mobile Money Scam': '#ff6600',
    'Phishing':          '#ff2244',
    'Crypto Scam':       '#ff2244',
    'Employment Scam':   '#ffcc00',
    'Romance Scam':      '#ff6600',
    'E-commerce Fraud':  '#ffcc00',
    'Investment Scam':   '#ff2244',
    'Impersonation':     '#ff6600',
    'Online Fraud':      '#ffcc00',
  };
  const alertColor = severityColors[report.scamType] || '#ff2244';

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#050a05;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#050a05;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- HEADER -->
      <tr>
        <td style="background:linear-gradient(135deg,#1a0000 0%,#2d0505 50%,#1a0000 100%);border-radius:12px 12px 0 0;padding:40px;text-align:center;border:1px solid #3a1010;border-bottom:none;">
          <div style="background:rgba(255,34,68,0.15);border:2px solid rgba(255,34,68,0.5);border-radius:50%;width:80px;height:80px;line-height:80px;font-size:40px;margin:0 auto 16px;">🚨</div>
          <p style="margin:0 0 8px;font-size:11px;color:#00ff41;letter-spacing:3px;font-family:'Courier New',monospace;">🛡️ CYBERWATCH KENYA</p>
          <h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#ffffff;">SCAM ALERT</h1>
          <div style="display:inline-block;background:${alertColor};color:#000;font-size:13px;font-weight:800;padding:6px 20px;border-radius:20px;letter-spacing:1px;">
            ${report.scamType.toUpperCase()}
          </div>
        </td>
      </tr>

      <!-- RED BAND -->
      <tr>
        <td style="background:${alertColor};padding:14px 40px;border-left:1px solid #3a1010;border-right:1px solid #3a1010;">
          <p style="margin:0;font-size:13px;color:#000;font-weight:800;text-align:center;letter-spacing:1px;">
            ⚠️ ACTIVE THREAT — KENYANS ARE BEING TARGETED RIGHT NOW
          </p>
        </td>
      </tr>

      <!-- BODY -->
      <tr>
        <td style="background:#0a0505;padding:40px;border:1px solid #3a1010;border-top:none;border-bottom:none;">

          <p style="font-size:15px;color:#ccddcc;line-height:1.8;margin:0 0 24px;">
            Hi <strong style="color:#fff;">${firstName}</strong>, our monitoring team has detected an active scam targeting Kenyans. Here are the full details:
          </p>

          <!-- Alert details card -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#050505;border:1px solid ${alertColor};border-radius:8px;overflow:hidden;margin-bottom:28px;">
            <tr>
              <td style="background:rgba(255,34,68,0.1);padding:12px 20px;border-bottom:1px solid #2a1010;">
                <p style="margin:0;font-size:11px;color:${alertColor};letter-spacing:2px;font-family:'Courier New',monospace;">THREAT INTELLIGENCE REPORT</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:8px 0;border-bottom:1px solid #1a0a0a;font-size:13px;color:#888;width:40%;">Scam Type</td>
                    <td style="padding:8px 0;border-bottom:1px solid #1a0a0a;text-align:right;">
                      <span style="background:${alertColor};color:#000;font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;">${report.scamType}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;border-bottom:1px solid #1a0a0a;font-size:13px;color:#888;">Platform</td>
                    <td style="padding:8px 0;border-bottom:1px solid #1a0a0a;text-align:right;font-size:13px;color:#fff;">${report.platform || 'Not specified'}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;font-size:13px;color:#888;">Amount Lost</td>
                    <td style="padding:8px 0;text-align:right;font-size:13px;color:${report.amountLost > 0 ? '#ff4444' : '#888'};font-weight:${report.amountLost > 0 ? '700' : '400'};">${amountText}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- Description -->
          <h3 style="margin:0 0 12px;font-size:16px;color:#ff4444;font-family:'Courier New',monospace;letter-spacing:1px;">// HOW THIS SCAM WORKS</h3>
          <div style="background:#0d0505;border:1px solid #2a1010;border-left:4px solid ${alertColor};border-radius:0 8px 8px 0;padding:20px;margin-bottom:28px;">
            <p style="margin:0;font-size:14px;color:#ccddcc;line-height:1.9;white-space:pre-wrap;">${escapeHtml(report.description)}</p>
          </div>

          <!-- How to protect yourself -->
          <h3 style="margin:0 0 12px;font-size:16px;color:#00ff41;font-family:'Courier New',monospace;letter-spacing:1px;">// HOW TO PROTECT YOURSELF</h3>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#050f05;border:1px solid #1e3a1e;border-radius:8px;padding:20px;margin-bottom:28px;">
            <tr><td style="padding:0;">
              <p style="margin:0 0 10px;font-size:14px;color:#ccddcc;line-height:1.7;">🔴 <strong style="color:#fff;">Do NOT</strong> share personal information with unknown contacts</p>
              <p style="margin:0 0 10px;font-size:14px;color:#ccddcc;line-height:1.7;">🔴 <strong style="color:#fff;">Do NOT</strong> send money to anyone you haven't physically verified</p>
              <p style="margin:0 0 10px;font-size:14px;color:#ccddcc;line-height:1.7;">🔴 <strong style="color:#fff;">Do NOT</strong> click suspicious links or download unknown files</p>
              <p style="margin:0 0 10px;font-size:14px;color:#ccddcc;line-height:1.7;">✅ <strong style="color:#00ff41;">DO</strong> verify all job offers and investment opportunities independently</p>
              <p style="margin:0;font-size:14px;color:#ccddcc;line-height:1.7;">✅ <strong style="color:#00ff41;">DO</strong> report scams to DCI Kenya: <strong style="color:#fff;">cybercrime@dci.go.ke</strong></p>
            </td></tr>
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr><td align="center">
              <a href="${siteUrl}" style="display:inline-block;background:#00ff41;color:#000;font-size:15px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:8px;">
                🛡️ View All Scam Alerts →
              </a>
            </td></tr>
          </table>

        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td style="background:#030303;border:1px solid #1a1a1a;border-radius:0 0 12px 12px;padding:28px 40px;text-align:center;">
          <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">🛡️ CyberWatch Kenya</p>
          <p style="margin:0 0 16px;font-size:12px;color:#444;">Protecting Kenyans Online Since 2024</p>
          <p style="margin:0;font-size:11px;color:#333;">
            You received this because you are a CyberWatch Kenya subscriber.<br>
            <a href="${unsubUrl}" style="color:#555;">Unsubscribe</a>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ─────────────────────────────────────────────
// FREE WELCOME EMAIL
// ─────────────────────────────────────────────
async function sendFreeWelcomeEmail(subscriber) {
  const siteUrl = process.env.SITE_URL || 'http://localhost:5000';
  const firstName = subscriber.name.split(' ')[0];

  await axios.post(
    'https://api.brevo.com/v3/smtp/email',
    {
      sender: { name: 'CyberWatch Kenya', email: 'securedatakenya@gmail.com' },
      to: [{ email: subscriber.email, name: subscriber.name }],
      subject: `🛡️ Welcome to CyberWatch Kenya, ${firstName}! You're now protected.`,
      htmlContent: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#050a05;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#050a05;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- HEADER -->
      <tr>
        <td style="background:linear-gradient(135deg,#0a1a0a 0%,#0d2010 50%,#0a1a0a 100%);border-radius:12px 12px 0 0;padding:48px 40px 40px;text-align:center;border:1px solid #1a3a1a;border-bottom:none;">
          <div style="background:rgba(0,255,65,0.1);border:2px solid rgba(0,255,65,0.4);border-radius:50%;width:80px;height:80px;line-height:80px;font-size:40px;margin:0 auto 20px;">🛡️</div>
          <h1 style="margin:0 0 4px;font-size:28px;font-weight:800;color:#ffffff;">CyberWatch <span style="color:#00ff41;">Kenya</span></h1>
          <p style="margin:0 0 24px;font-size:12px;color:#00ff41;letter-spacing:3px;font-family:'Courier New',monospace;">CYBERSECURITY INTELLIGENCE</p>
          <h2 style="margin:0 0 12px;font-size:24px;color:#ffffff;font-weight:700;">Welcome, ${firstName}! 🎉</h2>
          <p style="margin:0;font-size:16px;color:#aad4aa;line-height:1.6;">You are now subscribed to Kenya's most trusted<br>cybersecurity alert network — <strong style="color:#00ff41;">for free</strong>.</p>
        </td>
      </tr>

      <!-- GREEN BAND -->
      <tr>
        <td style="background:#00ff41;padding:14px 40px;border-left:1px solid #1a3a1a;border-right:1px solid #1a3a1a;">
          <p style="margin:0;font-size:13px;color:#000;font-weight:700;text-align:center;">🔒 FREE FOREVER &nbsp;|&nbsp; NO CREDIT CARD &nbsp;|&nbsp; CANCEL ANYTIME</p>
        </td>
      </tr>

      <!-- BODY -->
      <tr>
        <td style="background:#0a150a;padding:40px;border:1px solid #1a3a1a;border-top:none;border-bottom:none;">

          <h3 style="margin:0 0 16px;font-size:16px;color:#00ff41;font-family:'Courier New',monospace;letter-spacing:1px;">// WHAT YOU'LL RECEIVE</h3>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="padding:0 0 10px;">
              <table width="100%" cellpadding="14" style="background:#0d1f0d;border:1px solid #1e3a1e;border-radius:8px;">
                <tr>
                  <td width="40" style="font-size:24px;vertical-align:middle;padding-right:12px;">🚨</td>
                  <td style="vertical-align:middle;padding:0;"><p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#fff;">Real-Time Scam Alerts</p><p style="margin:0;font-size:12px;color:#88aa88;">Instant alerts when new threats target Kenyans</p></td>
                </tr>
              </table>
            </td></tr>
            <tr><td style="padding:0 0 10px;">
              <table width="100%" cellpadding="14" style="background:#0d1f0d;border:1px solid #1e3a1e;border-radius:8px;">
                <tr>
                  <td width="40" style="font-size:24px;vertical-align:middle;padding-right:12px;">📱</td>
                  <td style="vertical-align:middle;padding:0;"><p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#fff;">M-PESA Fraud Warnings</p><p style="margin:0;font-size:12px;color:#88aa88;">SIM swap, fake Safaricom agents, mobile money scams</p></td>
                </tr>
              </table>
            </td></tr>
            <tr><td>
              <table width="100%" cellpadding="14" style="background:#0d1f0d;border:1px solid #1e3a1e;border-radius:8px;">
                <tr>
                  <td width="40" style="font-size:24px;vertical-align:middle;padding-right:12px;">🔐</td>
                  <td style="vertical-align:middle;padding:0;"><p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#fff;">Weekly Security Tips</p><p style="margin:0;font-size:12px;color:#88aa88;">Practical advice to keep your accounts safe</p></td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- Upgrade nudge -->
          <table width="100%" cellpadding="20" style="background:rgba(0,204,255,0.05);border:1px solid rgba(0,204,255,0.2);border-radius:8px;margin-bottom:28px;">
            <tr><td>
              <p style="margin:0 0 6px;font-size:12px;color:#00ccff;letter-spacing:1px;font-family:'Courier New',monospace;">⭐ WANT MORE?</p>
              <p style="margin:0 0 12px;font-size:14px;color:#ccddcc;line-height:1.7;">Upgrade to <strong style="color:#00ccff;">Premium for just KSh 99/month</strong> to get priority alerts, support our mission, and help us keep protecting Kenyans.</p>
              <a href="${siteUrl}/subscribe.html?upgrade=true" style="display:inline-block;background:#00ccff;color:#000;font-size:13px;font-weight:800;text-decoration:none;padding:10px 24px;border-radius:6px;">⭐ Upgrade to Premium →</a>
            </td></tr>
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center">
              <a href="${siteUrl}" style="display:inline-block;background:#00ff41;color:#000;font-size:15px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:8px;">🛡️ Visit CyberWatch Kenya →</a>
            </td></tr>
          </table>

          <!-- Security tip -->
          <table width="100%" cellpadding="16" style="background:#050f05;border-left:4px solid #00ff41;border-radius:0 8px 8px 0;margin-top:24px;">
            <tr><td>
              <p style="margin:0 0 6px;font-size:11px;color:#00ff41;letter-spacing:2px;font-family:'Courier New',monospace;">💡 FIRST SECURITY TIP</p>
              <p style="margin:0;font-size:14px;color:#ccddcc;line-height:1.7;"><strong style="color:#fff;">Enable two-factor authentication (2FA)</strong> on all your important accounts — Gmail, Facebook, and your bank app. This one step blocks 99% of account takeover attacks.</p>
            </td></tr>
          </table>

        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td style="background:#030803;border:1px solid #1a3a1a;border-radius:0 0 12px 12px;padding:28px 40px;text-align:center;">
          <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#fff;">🛡️ CyberWatch Kenya</p>
          <p style="margin:0 0 16px;font-size:12px;color:#557755;font-family:'Courier New',monospace;">Protecting Kenyans Online Since 2024</p>
          <p style="margin:0;font-size:11px;color:#334433;">You subscribed at CyberWatch Kenya.<br>
            <a href="${siteUrl}/api/subscribers/unsubscribe/${subscriber.unsubscribeToken}" style="color:#555;">Unsubscribe</a>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body></html>`
    },
    {
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      }
    }
  );
  console.log(`📧 Free welcome email sent to ${subscriber.email}`);
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
