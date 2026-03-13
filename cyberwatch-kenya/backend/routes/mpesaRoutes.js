/**
 * routes/mpesaRoutes.js
 *
 * All M-PESA payment endpoints
 */

const express = require('express');
const router = express.Router();
const {
  initiatePayment,
  mpesaCallback,
  checkPaymentStatus,
  renewSubscription,
  getSubscriptions
} = require('../controllers/mpesaController');
const { protect } = require('../middleware/authMiddleware');

// ── PUBLIC ROUTES ──────────────────────────────

// POST /api/mpesa/subscribe — initiate STK Push payment
router.post('/subscribe', initiatePayment);

// POST /api/mpesa/callback — Safaricom calls this after payment
// Must be publicly accessible (use ngrok for local testing)
router.post('/callback', mpesaCallback);

// GET /api/mpesa/status/:checkoutRequestId — check payment status
router.get('/status/:checkoutRequestId', checkPaymentStatus);

// POST /api/mpesa/renew — renew existing subscription
router.post('/renew', renewSubscription);

// ── ADMIN ROUTES ───────────────────────────────

// GET /api/mpesa/subscriptions — all subscriptions with stats
router.get('/subscriptions', protect, getSubscriptions);

module.exports = router;
