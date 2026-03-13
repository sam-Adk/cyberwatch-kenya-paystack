/**
 * models/Newsletter.js
 *
 * Schema for scam alert / newsletter posts.
 *
 * Fields:
 * - title: headline of the scam alert
 * - description: full content/body
 * - category: type of scam (e.g. "Phishing", "Crypto Scam")
 * - author: who wrote it
 * - published: draft (false) or live (true)
 * - tags: array of keywords for filtering
 * - sentToSubscribers: tracks whether email was already sent
 * - createdAt/updatedAt: auto-timestamps
 */

const mongoose = require('mongoose');

const newsletterSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    required: [true, 'Content is required'],
    trim: true
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
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
    ],
    default: 'Other'
  },
  author: {
    type: String,
    default: 'CyberWatch Kenya Team'
  },
  published: {
    type: Boolean,
    default: false // Posts start as drafts
  },
  tags: [{
    type: String,
    trim: true
  }],
  sentToSubscribers: {
    type: Boolean,
    default: false
  },
  sentAt: {
    type: Date
  },
  // Who can receive this post — 'all', 'free', 'premium'
  audience: {
    type: String,
    enum: ['all', 'free', 'premium'],
    default: 'all'
  }
}, {
  timestamps: true
});

// Text index for search functionality
// This lets MongoDB do full-text search on title and description
newsletterSchema.index({ title: 'text', description: 'text', tags: 'text' });

module.exports = mongoose.model('Newsletter', newsletterSchema);
