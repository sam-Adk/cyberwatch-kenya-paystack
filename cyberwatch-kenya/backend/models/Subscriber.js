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
  // Kenyan phone number for SMS alerts (premium only)
  phone: {
    type: String,
    trim: true,
    default: null
  },
  // Whether they want SMS alerts (premium only)
  smsEnabled: {
    type: Boolean,
    default: true
  },
  // FREE = free subscriber, PREMIUM = paid KSh 99/month
  plan: {
    type: String,
    enum: ['free', 'premium'],
    default: 'free'
  },
  unsubscribeToken: {
    type: String,
    default: () => crypto.randomBytes(32).toString('hex')
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Subscriber', subscriberSchema);
