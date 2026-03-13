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

    const { title, description, category, author, published, tags, audience } = req.body;

    const newsletter = await Newsletter.create({
      title,
      description,
      category,
      author: author || req.user.name,
      published: published || false,
      tags: tags || [],
      audience: audience || 'all'
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

    // Get subscribers filtered by post audience
    const audience = newsletter.audience || 'all';
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
  const categoryColors = {
    'Phishing': '#ff4444',
    'Crypto Scam': '#ff8800',
    'Employment Scam': '#ffcc00',
    'Mobile Money Scam': '#ff4488',
    'Romance Scam': '#ff66aa',
    'E-commerce Fraud': '#aa44ff',
    'Online Fraud': '#ff4444',
    'Investment Scam': '#ff6600',
    'Impersonation': '#4488ff',
    'Other': '#00ff88'
  };

  const color = categoryColors[newsletter.category] || '#00ff88';
  const contentHTML = newsletter.description
    .split('\n')
    .map(line => line.trim() ? `<p style="margin: 8px 0; line-height: 1.6;">${line}</p>` : '<br>')
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${newsletter.title}</title>
</head>
<body style="margin:0; padding:0; background-color:#0a0a0a; font-family: 'Courier New', monospace;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #0d1117, #1a2a1a); border: 1px solid #00ff41; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 20px;">
      <div style="font-size: 28px; font-weight: bold; color: #00ff41; letter-spacing: 3px;">
        🛡️ CYBERWATCH KENYA
      </div>
      <div style="color: #888; font-size: 13px; margin-top: 8px;">
        Protecting Kenyans Online Since 2024
      </div>
    </div>

    <!-- Alert Badge -->
    <div style="text-align: center; margin-bottom: 16px;">
      <span style="background: ${color}22; border: 1px solid ${color}; color: ${color}; padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: bold; letter-spacing: 1px;">
        ⚠️ ${newsletter.category.toUpperCase()}
      </span>
    </div>

    <!-- Title -->
    <h1 style="color: #ffffff; font-size: 22px; line-height: 1.3; text-align: center; margin-bottom: 20px; padding: 0 10px;">
      ${newsletter.title}
    </h1>

    <!-- Content -->
    <div style="background: #0d1117; border-left: 3px solid #00ff41; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 20px; color: #cccccc; font-size: 14px;">
      ${contentHTML}
    </div>

    <!-- Tags -->
    ${newsletter.tags && newsletter.tags.length > 0 ? `
    <div style="margin-bottom: 20px;">
      ${newsletter.tags.map(tag => `<span style="background: #1a2a1a; border: 1px solid #333; color: #00ff41; padding: 4px 10px; border-radius: 12px; font-size: 11px; margin-right: 6px; display: inline-block; margin-bottom: 6px;">#${tag}</span>`).join('')}
    </div>
    ` : ''}

    <!-- CTA -->
    <div style="text-align: center; margin-bottom: 24px;">
      <a href="https://cyberwatchkenya.com" style="background: #00ff41; color: #000000; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 14px; letter-spacing: 1px;">
        READ MORE ALERTS →
      </a>
    </div>

    <!-- Footer -->
    <div style="border-top: 1px solid #222; padding-top: 16px; text-align: center; color: #555; font-size: 11px;">
      <p>Hello {{SUBSCRIBER_NAME}}, you're receiving this because you subscribed to CyberWatch Kenya.</p>
      <p>© 2024 CyberWatch Kenya | Nairobi, Kenya</p>
      <p><a href="{{UNSUBSCRIBE_URL}}" style="color: #555; text-decoration: underline;">Unsubscribe</a></p>
    </div>

  </div>
</body>
</html>
  `;
}
