/**
 * controllers/mpesaController.js
 *
 * Handles all M-PESA Daraja API operations:
 *
 * 1. getAccessToken()   - Gets a temporary token from Safaricom
 * 2. stkPush()          - Sends payment prompt to subscriber's phone
 * 3. stkCallback()      - Receives payment confirmation from Safaricom
 * 4. checkPayment()     - Manually check if a payment went through
 *
 * ─────────────────────────────────────────────
 * HOW DARAJA STK PUSH WORKS:
 * ─────────────────────────────────────────────
 * 1. Your server calls Safaricom API with phone number + amount
 * 2. Safaricom sends a popup to the user's phone:
 *    "Pay KSh 30 to CyberWatch Kenya? Enter PIN:"
 * 3. User enters their M-PESA PIN
 * 4. Safaricom sends a "callback" to YOUR server confirming payment
 * 5. Your server activates the subscription
 * ─────────────────────────────────────────────
 */

const axios = require('axios');
const moment = require('moment');
const Subscriber = require('../models/Subscriber');
const Subscription = require('../models/Subscription');
const nodemailer = require('nodemailer');

// ─────────────────────────────────────────────
// CONFIGURATION
// Use sandbox URLs for testing, live URLs for production
// ─────────────────────────────────────────────

const DARAJA_BASE_URL = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke'; // TEST MODE

const CONSUMER_KEY    = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const SHORTCODE       = process.env.MPESA_SHORTCODE;       // Your till/paybill number
const PASSKEY         = process.env.MPESA_PASSKEY;         // From Daraja dashboard
const CALLBACK_URL    = process.env.MPESA_CALLBACK_URL;    // Your server's public URL

const SUBSCRIPTION_AMOUNT = 30; // KSh 30 per month

// ─────────────────────────────────────────────
// STEP 1: GET ACCESS TOKEN
// Safaricom requires a fresh token for every API call
// Token expires after 1 hour
// ─────────────────────────────────────────────

async function getAccessToken() {
  try {
    // Encode credentials as Base64 (required by Safaricom)
    const credentials = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');

    const response = await axios.get(
      `${DARAJA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: {
          Authorization: `Basic ${credentials}`
        }
      }
    );

    return response.data.access_token;

  } catch (error) {
    console.error('Daraja token error:', error.response?.data || error.message);
    throw new Error('Failed to get M-PESA access token');
  }
}

// ─────────────────────────────────────────────
// STEP 2: GENERATE PASSWORD
// Safaricom requires a special password for each STK Push
// Password = Base64(Shortcode + Passkey + Timestamp)
// ─────────────────────────────────────────────

function generatePassword() {
  const timestamp = moment().format('YYYYMMDDHHmmss');
  const rawPassword = `${SHORTCODE}${PASSKEY}${timestamp}`;
  const password = Buffer.from(rawPassword).toString('base64');
  return { password, timestamp };
}

// ─────────────────────────────────────────────
// STEP 3: FORMAT PHONE NUMBER
// Safaricom requires format: 2547XXXXXXXX (no +, no 07)
// 0712345678 → 254712345678
// ─────────────────────────────────────────────

function formatPhone(phone) {
  phone = phone.toString().replace(/\s/g, ''); // Remove spaces
  if (phone.startsWith('+254')) return phone.substring(1); // +254... → 254...
  if (phone.startsWith('0'))    return '254' + phone.substring(1); // 07... → 2547...
  if (phone.startsWith('254'))  return phone; // Already correct
  return '254' + phone;
}

// ─────────────────────────────────────────────
// INITIATE STK PUSH
// Called when user clicks "Subscribe & Pay KSh 30"
// ─────────────────────────────────────────────

exports.initiatePayment = async (req, res) => {
  try {
    const { name, email, phone } = req.body;

    // Validate inputs
    if (!name || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Name, email and phone number are required'
      });
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address' });
    }

    const formattedPhone = formatPhone(phone);

    // Check if already has active subscription
    const existingSubscriber = await Subscriber.findOne({ email: email.toLowerCase() });
    if (existingSubscriber) {
      const activeSub = await Subscription.findOne({
        subscriber: existingSubscriber._id,
        status: 'active',
        expiryDate: { $gt: new Date() }
      });

      if (activeSub) {
        return res.status(400).json({
          success: false,
          message: `You already have an active subscription until ${moment(activeSub.expiryDate).format('Do MMMM YYYY')}`
        });
      }
    }

    // Create or find subscriber
    let subscriber = existingSubscriber;
    if (!subscriber) {
      subscriber = await Subscriber.create({
        name,
        email: email.toLowerCase(),
        active: false // Will be activated after payment
      });
    }

    // Get Safaricom access token
    const accessToken = await getAccessToken();
    const { password, timestamp } = generatePassword();

    // Send STK Push to user's phone
    const stkResponse = await axios.post(
      `${DARAJA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: SUBSCRIPTION_AMOUNT,
        PartyA: formattedPhone,         // Customer phone
        PartyB: SHORTCODE,              // Your business number
        PhoneNumber: formattedPhone,    // Phone to receive STK push
        CallBackURL: CALLBACK_URL,      // Where Safaricom sends confirmation
        AccountReference: 'CyberWatch Kenya',
        TransactionDesc: 'Monthly Newsletter Subscription - KSh 30'
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const { MerchantRequestID, CheckoutRequestID, ResponseCode } = stkResponse.data;

    if (ResponseCode !== '0') {
      return res.status(400).json({
        success: false,
        message: 'Failed to initiate M-PESA payment. Please try again.'
      });
    }

    // Save pending subscription to database
    const subscription = await Subscription.create({
      subscriber: subscriber._id,
      phone: formattedPhone,
      amount: SUBSCRIPTION_AMOUNT,
      merchantRequestId: MerchantRequestID,
      checkoutRequestId: CheckoutRequestID,
      status: 'pending'
    });

    res.json({
      success: true,
      message: '📱 M-PESA prompt sent to your phone! Enter your PIN to complete payment.',
      checkoutRequestId: CheckoutRequestID,
      subscriptionId: subscription._id
    });

  } catch (error) {
    console.error('STK Push error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'Payment initiation failed: ' + (error.response?.data?.errorMessage || error.message)
    });
  }
};

// ─────────────────────────────────────────────
// CALLBACK — Safaricom calls this URL after payment
// This is called automatically by Safaricom, not by the user
// Your server must be publicly accessible for this to work
// (Use ngrok for testing locally)
// ─────────────────────────────────────────────

exports.mpesaCallback = async (req, res) => {
  try {
    console.log('📲 M-PESA Callback received:', JSON.stringify(req.body, null, 2));

    const callbackData = req.body.Body?.stkCallback;
    if (!callbackData) {
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = callbackData;

    // Find the pending subscription
    const subscription = await Subscription.findOne({ checkoutRequestId: CheckoutRequestID });
    if (!subscription) {
      console.error('Subscription not found for:', CheckoutRequestID);
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    // ResultCode 0 = SUCCESS, anything else = failure
    if (ResultCode === 0) {
      // Extract M-PESA receipt number from callback metadata
      const items = CallbackMetadata?.Item || [];
      const receiptItem = items.find(i => i.Name === 'MpesaReceiptNumber');
      const mpesaReceiptNumber = receiptItem?.Value || 'N/A';

      // Activate subscription for 30 days
      const startDate = new Date();
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);

      await Subscription.findByIdAndUpdate(subscription._id, {
        status: 'active',
        mpesaReceiptNumber,
        startDate,
        expiryDate
      });

      // Activate the subscriber
      await Subscriber.findByIdAndUpdate(subscription.subscriber, { active: true });

      // Send welcome email
      await sendWelcomeEmail(subscription.subscriber, mpesaReceiptNumber, expiryDate);

      console.log(`✅ Payment confirmed! Receipt: ${mpesaReceiptNumber}`);

    } else {
      // Payment failed or cancelled
      await Subscription.findByIdAndUpdate(subscription._id, { status: 'failed' });
      console.log(`❌ Payment failed: ${ResultDesc}`);
    }

    // Always respond to Safaricom with success to acknowledge receipt
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  } catch (error) {
    console.error('Callback error:', error);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' }); // Always acknowledge
  }
};

// ─────────────────────────────────────────────
// CHECK PAYMENT STATUS
// Frontend polls this every 3 seconds after STK Push
// Until payment is confirmed or failed
// ─────────────────────────────────────────────

exports.checkPaymentStatus = async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;

    const subscription = await Subscription.findOne({ checkoutRequestId })
      .populate('subscriber', 'name email');

    if (!subscription) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    res.json({
      success: true,
      status: subscription.status,
      mpesaReceiptNumber: subscription.mpesaReceiptNumber,
      expiryDate: subscription.expiryDate,
      subscriber: subscription.subscriber
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─────────────────────────────────────────────
// RENEWAL — subscriber pays for another month
// ─────────────────────────────────────────────

exports.renewSubscription = async (req, res) => {
  try {
    const { email, phone } = req.body;

    const subscriber = await Subscriber.findOne({ email: email.toLowerCase() });
    if (!subscriber) {
      return res.status(404).json({ success: false, message: 'Subscriber not found' });
    }

    // Reuse the same STK Push flow
    req.body.name = subscriber.name;
    return exports.initiatePayment(req, res);

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─────────────────────────────────────────────
// ADMIN: GET ALL SUBSCRIPTIONS
// ─────────────────────────────────────────────

exports.getSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find()
      .populate('subscriber', 'name email')
      .sort({ createdAt: -1 });

    const stats = {
      total: subscriptions.length,
      active: subscriptions.filter(s => s.status === 'active').length,
      pending: subscriptions.filter(s => s.status === 'pending').length,
      expired: subscriptions.filter(s => s.status === 'expired').length,
      revenue: subscriptions.filter(s => s.status === 'active').length * 30
    };

    res.json({ success: true, data: subscriptions, stats });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─────────────────────────────────────────────
// AUTO-EXPIRE SUBSCRIPTIONS (run daily via cron)
// ─────────────────────────────────────────────

exports.processExpirations = async () => {
  try {
    const now = new Date();

    // Find subscriptions expiring in 5 days — send reminder
    const reminderDate = new Date();
    reminderDate.setDate(reminderDate.getDate() + 5);

    const needReminder = await Subscription.find({
      status: 'active',
      expiryDate: { $lte: reminderDate, $gt: now },
      reminderSent: false
    }).populate('subscriber');

    for (const sub of needReminder) {
      await sendRenewalReminder(sub.subscriber, sub.expiryDate);
      await Subscription.findByIdAndUpdate(sub._id, { reminderSent: true });
      console.log(`📧 Renewal reminder sent to: ${sub.subscriber.email}`);
    }

    // Expire overdue subscriptions
    const expired = await Subscription.updateMany(
      { status: 'active', expiryDate: { $lt: now } },
      { status: 'expired' }
    );

    // Deactivate expired subscribers
    const expiredSubs = await Subscription.find({
      status: 'expired',
      expiryDate: { $lt: now }
    }).populate('subscriber');

    for (const sub of expiredSubs) {
      await Subscriber.findByIdAndUpdate(sub.subscriber._id, { active: false });
      await sendExpiryEmail(sub.subscriber, sub._id);
    }

    console.log(`⏰ Processed expirations: ${expired.modifiedCount} expired, ${needReminder.length} reminders sent`);

  } catch (error) {
    console.error('Expiration processing error:', error);
  }
};

// ─────────────────────────────────────────────
// EMAIL HELPERS
// ─────────────────────────────────────────────

async function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

async function sendWelcomeEmail(subscriberId, receiptNumber, expiryDate) {
  try {
    const subscriber = await Subscriber.findById(subscriberId);
    if (!subscriber) return;

    const transporter = await getTransporter();
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: subscriber.email,
      subject: '✅ Welcome to CyberWatch Kenya — Payment Confirmed!',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="background:#0a0a0a; font-family:'Courier New',monospace; padding:20px;">
          <div style="max-width:600px; margin:0 auto; background:#0d1117; border:1px solid #1e2d1e; border-radius:8px; padding:32px;">
            <h1 style="color:#00ff41; font-size:24px;">🛡️ CyberWatch Kenya</h1>
            <h2 style="color:#fff;">Payment Confirmed! Welcome aboard.</h2>
            <p style="color:#ccc;">Hi ${subscriber.name},</p>
            <p style="color:#ccc;">Your subscription is now active. You will receive our latest scam alerts directly in your inbox.</p>

            <div style="background:#111827; border:1px solid #1e2d1e; border-radius:8px; padding:20px; margin:24px 0;">
              <p style="color:#00ff41; font-family:monospace; margin:0 0 8px;">PAYMENT RECEIPT</p>
              <p style="color:#ccc; margin:4px 0;">M-PESA Code: <strong style="color:#fff;">${receiptNumber}</strong></p>
              <p style="color:#ccc; margin:4px 0;">Amount: <strong style="color:#fff;">KSh 30</strong></p>
              <p style="color:#ccc; margin:4px 0;">Valid Until: <strong style="color:#fff;">${moment(expiryDate).format('Do MMMM YYYY')}</strong></p>
            </div>

            <p style="color:#ccc;">We will send you a reminder 5 days before your subscription expires.</p>
            <p style="color:#888; font-size:12px; margin-top:24px;">© 2024 CyberWatch Kenya</p>
          </div>
        </body>
        </html>
      `
    });
  } catch (err) {
    console.error('Welcome email error:', err.message);
  }
}

async function sendRenewalReminder(subscriber, expiryDate) {
  try {
    const transporter = await getTransporter();
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: subscriber.email,
      subject: '⚠️ CyberWatch Kenya — Your subscription expires soon',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="background:#0a0a0a; font-family:'Courier New',monospace; padding:20px;">
          <div style="max-width:600px; margin:0 auto; background:#0d1117; border:1px solid #1e2d1e; border-radius:8px; padding:32px;">
            <h1 style="color:#00ff41;">🛡️ CyberWatch Kenya</h1>
            <h2 style="color:#ffcc00;">⚠️ Your subscription expires on ${moment(expiryDate).format('Do MMMM YYYY')}</h2>
            <p style="color:#ccc;">Hi ${subscriber.name},</p>
            <p style="color:#ccc;">Your CyberWatch Kenya subscription expires in 5 days. Renew now to keep receiving scam alerts.</p>
            <div style="text-align:center; margin:32px 0;">
              <a href="${process.env.SITE_URL}/subscribe.html?renew=true&email=${subscriber.email}"
                style="background:#00ff41; color:#000; padding:14px 32px; border-radius:6px; text-decoration:none; font-weight:bold;">
                Renew for KSh 30 →
              </a>
            </div>
            <p style="color:#888; font-size:12px;">© 2024 CyberWatch Kenya</p>
          </div>
        </body>
        </html>
      `
    });
  } catch (err) {
    console.error('Reminder email error:', err.message);
  }
}

async function sendExpiryEmail(subscriber, subscriptionId) {
  try {
    const transporter = await getTransporter();
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: subscriber.email,
      subject: '❌ CyberWatch Kenya — Subscription Expired',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="background:#0a0a0a; font-family:'Courier New',monospace; padding:20px;">
          <div style="max-width:600px; margin:0 auto; background:#0d1117; border:1px solid #1e2d1e; border-radius:8px; padding:32px;">
            <h1 style="color:#00ff41;">🛡️ CyberWatch Kenya</h1>
            <h2 style="color:#ff2244;">Your subscription has expired</h2>
            <p style="color:#ccc;">Hi ${subscriber.name}, your subscription has ended and you will no longer receive scam alerts.</p>
            <p style="color:#ccc;">Renew for just KSh 30/month to stay protected.</p>
            <div style="text-align:center; margin:32px 0;">
              <a href="${process.env.SITE_URL}/subscribe.html?renew=true&email=${subscriber.email}"
                style="background:#00ff41; color:#000; padding:14px 32px; border-radius:6px; text-decoration:none; font-weight:bold;">
                Renew Now — KSh 30 →
              </a>
            </div>
            <p style="color:#888; font-size:12px;">© 2024 CyberWatch Kenya</p>
          </div>
        </body>
        </html>
      `
    });
  } catch (err) {
    console.error('Expiry email error:', err.message);
  }
}
