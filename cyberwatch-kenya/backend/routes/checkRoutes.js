/**
 * routes/checkRoutes.js
 * Public scam checker — search by phone number, website or keyword
 */

const express    = require('express');
const router     = express.Router();
const ScamReport = require('../models/ScamReport');
const Newsletter = require('../models/Newsletter');

// ── PUBLIC: CHECK A NUMBER/WEBSITE/KEYWORD ───
// GET /api/check?q=0712345678
router.get('/', async (req, res) => {
  try {
    const query = (req.query.q || '').trim();
    if (!query || query.length < 3) {
      return res.json({ success: true, found: false, results: [], message: 'Enter at least 3 characters' });
    }

    // Clean query — remove spaces, dashes from phone numbers
    const cleanQuery  = query.replace(/[\s\-\(\)]/g, '');
    const searchRegex = new RegExp(cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    // Search in scam reports (description, platform, reporter info)
    const reports = await ScamReport.find({
      $or: [
        { description: searchRegex },
        { platform:    searchRegex },
        { scamType:    searchRegex }
      ],
      status: { $in: ['published', 'pending', 'reviewed'] }
    })
    .select('scamType platform description county amountLost createdAt status')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

    // Search in published newsletter alerts
    const alerts = await Newsletter.find({
      published: true,
      $or: [
        { title:       searchRegex },
        { description: searchRegex },
        { category:    searchRegex }
      ]
    })
    .select('title category description createdAt')
    .sort({ createdAt: -1 })
    .limit(3)
    .lean();

    const totalFound = reports.length + alerts.length;

    if (totalFound === 0) {
      return res.json({
        success: true,
        found:   false,
        query,
        results: [],
        message: 'No reports found for this number or website.'
      });
    }

    // Build results
    const results = [
      ...reports.map(r => ({
        type:      'report',
        category:  r.scamType,
        platform:  r.platform || 'Unknown platform',
        preview:   r.description.substring(0, 120) + '...',
        county:    r.county || null,
        lost:      r.amountLost || 0,
        date:      r.createdAt,
        status:    r.status
      })),
      ...alerts.map(a => ({
        type:     'alert',
        category: a.category,
        title:    a.title,
        preview:  a.description.substring(0, 120) + '...',
        date:     a.createdAt
      }))
    ];

    res.json({
      success: true,
      found:   true,
      query,
      count:   totalFound,
      results
    });

  } catch (err) {
    console.error('Check error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
