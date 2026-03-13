/**
 * utils/weeklyDigest.js
 *
 * Sends a weekly scam digest every Monday at 8am to premium subscribers.
 * Summarises all scam alerts published in the past 7 days.
 */

const axios = require('axios');
const moment = require('moment');
const Newsletter = require('../models/Newsletter');
const Subscriber = require('../models/Subscriber');

async function sendWeeklyDigest() {
  try {
    console.log('📰 Starting weekly digest...');

    // Get all posts published in the last 7 days
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const posts = await Newsletter.find({
      published: true,
      createdAt: { $gte: oneWeekAgo }
    }).sort({ createdAt: -1 });

    if (posts.length === 0) {
      console.log('📰 No posts this week — skipping digest.');
      return;
    }

    // Get all active premium subscribers
    const subscribers = await Subscriber.find({ active: true, plan: 'premium' });
    if (subscribers.length === 0) {
      console.log('📰 No premium subscribers — skipping digest.');
      return;
    }

    const weekStart = moment(oneWeekAgo).format('Do MMM');
    const weekEnd   = moment().format('Do MMM YYYY');

    let sent = 0;
    let failed = 0;

    for (const subscriber of subscribers) {
      try {
        const html = buildDigestEmail(subscriber, posts, weekStart, weekEnd);
        await axios.post(
          'https://api.brevo.com/v3/smtp/email',
          {
            sender: { name: 'CyberWatch Kenya', email: 'securedatakenya@gmail.com' },
            to: [{ email: subscriber.email, name: subscriber.name }],
            subject: `⭐ Your Weekly Scam Digest — ${weekStart} to ${weekEnd}`,
            htmlContent: html
          },
          {
            headers: {
              'api-key': process.env.BREVO_API_KEY,
              'Content-Type': 'application/json'
            }
          }
        );
        sent++;
      } catch (err) {
        console.error(`Digest failed for ${subscriber.email}:`, err.response?.data || err.message);
        failed++;
      }
    }

    console.log(`📰 Weekly digest done — ${sent} sent, ${failed} failed, ${posts.length} alerts covered`);

  } catch (err) {
    console.error('Weekly digest error:', err.message);
  }
}

// ─────────────────────────────────────────────
// BUILD DIGEST EMAIL HTML
// ─────────────────────────────────────────────

function buildDigestEmail(subscriber, posts, weekStart, weekEnd) {
  const siteUrl     = process.env.SITE_URL || 'http://localhost:5000';
  const firstName   = subscriber.name.split(' ')[0];
  const unsubUrl    = `${siteUrl}/api/subscribers/unsubscribe/${subscriber.unsubscribeToken || ''}`;

  // Severity colors per category
  const categoryColors = {
    'Mobile Money Scam': '#ff6600',
    'Phishing':          '#ff2244',
    'Crypto Scam':       '#ff2244',
    'Employment Scam':   '#ffcc00',
    'Romance Scam':      '#ff6600',
    'E-commerce Fraud':  '#ffcc00',
    'Investment Scam':   '#ff2244',
    'Impersonation':     '#ff6600',
    'Online Fraud':      '#ffcc00',
    'Other':             '#888888'
  };

  // Build post cards
  const postCards = posts.map(post => {
    const color   = categoryColors[post.category] || '#888';
    const preview = post.description.length > 180
      ? post.description.substring(0, 180).trim() + '...'
      : post.description;

    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1a0d;border:1px solid #1e3a1e;border-left:4px solid ${color};border-radius:0 8px 8px 0;margin-bottom:16px;">
      <tr>
        <td style="padding:20px;">
          <div style="margin-bottom:8px;">
            <span style="background:${color};color:#000;font-size:10px;font-weight:800;padding:3px 10px;border-radius:10px;letter-spacing:1px;">${post.category.toUpperCase()}</span>
            <span style="font-size:11px;color:var(--muted);margin-left:10px;font-family:'Courier New',monospace;">${moment(post.createdAt).format('ddd Do MMM')}</span>
          </div>
          <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#ffffff;line-height:1.4;">${escapeHtml(post.title)}</p>
          <p style="margin:0;font-size:13px;color:#aabbaa;line-height:1.7;">${escapeHtml(preview)}</p>
        </td>
      </tr>
    </table>`;
  }).join('');

  // Threat level summary
  const highThreats = posts.filter(p => ['Phishing','Crypto Scam','Investment Scam'].includes(p.category)).length;
  const threatLevel = highThreats >= 3 ? { label: 'HIGH', color: '#ff2244' }
                    : highThreats >= 1 ? { label: 'MEDIUM', color: '#ffcc00' }
                    : { label: 'LOW', color: '#00ff41' };

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#050a05;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#050a05;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- HEADER -->
      <tr>
        <td style="background:linear-gradient(135deg,#0a1000 0%,#1a2000 50%,#0a1000 100%);border-radius:12px 12px 0 0;padding:40px;text-align:center;border:1px solid #2a3a00;border-bottom:none;">
          <p style="margin:0 0 8px;font-size:11px;color:#00ff41;letter-spacing:3px;font-family:'Courier New',monospace;">🛡️ CYBERWATCH KENYA</p>
          <h1 style="margin:0 0 4px;font-size:26px;font-weight:800;color:#ffffff;">Weekly Scam Digest</h1>
          <p style="margin:0 0 20px;font-size:13px;color:#aabb88;">${weekStart} — ${weekEnd}</p>
          <div style="display:inline-block;background:#00ccff;color:#000;font-size:11px;font-weight:800;padding:5px 16px;border-radius:20px;letter-spacing:1px;margin-bottom:16px;">⭐ PREMIUM MEMBERS ONLY</div>
          <p style="margin:0;font-size:14px;color:#aaccaa;line-height:1.6;">Hi <strong style="color:#fff;">${firstName}</strong>, here's your exclusive weekly summary of scam threats targeting Kenyans.</p>
        </td>
      </tr>

      <!-- CYAN BAND -->
      <tr>
        <td style="background:#00ccff;padding:14px 40px;border-left:1px solid #2a3a00;border-right:1px solid #2a3a00;">
          <p style="margin:0;font-size:13px;color:#000;font-weight:800;text-align:center;">⭐ YOUR PREMIUM WEEKLY DIGEST &nbsp;|&nbsp; ${posts.length} ALERT${posts.length !== 1 ? 'S' : ''} THIS WEEK</p>
        </td>
      </tr>

      <!-- BODY -->
      <tr>
        <td style="background:#0a1205;padding:40px;border:1px solid #2a3a00;border-top:none;border-bottom:none;">

          <!-- Threat level -->
          <table width="100%" cellpadding="20" style="background:#050f05;border:1px solid ${threatLevel.color};border-radius:8px;margin-bottom:28px;">
            <tr>
              <td>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <p style="margin:0 0 4px;font-size:11px;color:#888;letter-spacing:2px;font-family:'Courier New',monospace;">THIS WEEK'S THREAT LEVEL</p>
                      <p style="margin:0;font-size:24px;font-weight:800;color:${threatLevel.color};">🔴 ${threatLevel.label}</p>
                    </td>
                    <td style="text-align:right;">
                      <p style="margin:0 0 4px;font-size:11px;color:#888;letter-spacing:1px;font-family:'Courier New',monospace;">ALERTS</p>
                      <p style="margin:0;font-size:32px;font-weight:800;color:#fff;">${posts.length}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- Category breakdown -->
          <h3 style="margin:0 0 16px;font-size:15px;color:#00ccff;font-family:'Courier New',monospace;letter-spacing:1px;">// THIS WEEK'S SCAM ALERTS</h3>

          ${postCards}

          <!-- Stay safe tip -->
          <table width="100%" cellpadding="20" style="background:#050f05;border-left:4px solid #00ff41;border-radius:0 8px 8px 0;margin-bottom:28px;">
            <tr><td>
              <p style="margin:0 0 6px;font-size:11px;color:#00ff41;letter-spacing:2px;font-family:'Courier New',monospace;">💡 PREMIUM TIP OF THE WEEK</p>
              <p style="margin:0;font-size:14px;color:#ccddcc;line-height:1.7;">
                <strong style="color:#fff;">Use a separate email for online shopping.</strong> Create a second Gmail account just for e-commerce sites. This way, if a site sells your data or gets hacked, your main email stays clean and your important accounts stay safe.
              </p>
            </td></tr>
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center">
              <a href="${siteUrl}" style="display:inline-block;background:#00ccff;color:#000;font-size:15px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:8px;">🛡️ View All Alerts Online →</a>
            </td></tr>
          </table>

        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td style="background:#030803;border:1px solid #1a3a1a;border-radius:0 0 12px 12px;padding:28px 40px;text-align:center;">
          <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#fff;">🛡️ CyberWatch Kenya</p>
          <p style="margin:0 0 4px;font-size:12px;color:#557755;font-family:'Courier New',monospace;">Protecting Kenyans Online Since 2024</p>
          <p style="margin:0 0 16px;font-size:12px;color:#557755;">This digest is exclusive to ⭐ Premium members.<br>You receive it every Monday at 8am.</p>
          <p style="margin:0;font-size:11px;color:#334433;">© 2024 CyberWatch Kenya 🇰🇪 &nbsp;|&nbsp; <a href="${unsubUrl}" style="color:#555;">Unsubscribe</a></p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendWeeklyDigest };
