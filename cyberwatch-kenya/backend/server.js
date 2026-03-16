/**
 * server.js - Main entry point for CyberWatch Kenya backend
 *
 * This file:
 * 1. Creates the Express app
 * 2. Connects to MongoDB
 * 3. Sets up middleware (CORS, JSON parsing)
 * 4. Registers all API routes
 * 5. Seeds an admin user on first run
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Import route files
const authRoutes = require('./routes/authRoutes');
const newsletterRoutes = require('./routes/newsletterRoutes');
const subscriberRoutes = require('./routes/subscriberRoutes');
const mpesaRoutes = require('./routes/mpesaRoutes');
const paystackRoutes = require('./routes/paystackRoutes');
const uploadRoutes      = require('./routes/uploadRoutes');
const analyticsRoutes   = require('./routes/analyticsRoutes');
const checkRoutes       = require('./routes/checkRoutes');
const { startCronJobs } = require('./utils/cronJobs');

const app = express();

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────

// Allow requests from the frontend (CORS = Cross-Origin Resource Sharing)
app.use(cors({
  origin: '*', // In production, restrict this to your frontend domain
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse incoming JSON request bodies
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/newsletters', newsletterRoutes);
app.use('/api/subscribers', subscriberRoutes);
app.use('/api/mpesa', mpesaRoutes);
app.use('/api/paystack', paystackRoutes);  // Paystack payments
app.use('/api/upload',   uploadRoutes);     // Image uploads
app.use('/api/analytics', analyticsRoutes); // Page view tracking
app.use('/api/check',     checkRoutes);     // Scam number checker

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'CyberWatch Kenya API is running' });
});

// Catch-all: serve frontend for any unknown route (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ─────────────────────────────────────────────
// DATABASE CONNECTION
// ─────────────────────────────────────────────

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/cyberwatch-kenya';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB');

    // Seed admin user on first run
    await seedAdmin();

    // Seed sample scam posts
    await seedSamplePosts();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📡 API available at http://localhost:${PORT}/api`);
      startCronJobs(); // Start daily subscription checks
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });

// ─────────────────────────────────────────────
// SEED FUNCTIONS
// ─────────────────────────────────────────────

async function seedAdmin() {
  const User = require('./models/User');
  const bcrypt = require('bcryptjs');

  const existing = await User.findOne({ email: process.env.ADMIN_EMAIL });
  if (!existing) {
    const hashed = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@123456', 12);
    await User.create({
      name: 'Admin',
      email: process.env.ADMIN_EMAIL || 'admin@cyberwatchkenya.com',
      password: hashed,
      role: 'admin'
    });
    console.log('👤 Admin user created:', process.env.ADMIN_EMAIL);
  }
}

async function seedSamplePosts() {
  const Newsletter = require('./models/Newsletter');
  const count = await Newsletter.countDocuments();
  if (count > 0) return; // Already seeded

  await Newsletter.insertMany([
    {
      title: 'Fake LinkedIn Recruiter Scams Targeting Kenyan Job Seekers',
      description: `Scammers are posing as foreign company recruiters on LinkedIn, promising high-paying remote jobs in the UK, USA, and UAE. They ask victims to pay "processing fees" between KSh 5,000–30,000 before interviews. 

RED FLAGS:
- Job offer arrives without applying
- Salary promised is unrealistically high (e.g. $5,000/month for entry-level)
- Recruiter uses a personal Gmail instead of company email
- Asked to pay money before starting work

HOW TO PROTECT YOURSELF:
✅ Verify the company on their official website
✅ Never pay money to get a job
✅ Video call the recruiter before sharing personal details
✅ Report fake profiles to LinkedIn`,
      category: 'Employment Scam',
      author: 'CyberWatch Kenya Team',
      published: true,
      tags: ['LinkedIn', 'Job Scam', 'Recruitment Fraud']
    },
    {
      title: 'Crypto Wallet Phishing Attacks — How Kenyans Are Losing Millions',
      description: `Cybercriminals are sending fake emails and WhatsApp messages pretending to be from Binance, Coinbase, or local crypto platforms like Paxful. The messages claim your wallet is "suspended" and ask you to verify your seed phrase.

WHAT IS A SEED PHRASE?
Your seed phrase is 12–24 words that control your crypto wallet. Anyone who knows it can steal ALL your funds instantly.

RED FLAGS:
- Message creates urgency: "Your account will be closed in 24 hours"
- Link in message is slightly different (e.g. binnance.com vs binance.com)
- Asked to enter your seed phrase or private key online
- Promise of free crypto (airdrops) that require wallet connection

PROTECT YOURSELF:
✅ NEVER share your seed phrase with anyone — not even support staff
✅ Always go directly to the official website, never through links in messages
✅ Enable 2-Factor Authentication (2FA) on all crypto accounts
✅ Use a hardware wallet for large amounts`,
      category: 'Crypto Scam',
      author: 'CyberWatch Kenya Team',
      published: true,
      tags: ['Crypto', 'Phishing', 'Binance', 'Bitcoin']
    },
    {
      title: 'Task Earning Website Scams: "Earn KSh 5,000 Per Day by Watching Videos"',
      description: `Dozens of fake "task earning" websites are targeting unemployed Kenyans, especially youth. They promise easy money for simple tasks like watching YouTube videos, liking posts, or writing reviews.

HOW THE SCAM WORKS:
1. You register and complete tasks, earning fake "credits"
2. When you try to withdraw, the site says you must "upgrade" your account first
3. You pay KSh 990–5,000 for an upgrade
4. After paying, you're asked to pay MORE for a "higher level"
5. Eventually the site disappears or blocks you

REAL EXAMPLES REPORTED IN KENYA:
- TaskEarn254.com (now offline)
- KenyaEarnings.net
- EasyWork254.com

RED FLAGS:
- Earnings are too good to be true
- Site has no physical address or company registration
- Payment required to "unlock" withdrawal
- Support only via WhatsApp, no official email

PROTECT YOURSELF:
✅ Research any site on Google before registering
✅ Never pay money to earn money
✅ Check reviews on Trustpilot or Reddit`,
      category: 'Online Fraud',
      author: 'CyberWatch Kenya Team',
      published: true,
      tags: ['Task Scam', 'Online Fraud', 'Fake Jobs', 'Youth']
    },
    {
      title: 'M-PESA Impersonation Scams: Fake Safaricom Agents',
      description: `Fraudsters are calling Kenyans pretending to be Safaricom customer care agents. They claim there is a problem with your M-PESA account and ask for your PIN or OTP to "fix it."

HOW THEY SOUND CONVINCING:
- They already know your name and phone number (bought from data brokers)
- They spoof the caller ID to show a Safaricom number
- They create panic: "Your account will be suspended in 1 hour"

WHAT THEY STEAL:
- Your M-PESA PIN → Empty your wallet
- Your OTP (One-Time Password) → Take over your account
- Your ID number → Used for loans in your name

SAFARICOM WILL NEVER:
❌ Ask for your M-PESA PIN
❌ Ask you to send money to "verify your account"
❌ Ask for your OTP via phone

IF YOU GET SUCH A CALL:
✅ Hang up immediately
✅ Call official Safaricom line: 0722 000 100
✅ Report to Communications Authority: 0800 722 020`,
      category: 'Mobile Money Scam',
      author: 'CyberWatch Kenya Team',
      published: true,
      tags: ['M-PESA', 'Safaricom', 'Mobile Money', 'Impersonation']
    },
    {
      title: 'Fake Online Shops Targeting Kenyan Buyers on Facebook & Instagram',
      description: `Fake online shops are flooding Facebook and Instagram with too-good-to-be-true deals on electronics, clothes, and appliances. Victims pay via M-PESA or bank transfer and receive nothing, a broken item, or a completely different product.

COMMON FAKE SHOP TACTICS:
- Copied photos from legitimate stores like Jumia
- Prices 50–80% lower than market price
- No physical address or contacts beyond WhatsApp
- Payment only accepted before delivery (no pay-on-delivery option)
- 5-star reviews that are all fake or bot-generated

HOW TO SPOT A FAKE SHOP:
🔍 Search the business name on Google — real shops have history
🔍 Check if the Facebook page was recently created (under 6 months)
🔍 Ask for a video call showing the actual product
🔍 Prefer shops that offer pay-on-delivery or have a physical store

REPORT FAKE SHOPS:
✅ Report to DCI Kenya Cybercrime Unit: cybercrime@dci.go.ke
✅ Report the Facebook/Instagram page using the "Report" button`,
      category: 'E-commerce Fraud',
      author: 'CyberWatch Kenya Team',
      published: true,
      tags: ['Facebook', 'Instagram', 'Online Shopping', 'Fraud']
    }
  ]);

  console.log('📰 Sample scam posts seeded');
}
