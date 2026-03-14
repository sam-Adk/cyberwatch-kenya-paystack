/**
 * controllers/newsletterController.js
 *
 * Handles all newsletter/scam post operations:
 * - getAllNewsletters: public list of published posts
 * - getNewsletter: single post by ID
 * - createNewsletter: admin creates new post
 * - updateNewsletter: admin edits post
 * - deleteNewsletter: admin removes post
 * - sendNewsletter: sends email to all subscribers
 * - searchNewsletters: full-text search
 */

const Newsletter = require('../models/Newsletter');
const Subscriber = require('../models/Subscriber');
const axios = require('axios');
const { validationResult } = require('express-validator');

// ─────────────────────────────────────────────
// GET ALL (public — only published posts)
// ─────────────────────────────────────────────

exports.getAllNewsletters = async (req, res) => {
  try {
    const { category, search, page = 1, limit = 10 } = req.query;

    // Build the query filter
    const filter = { published: true };

    if (category && category !== 'All') {
      filter.category = category;
    }

    if (search) {
      // MongoDB text search (requires text index on the model)
      filter.$text = { $search: search };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [newsletters, total] = await Promise.all([
      Newsletter.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Newsletter.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: newsletters,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit))
    });

  } catch (error) {
    console.error('Get newsletters error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─────────────────────────────────────────────
// GET ALL (admin — includes drafts)
// ─────────────────────────────────────────────

exports.getAdminNewsletters = async (req, res) => {
  try {
    const newsletters = await Newsletter.find().sort({ createdAt: -1 });
    res.json({ success: true, data: newsletters });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─────────────────────────────────────────────
// GET SINGLE
// ─────────────────────────────────────────────

exports.getNewsletter = async (req, res) => {
  try {
    const newsletter = await Newsletter.findById(req.params.id);
    if (!newsletter) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    res.json({ success: true, data: newsletter });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─────────────────────────────────────────────
// CREATE (admin only)
// ─────────────────────────────────────────────

exports.createNewsletter = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { title, description, category, author, published, tags, audience, imageUrl, imagePublicId } = req.body;

    const newsletter = await Newsletter.create({
      title,
      description,
      category,
      author: author || req.user.name,
      published: published || false,
      tags: tags || [],
      audience: audience || 'all',
      imageUrl: imageUrl || null,
      imagePublicId: imagePublicId || null
    });

    res.status(201).json({ success: true, data: newsletter });

  } catch (error) {
    console.error('Create newsletter error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─────────────────────────────────────────────
// UPDATE (admin only)
// ─────────────────────────────────────────────

exports.updateNewsletter = async (req, res) => {
  try {
    const newsletter = await Newsletter.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!newsletter) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    res.json({ success: true, data: newsletter });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─────────────────────────────────────────────
// DELETE (admin only)
// ─────────────────────────────────────────────

exports.deleteNewsletter = async (req, res) => {
  try {
    const newsletter = await Newsletter.findByIdAndDelete(req.params.id);
    if (!newsletter) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    res.json({ success: true, message: 'Post deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─────────────────────────────────────────────
// SEND EMAIL TO ALL SUBSCRIBERS (admin only)
// ─────────────────────────────────────────────

exports.sendNewsletter = async (req, res) => {
  try {
    const newsletter = await Newsletter.findById(req.params.id);
    if (!newsletter) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    if (newsletter.sentToSubscribers) {
      return res.status(400).json({ success: false, message: 'This newsletter was already sent' });
    }

    // Use audience from request body (chosen at send time) or fall back to post's stored audience
    const audience = req.body.audience || newsletter.audience || 'all';
    let subscriberQuery = { active: true };
    if (audience === 'free')    subscriberQuery.plan = 'free';
    if (audience === 'premium') subscriberQuery.plan = 'premium';

    const subscribers = await Subscriber.find(subscriberQuery);
    if (subscribers.length === 0) {
      const label = audience === 'all' ? 'active' : audience;
      return res.status(400).json({ success: false, message: `No ${label} subscribers found` });
    }

    // Generate HTML email template
    const emailHTML = generateEmailHTML(newsletter);

    // Send to each subscriber via Brevo HTTP API
    let sentCount = 0;
    const errors = [];

    for (const subscriber of subscribers) {
      try {
        const unsubscribeUrl = `${process.env.SITE_URL}/api/subscribers/unsubscribe/${subscriber.unsubscribeToken}`;
        const personalizedHTML = emailHTML
          .replace('{{UNSUBSCRIBE_URL}}', unsubscribeUrl)
          .replace('{{SUBSCRIBER_NAME}}', subscriber.name);

        await axios.post(
          'https://api.brevo.com/v3/smtp/email',
          {
            sender: { name: 'CyberWatch Kenya', email: 'securedatakenya@gmail.com' },
            to: [{ email: subscriber.email, name: subscriber.name }],
            subject: `🚨 [CyberWatch Kenya] ${newsletter.title}`,
            htmlContent: personalizedHTML
          },
          {
            headers: {
              'api-key': process.env.BREVO_API_KEY,
              'Content-Type': 'application/json'
            }
          }
        );
        sentCount++;
      } catch (emailError) {
        console.error(`Email failed for ${subscriber.email}:`, emailError.response?.data || emailError.message);
        errors.push({ email: subscriber.email, error: emailError.message });
      }
    }

    // Mark as sent
    await Newsletter.findByIdAndUpdate(req.params.id, {
      sentToSubscribers: true,
      sentAt: new Date()
    });

    res.json({
      success: true,
      message: `Newsletter sent to ${sentCount} subscribers`,
      sentCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Send newsletter error:', error);
    res.status(500).json({ success: false, message: 'Failed to send newsletter: ' + error.message });
  }
};

// ─────────────────────────────────────────────
// EMAIL HTML TEMPLATE
// ─────────────────────────────────────────────

function generateEmailHTML(newsletter) {
  const siteUrl = process.env.SITE_URL || 'https://cyberwatch-kenya.onrender.com';

  const categories = {
    'Phishing':          { color: '#ff2244', bg: 'rgba(255,34,68,0.08)',   border: 'rgba(255,34,68,0.3)',  icon: '🎣', level: 'CRITICAL' },
    'Crypto Scam':       { color: '#ff2244', bg: 'rgba(255,34,68,0.08)',   border: 'rgba(255,34,68,0.3)',  icon: '💀', level: 'CRITICAL' },
    'Investment Scam':   { color: '#ff2244', bg: 'rgba(255,34,68,0.08)',   border: 'rgba(255,34,68,0.3)',  icon: '💸', level: 'CRITICAL' },
    'Mobile Money Scam': { color: '#ff6600', bg: 'rgba(255,102,0,0.08)',   border: 'rgba(255,102,0,0.3)',  icon: '📱', level: 'HIGH'     },
    'Impersonation':     { color: '#ff6600', bg: 'rgba(255,102,0,0.08)',   border: 'rgba(255,102,0,0.3)',  icon: '🎭', level: 'HIGH'     },
    'Romance Scam':      { color: '#ff6600', bg: 'rgba(255,102,0,0.08)',   border: 'rgba(255,102,0,0.3)',  icon: '💔', level: 'HIGH'     },
    'Employment Scam':   { color: '#ffcc00', bg: 'rgba(255,204,0,0.08)',   border: 'rgba(255,204,0,0.3)',  icon: '💼', level: 'MEDIUM'   },
    'E-commerce Fraud':  { color: '#ffcc00', bg: 'rgba(255,204,0,0.08)',   border: 'rgba(255,204,0,0.3)',  icon: '🛒', level: 'MEDIUM'   },
    'Online Fraud':      { color: '#ffcc00', bg: 'rgba(255,204,0,0.08)',   border: 'rgba(255,204,0,0.3)',  icon: '🌐', level: 'MEDIUM'   },
    'Other':             { color: '#00ff41', bg: 'rgba(0,255,65,0.06)',    border: 'rgba(0,255,65,0.2)',   icon: '⚠️', level: 'INFO'     },
  };

  const cat     = categories[newsletter.category] || categories['Other'];
  const dateStr = new Date(newsletter.createdAt || Date.now()).toLocaleDateString('en-KE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // Format content — each paragraph gets styled, bold markers get highlighted
  const contentHTML = newsletter.description
    .split('\n')
    .filter(line => line.trim())
    .map((line, i) => {
      // First paragraph gets special treatment as a lead
      if (i === 0) {
        return `<p style="margin:0 0 18px;font-size:16px;color:#ddeedd;line-height:1.9;font-weight:500;">${escapeHtml(line)}</p>`;
      }
      // Lines starting with numbers or bullets get indented
      if (/^[0-9•\-\*]/.test(line.trim())) {
        return `<p style="margin:0 0 12px;font-size:14px;color:#bbccbb;line-height:1.8;padding-left:16px;border-left:2px solid ${cat.color}33;">${escapeHtml(line)}</p>`;
      }
      // Lines in ALL CAPS get colored as subheadings
      if (line.trim() === line.trim().toUpperCase() && line.trim().length > 5) {
        return `<p style="margin:20px 0 10px;font-size:12px;color:${cat.color};letter-spacing:2px;font-family:'Courier New',monospace;font-weight:700;">${escapeHtml(line)}</p>`;
      }
      return `<p style="margin:0 0 14px;font-size:14px;color:#bbccbb;line-height:1.9;">${escapeHtml(line)}</p>`;
    })
    .join('');

  const tagsHTML = newsletter.tags && newsletter.tags.length
    ? newsletter.tags.map(tag =>
        `<span style="display:inline-block;background:rgba(0,255,65,0.08);border:1px solid rgba(0,255,65,0.2);color:#00ff41;font-size:11px;font-family:'Courier New',monospace;padding:3px 10px;border-radius:20px;margin:0 6px 6px 0;">#${escapeHtml(tag)}</span>`
      ).join('')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <title>${escapeHtml(newsletter.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#060a06;font-family:Georgia,'Times New Roman',serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#060a06;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- ══ TOP BAR ══ -->
  <tr>
    <td style="background:#00ff41;padding:10px 32px;border-radius:12px 12px 0 0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-family:'Courier New',monospace;font-size:11px;font-weight:800;color:#000;letter-spacing:2px;">
            🛡️ CYBERWATCH KENYA
          </td>
          <td style="text-align:right;font-family:'Courier New',monospace;font-size:10px;color:#004400;letter-spacing:1px;">
            SCAM INTELLIGENCE BULLETIN
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ══ HEADER ══ -->
  <tr>
    <td style="background:linear-gradient(160deg,#0a1a0a 0%,#0f200f 40%,#0a1500 100%);padding:40px 40px 32px;border-left:1px solid #1a3a1a;border-right:1px solid #1a3a1a;">

      <!-- Date + Issue info -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td style="font-family:'Courier New',monospace;font-size:11px;color:#557755;letter-spacing:1px;">
            📅 ${dateStr.toUpperCase()}
          </td>
          <td style="text-align:right;">
            <span style="background:${cat.bg};border:1px solid ${cat.border};color:${cat.color};font-family:'Courier New',monospace;font-size:10px;font-weight:800;padding:4px 12px;border-radius:20px;letter-spacing:2px;">
              ${cat.icon} ${newsletter.category.toUpperCase()} &nbsp;·&nbsp; ${cat.level}
            </span>
          </td>
        </tr>
      </table>

      <!-- Threat level bar -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:${cat.bg};border:1px solid ${cat.border};border-radius:8px;margin-bottom:28px;">
        <tr>
          <td style="padding:14px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-family:'Courier New',monospace;font-size:10px;color:${cat.color};letter-spacing:2px;">THREAT LEVEL</td>
                <td style="text-align:right;">
                  <span style="font-family:'Courier New',monospace;font-size:18px;font-weight:800;color:${cat.color};">${cat.level}</span>
                  &nbsp;
                  <span style="font-size:20px;">${cat.icon}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Featured Image (if exists) -->
      ${newsletter.imageUrl ? `
      <div style="margin-bottom:24px;border-radius:8px;overflow:hidden;border:1px solid ${cat.border};">
        <img src="${newsletter.imageUrl}" alt="${escapeHtml(newsletter.title)}"
          width="520"
          style="width:100%;max-width:520px;height:auto;display:block;border-radius:8px;"
        />
      </div>` : ''}

      <!-- Title -->
      <h1 style="margin:0 0 16px;font-size:clamp(20px,4vw,26px);font-weight:700;color:#ffffff;line-height:1.35;font-family:Georgia,'Times New Roman',serif;letter-spacing:-0.3px;">
        ${escapeHtml(newsletter.title)}
      </h1>

      <!-- Subtitle line -->
      <div style="width:48px;height:3px;background:${cat.color};border-radius:2px;margin-bottom:0;"></div>

    </td>
  </tr>

  <!-- ══ CONTENT ══ -->
  <tr>
    <td style="background:#0a120a;padding:36px 40px;border-left:1px solid #1a3a1a;border-right:1px solid #1a3a1a;border-top:1px solid #1a3a1a;">

      <!-- Hi subscriber name -->
      <p style="margin:0 0 24px;font-size:14px;color:#557755;font-family:'Courier New',monospace;letter-spacing:1px;">
        Hello {{SUBSCRIBER_NAME}},
      </p>

      <!-- Main content -->
      <div style="margin-bottom:28px;">
        ${contentHTML}
      </div>

      <!-- How to protect yourself box -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#050f05;border:1px solid rgba(0,255,65,0.15);border-left:4px solid #00ff41;border-radius:0 8px 8px 0;margin-bottom:28px;">
        <tr>
          <td style="padding:20px 24px;">
            <p style="margin:0 0 10px;font-family:'Courier New',monospace;font-size:11px;color:#00ff41;letter-spacing:2px;font-weight:700;">🔒 STAY PROTECTED</p>
            <p style="margin:0 0 8px;font-size:13px;color:#aabbaa;line-height:1.7;">✦ &nbsp;Verify all requests for money or personal info independently</p>
            <p style="margin:0 0 8px;font-size:13px;color:#aabbaa;line-height:1.7;">✦ &nbsp;Never share your M-PESA PIN or OTP with anyone</p>
            <p style="margin:0;font-size:13px;color:#aabbaa;line-height:1.7;">✦ &nbsp;Report scams to DCI Kenya: <span style="color:#00ff41;font-family:'Courier New',monospace;">cybercrime@dci.go.ke</span></p>
          </td>
        </tr>
      </table>

      <!-- Tags -->
      ${tagsHTML ? `<div style="margin-bottom:28px;">${tagsHTML}</div>` : ''}

      <!-- CTA Button -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
        <tr>
          <td align="center">
            <a href="${siteUrl}#alerts" style="display:inline-block;background:#00ff41;color:#000000;font-family:'Courier New',monospace;font-size:13px;font-weight:800;text-decoration:none;padding:14px 36px;border-radius:6px;letter-spacing:2px;">
              VIEW ALL SCAM ALERTS →
            </a>
          </td>
        </tr>
      </table>

    </td>
  </tr>

  <!-- ══ SHARE NUDGE ══ -->
  <tr>
    <td style="background:#060e06;padding:24px 40px;border:1px solid #1a3a1a;border-top:none;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(0,255,65,0.04);border:1px solid rgba(0,255,65,0.12);border-radius:8px;padding:18px 20px;">
        <tr>
          <td>
            <p style="margin:0;font-size:13px;color:#aabbaa;line-height:1.7;text-align:center;">
              🇰🇪 &nbsp;<strong style="color:#fff;">Know someone who could fall for this?</strong>&nbsp; Forward this email or share the link below to help protect them.
            </p>
            <p style="margin:8px 0 0;text-align:center;font-family:'Courier New',monospace;font-size:12px;color:#00ff41;">
              ${siteUrl}
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ══ FOOTER ══ -->
  <tr>
    <td style="background:#040804;border:1px solid #1a3a1a;border-top:2px solid #0d2010;border-radius:0 0 12px 12px;padding:32px 40px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="text-align:center;padding-bottom:20px;">
            <p style="margin:0 0 4px;font-size:18px;">🛡️</p>
            <p style="margin:0 0 2px;font-family:'Courier New',monospace;font-size:13px;font-weight:800;color:#fff;">CyberWatch Kenya</p>
            <p style="margin:0;font-family:'Courier New',monospace;font-size:10px;color:#334433;letter-spacing:1px;">PROTECTING KENYANS ONLINE SINCE 2024</p>
          </td>
        </tr>
        <tr>
          <td style="border-top:1px solid #1a2a1a;padding-top:20px;text-align:center;">
            <p style="margin:0 0 8px;font-size:12px;color:#445544;line-height:1.7;">
              You are receiving this because you subscribed to CyberWatch Kenya alerts.<br>
              We only send alerts when Kenyans are being actively targeted.
            </p>
            <p style="margin:0;font-size:11px;color:#334433;">
              © 2024 CyberWatch Kenya &nbsp;·&nbsp; Nairobi, Kenya 🇰🇪
              &nbsp;·&nbsp;
              <a href="{{UNSUBSCRIBE_URL}}" style="color:#445544;text-decoration:underline;">Unsubscribe</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

</table>
</td></tr>
</table>

</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
