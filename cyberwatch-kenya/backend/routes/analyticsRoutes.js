const express  = require('express');
const router   = express.Router();
const PageView = require('../models/PageView');
const { protect } = require('../middleware/authMiddleware');

// ── PUBLIC: TRACK VISIT ───────────────────────
router.post('/track', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.json({ success: true });

    const ua = req.headers['user-agent'] || '';
    if (/bot|crawler|spider|googlebot|bingbot/i.test(ua)) return res.json({ success: true });

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

    // One record per sessionId per day — if already recorded today, skip
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const alreadyTracked = await PageView.findOne({
      sessionId,
      createdAt: { $gte: todayStart }
    }).lean();

    if (!alreadyTracked) {
      await PageView.create({
        sessionId,
        page:      (req.body.page || '/').split('?')[0].split('#')[0] || '/',
        pages:     [],
        userAgent: ua.substring(0, 200),
        ip:        ip.substring(0, 50),
        referrer:  (req.headers.referer || '').substring(0, 200)
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.json({ success: true });
  }
});

// ── ADMIN: STATS ──────────────────────────────
router.get('/stats', protect, async (req, res) => {
  try {
    const now    = new Date();
    const today  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week   = new Date(today); week.setDate(today.getDate() - 7);
    const month  = new Date(now.getFullYear(), now.getMonth(), 1);
    const year   = new Date(now.getFullYear(), 0, 1);
    const last14 = new Date(today); last14.setDate(today.getDate() - 14);

    const [total, todayV, weekV, monthV, yearV, topPages, daily14, monthly12, recent] = await Promise.all([
      PageView.countDocuments(),
      PageView.countDocuments({ createdAt: { $gte: today } }),
      PageView.countDocuments({ createdAt: { $gte: week } }),
      PageView.countDocuments({ createdAt: { $gte: month } }),
      PageView.countDocuments({ createdAt: { $gte: year } }),
      PageView.aggregate([
        { $group: { _id: '$page', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 6 }
      ]),
      PageView.aggregate([
        { $match: { createdAt: { $gte: last14 } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Africa/Nairobi' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),
      PageView.aggregate([
        { $match: { createdAt: { $gte: new Date(now.getFullYear() - 1, now.getMonth(), 1) } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Africa/Nairobi' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),
      PageView.find().sort({ createdAt: -1 }).limit(50).lean()
    ]);

    // Fill gaps in daily chart
    const dailyFilled = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dailyFilled.push({ date: key, count: (daily14.find(x => x._id === key) || {}).count || 0 });
    }

    // Fill gaps in monthly chart
    const monthlyFilled = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      monthlyFilled.push({ month: key, count: (monthly12.find(x => x._id === key) || {}).count || 0 });
    }

    res.json({
      success: true,
      stats:   { totalViews: total, todayViews: todayV, weekViews: weekV, monthViews: monthV, yearViews: yearV },
      topPages, daily: dailyFilled, monthly: monthlyFilled, visitors: recent
    });
  } catch (err) {
    res.json({ success: true, stats: { totalViews:0,todayViews:0,weekViews:0,monthViews:0,yearViews:0 }, topPages:[], daily:[], monthly:[], visitors:[] });
  }
});

module.exports = router;
