/**
 * routes/newsletterRoutes.js
 *
 * Public routes: GET (read-only, published only)
 * Protected routes: POST, PUT, DELETE, SEND (admin only)
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  getAllNewsletters,
  getAdminNewsletters,
  getNewsletter,
  createNewsletter,
  updateNewsletter,
  deleteNewsletter,
  sendNewsletter
} = require('../controllers/newsletterController');
const { protect } = require('../middleware/authMiddleware');

// ── PUBLIC ROUTES ──────────────────────────────
// GET /api/newsletters — list published posts (supports ?category=&search=&page=)
router.get('/', getAllNewsletters);

// GET /api/newsletters/:id — single post
router.get('/:id', getNewsletter);

// ── ADMIN ROUTES (require JWT) ─────────────────
// GET /api/newsletters/admin/all — all posts including drafts
router.get('/admin/all', protect, getAdminNewsletters);

// POST /api/newsletters — create new post
router.post('/', protect, [
  body('title').notEmpty().withMessage('Title is required'),
  body('description').notEmpty().withMessage('Content is required'),
  body('category').notEmpty().withMessage('Category is required')
], createNewsletter);

// PUT /api/newsletters/:id — update post
router.put('/:id', protect, updateNewsletter);

// DELETE /api/newsletters/:id — delete post
router.delete('/:id', protect, deleteNewsletter);

// POST /api/newsletters/:id/send — email to all subscribers
router.post('/:id/send', protect, sendNewsletter);

// ── ADMIN: TEST SMS ─────────────────────────────
router.post('/admin/test-sms', protect, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'Phone number required' });

    const AfricasTalking = require('africastalking');
    const AT = AfricasTalking({
      apiKey:   process.env.AT_API_KEY,
      username: process.env.AT_USERNAME
    });

    // Format phone
    let formatted = phone.replace(/\s+/g,'').replace(/-/g,'');
    if (formatted.startsWith('0'))    formatted = '+254' + formatted.slice(1);
    if (formatted.startsWith('254'))  formatted = '+' + formatted;
    if (!formatted.startsWith('+'))   formatted = '+254' + formatted;

    const message = `🛡️ CyberWatch Kenya

This is a test SMS from your admin dashboard.

If you received this, SMS alerts are working perfectly! ✅`;

    const sendOptions = { to: [formatted], message };
    if (process.env.AT_SENDER_ID) sendOptions.from = process.env.AT_SENDER_ID;

    const result = await AT.SMS.send(sendOptions);
    console.log('Test SMS result:', JSON.stringify(result, null, 2));

    const recipients = result.SMSMessageData?.Recipients || [];
    const success    = recipients.find(r => r.status === 'Success');
    const failed     = recipients.find(r => r.status !== 'Success');

    if (success) {
      res.json({ success: true, message: `✅ SMS sent to ${formatted}! Cost: ${success.cost}` });
    } else {
      const errMsg = failed ? `${failed.status}: ${failed.statusCode || ''}` : 'Unknown error';
      res.json({ success: false, message: `❌ SMS failed: ${errMsg}`, result });
    }
  } catch (err) {
    console.error('Test SMS error:', err);
    res.status(500).json({ success: false, message: err.message, stack: err.stack });
  }
});

// ── ADMIN: TRIGGER WEEKLY DIGEST MANUALLY ──────
router.post('/admin/send-digest', protect, async (req, res) => {
  try {
    const { sendWeeklyDigest } = require('../utils/weeklyDigest');
    await sendWeeklyDigest();
    res.json({ success: true, message: '✅ Weekly digest sent to all premium subscribers!' });
  } catch (err) {
    console.error('Manual digest error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
