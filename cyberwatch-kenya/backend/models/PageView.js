const mongoose = require('mongoose');

const pageViewSchema = new mongoose.Schema({
  page: { type: String, required: true },  // e.g. '/', '/about', '/pricing'
  userAgent: { type: String },
  ip: { type: String },
  referrer: { type: String },
  country: { type: String, default: 'Kenya' }
}, { timestamps: true });

module.exports = mongoose.model('PageView', pageViewSchema);
