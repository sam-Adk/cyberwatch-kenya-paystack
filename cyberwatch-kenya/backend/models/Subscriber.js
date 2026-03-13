/**
 * models/Subscriber.js
 *
 * Schema for newsletter subscribers.
 *
 * Fields:
 * - name: subscriber's name
 * - email: unique email address
 * - active: whether they're still subscribed (false = unsubscribed)
 * - unsubscribeToken: unique token used in unsubscribe links in emails
 * - subscribedAt: when they subscribed
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const subscriberSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  active: {
    type: Boolean,
    default: true
  },
  // Each subscriber gets a unique token for their unsubscribe link
  unsubscribeToken: {
    type: String,
    default: () => crypto.randomBytes(32).toString('hex')
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Subscriber', subscriberSchema);
