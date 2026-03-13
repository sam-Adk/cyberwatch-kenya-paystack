/**
 * routes/paystackRoutes.js
 */

const express = require('express');
const router = express.Router();
const {
  initializePayment,
  verifyPayment,
  handleWebhook,
  checkStatus,
  getSubscriptions
} = require('../controllers/paystackController');
const { protect } = require('../middleware/authMiddleware');

// POST /api/paystack/initialize — start payment, get Paystack URL
router.post('/initialize', initializePayment);

// GET /api/paystack/verify — Paystack redirects here after payment
router.get('/verify', verifyPayment);

// POST /api/paystack/webhook — Paystack calls this automatically after payment
router.post('/webhook', handleWebhook);

// GET /api/paystack/status/:reference — check payment status
router.get('/status/:reference', checkStatus);

// GET /api/paystack/subscriptions — admin view (requires login)
router.get('/subscriptions', protect, getSubscriptions);

module.exports = router;
