/**
 * routes/analyticsRoutes.js
 * Tracks page views and returns visit stats for admin dashboard
 */

const express  = require('express');
const router   = express.Router();
const PageView = require('../models/PageView');
const { protect } = require('../middleware/authMiddleware');

// ── PUBLIC: TRACK A PAGE VIEW ────────────────
// POST /api/analytics/track
router.post('/track', async (req, res) => {
  try {
    const { page } = req.body;
    if (!page) return res.status(400).json({ success: false });

    // Get real IP (works behind proxies/Render)
    const ip = req.headers['x-forwarded-for']?.split(',')[0]
            || req.socket?.remoteAddress
            || 'unknown';

    // Don't track admin/bot visits
    const ua = req.headers['user-agent'] || '';
    if (ua.includes('bot') || ua.includes('crawler') || ua.includes('spider')) {
      return res.json({ success: true });
    }

    await PageView.create({
      page,
      userAgent: ua.substring(0, 200),
      ip: ip.substring(0, 50),
      referrer: (req.headers.referer || '').substring(0, 200)
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ── ADMIN: GET VISIT STATS ───────────────────
// GET /api/analytics/stats
router.get('/stats', protect, async (req, res) => {
  try {
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week  = new Date(today); week.setDate(week.getDate() - 7);
    const month = new Date(today); month.setDate(month.getDate() - 30);

    const [totalViews, todayViews, weekViews, monthViews, topPages, dailyStats] = await Promise.all([
      // Total all time
      PageView.countDocuments(),
      // Today
      PageView.countDocuments({ createdAt: { $gte: today } }),
      // Last 7 days
      PageView.countDocuments({ createdAt: { $gte: week } }),
      // Last 30 days
      PageView.countDocuments({ createdAt: { $gte: month } }),
      // Top pages
      PageView.aggregate([
        { $group: { _id: '$page', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 }
      ]),
      // Daily visits last 14 days
      PageView.aggregate([
        { $match: { createdAt: { $gte: new Date(today - 14 * 24 * 60 * 60 * 1000) } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }},
        { $sort: { _id: 1 } }
      ])
    ]);

    res.json({
      success: true,
      stats: { totalViews, todayViews, weekViews, monthViews },
      topPages,
      dailyStats
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
