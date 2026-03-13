/**
 * routes/subscriberRoutes.js
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validationResult } = require('express-validator');
const Subscriber = require('../models/Subscriber');
const ScamReport = require('../models/ScamReport');
const { protect } = require('../middleware/authMiddleware');

// ── PUBLIC: SUBSCRIBE ──────────────────────────
// POST /api/subscribers/subscribe
router.post('/subscribe', [
  body('name').notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name, email } = req.body;

    // Check if already subscribed
    const existing = await Subscriber.findOne({ email: email.toLowerCase() });
    if (existing) {
      if (existing.active) {
        return res.status(400).json({ success: false, message: 'This email is already subscribed.' });
      } else {
        // Re-activate if they previously unsubscribed
        existing.active = true;
        existing.name = name;
        await existing.save();
        return res.json({ success: true, message: 'Welcome back! You have been re-subscribed.' });
      }
    }

    await Subscriber.create({ name, email });

    res.status(201).json({
      success: true,
      message: '✅ Successfully subscribed! You will receive our latest scam alerts.'
    });

  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ── PUBLIC: UNSUBSCRIBE VIA TOKEN LINK ─────────
// GET /api/subscribers/unsubscribe/:token
router.get('/unsubscribe/:token', async (req, res) => {
  try {
    const subscriber = await Subscriber.findOne({ unsubscribeToken: req.params.token });

    if (!subscriber) {
      return res.status(404).send('<h2>Invalid unsubscribe link.</h2>');
    }

    subscriber.active = false;
    await subscriber.save();

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial; background: #0a0a0a; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
          .box { text-align: center; padding: 40px; border: 1px solid #333; border-radius: 8px; max-width: 400px; }
          h2 { color: #00ff41; }
          a { color: #00ff41; }
        </style>
      </head>
      <body>
        <div class="box">
          <h2>Unsubscribed</h2>
          <p>You have been unsubscribed from CyberWatch Kenya alerts.</p>
          <p><a href="/">Subscribe again</a></p>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    res.status(500).send('<h2>Server error</h2>');
  }
});

// ── PUBLIC: SUBMIT SCAM REPORT ─────────────────
// POST /api/subscribers/report-scam
router.post('/report-scam', [
  body('reporterName').notEmpty().withMessage('Your name is required'),
  body('scamType').notEmpty().withMessage('Scam type is required'),
  body('description').isLength({ min: 30 }).withMessage('Please provide at least 30 characters describing the scam')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { reporterName, reporterEmail, scamType, description, amountLost, platform } = req.body;

    await ScamReport.create({ reporterName, reporterEmail, scamType, description, amountLost, platform });

    res.status(201).json({
      success: true,
      message: '✅ Thank you for your report! Our team will review it shortly.'
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── ADMIN: GET ALL SUBSCRIBERS ─────────────────
// GET /api/subscribers/admin/list
router.get('/admin/list', protect, async (req, res) => {
  try {
    const subscribers = await Subscriber.find().sort({ createdAt: -1 });
    res.json({ success: true, data: subscribers, total: subscribers.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── ADMIN: GET SCAM REPORTS ────────────────────
// GET /api/subscribers/admin/reports
router.get('/admin/reports', protect, async (req, res) => {
  try {
    const reports = await ScamReport.find().sort({ createdAt: -1 });
    res.json({ success: true, data: reports });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
