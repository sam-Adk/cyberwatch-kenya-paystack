/**
 * models/User.js
 *
 * Defines the MongoDB schema for admin users.
 * Mongoose "schema" = blueprint for what a document looks like in MongoDB.
 *
 * Fields:
 * - name: admin's display name
 * - email: unique login email
 * - password: bcrypt-hashed password (never stored as plain text!)
 * - role: 'admin' or 'editor'
 * - createdAt: timestamp auto-added by Mongoose
 */

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters']
    // Note: password is hashed before saving — see authController.js
  },
  role: {
    type: String,
    enum: ['admin', 'editor'],
    default: 'editor'
  }
}, {
  timestamps: true // Automatically adds createdAt and updatedAt fields
});

module.exports = mongoose.model('User', userSchema);
