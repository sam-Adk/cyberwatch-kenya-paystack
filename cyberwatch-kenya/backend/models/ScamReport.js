/**
 * models/ScamReport.js
 *
 * Schema for user-submitted scam reports.
 * Users can report scams they've encountered.
 */

const mongoose = require('mongoose');

const scamReportSchema = new mongoose.Schema({
  reporterName: {
    type: String,
    required: true,
    trim: true
  },
  reporterEmail: {
    type: String,
    trim: true,
    lowercase: true
  },
  scamType: {
    type: String,
    required: true,
    enum: [
      'Phishing',
      'Crypto Scam',
      'Employment Scam',
      'Mobile Money Scam',
      'Romance Scam',
      'E-commerce Fraud',
      'Online Fraud',
      'Investment Scam',
      'Impersonation',
      'Other'
    ]
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  amountLost: {
    type: Number,
    default: 0 // KSh amount lost (0 if none)
  },
  platform: {
    type: String, // e.g. WhatsApp, Facebook, Email
    trim: true
  },
  // Kenya county where scam occurred
  county: {
    type: String,
    trim: true,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'published'],
    default: 'pending'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ScamReport', scamReportSchema);
