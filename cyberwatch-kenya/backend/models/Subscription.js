/**
 * models/Subscription.js
 *
 * Tracks each subscriber's payment status and expiry date.
 *
 * STATUS FLOW:
 * pending → paid → active → expired → cancelled
 */

const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  // Link to the subscriber
  subscriber: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscriber',
    required: true
  },

  // M-PESA payment details
  phone: {
    type: String,
    required: true,
    trim: true
  },
  amount: {
    type: Number,
    default: 30 // KSh 30 per month
  },

  // Daraja API tracking
  merchantRequestId: String,   // ID from STK Push request
  checkoutRequestId: String,   // ID to check payment status
  mpesaReceiptNumber: String,  // M-PESA confirmation code e.g. QJK3XY1234

  // Subscription period
  status: {
    type: String,
    enum: ['pending', 'paid', 'active', 'expired', 'failed', 'cancelled'],
    default: 'pending'
  },

  startDate: Date,
  expiryDate: Date, // 30 days after payment

  // Reminder tracking
  reminderSent: {
    type: Boolean,
    default: false
  }

}, {
  timestamps: true
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
