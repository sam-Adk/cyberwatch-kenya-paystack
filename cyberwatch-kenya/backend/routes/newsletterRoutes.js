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
