/**
 * controllers/paystackController.js
 *
 * Handles all Paystack payment operations:
 *
 * 1. initializePayment() — Creates a payment session, returns a URL
 * 2. verifyPayment()     — Confirms payment after user pays
 * 3. handleWebhook()     — Paystack calls this automatically after payment
 * 4. getSubscriptions()  — Admin view of all payments
 *
 * ─────────────────────────────────────────────
 * HOW PAYSTACK WORKS:
 * ─────────────────────────────────────────────
 * 1. Your server calls Paystack API → gets a payment link
 * 2. User is sent to that link → Paystack shows payment popup
 * 3. User pays (card, M-PESA, bank transfer)
 * 4. Paystack redirects user back to your site
 * 5. Your server verifies the payment with Paystack
 * 6. Subscription activated ✅
 * ─────────────────────────────────────────────
 */

const axios = require('axios');
const crypto = require('crypto');
const moment = require('moment');
const Subscriber = require('../models/Subscriber');
const Subscription = require('../models/Subscription');
const nodemailer = require('nodemailer');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const SUBSCRIPTION_AMOUNT = 30; // KSh 30
const AMOUNT_IN_KOBO = SUBSCRIPTION_AMOUNT * 100; // Paystack uses kobo (cents)

// Paystack base URL
const PAYSTACK_URL = 'https://api.paystack.co';

// ─────────────────────────────────────────────
// STEP 1: INITIALIZE PAYMENT
// Creates a Paystack payment session
// Returns a URL to redirect the user to
// ─────────────────────────────────────────────

exports.initializePayment = async (req, res) => {
  try {
    const { name, email } = req.body;

    // Validate inputs
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required'
      });
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    // Check for existing active subscription
    const existingSubscriber = await Subscriber.findOne({
      email: email.toLowerCase()
    });

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

    // The URL Paystack redirects to after payment
    const callbackUrl = `${process.env.SITE_URL}/api/paystack/verify`;

    // Call Paystack API to create payment session
    const response = await axios.post(
      `${PAYSTACK_URL}/transaction/initialize`,
      {
        email: email.toLowerCase(),
        amount: AMOUNT_IN_KOBO,          // Amount in kobo (KSh 30 = 3000 kobo)
        currency: 'KES',                  // Kenyan Shillings
        callback_url: callbackUrl,
        metadata: {
          name: name,                     // We store name here since Paystack only takes email
          custom_fields: [
            {
              display_name: 'Subscriber Name',
              variable_name: 'subscriber_name',
              value: name
            }
          ]
        },
        channels: ['card', 'mobile_money', 'bank_transfer'] // Accept all payment methods
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const { authorization_url, reference } = response.data.data;

    // Save subscriber as pending (not active yet)
    let subscriber = existingSubscriber;
    if (!subscriber) {
      subscriber = await Subscriber.create({
        name,
        email: email.toLowerCase(),
        active: false // Will activate after payment confirmed
      });
    } else {
      subscriber.name = name;
      await subscriber.save();
    }

    // Create pending subscription record
    await Subscription.create({
      subscriber: subscriber._id,
      phone: 'N/A',
      amount: SUBSCRIPTION_AMOUNT,
      checkoutRequestId: reference, // We reuse this field for Paystack reference
      status: 'pending'
    });

    res.json({
      success: true,
      authorizationUrl: authorization_url, // Redirect user here
      reference: reference
    });

  } catch (error) {
    console.error('Paystack init error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize payment. Please try again.'
    });
  }
};

// ─────────────────────────────────────────────
// STEP 2: VERIFY PAYMENT
// Called after Paystack redirects user back to your site
// We double-check with Paystack that payment actually went through
// ─────────────────────────────────────────────

exports.verifyPayment = async (req, res) => {
  try {
    const { reference } = req.query;

    if (!reference) {
      return res.redirect(`${process.env.SITE_URL}/subscribe.html?error=no_reference`);
    }

    // Ask Paystack to confirm this payment
    const response = await axios.get(
      `${PAYSTACK_URL}/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`
        }
      }
    );

    const { status, amount, customer, metadata } = response.data.data;

    if (status === 'success' && amount === AMOUNT_IN_KOBO) {
      // Payment confirmed! Activate subscription
      await activateSubscription(reference, customer.email, metadata);

      // Redirect to success page
      return res.redirect(
        `${process.env.SITE_URL}/subscribe.html?success=true&reference=${reference}&email=${customer.email}`
      );

    } else {
      return res.redirect(`${process.env.SITE_URL}/subscribe.html?error=payment_failed`);
    }

  } catch (error) {
    console.error('Paystack verify error:', error.response?.data || error.message);
    res.redirect(`${process.env.SITE_URL}/subscribe.html?error=server_error`);
  }
};

// ─────────────────────────────────────────────
// STEP 3: WEBHOOK (backup confirmation)
// Paystack also calls this URL directly after payment
// This is a backup in case the user closes the browser
// before being redirected back to your site
// ─────────────────────────────────────────────

exports.handleWebhook = async (req, res) => {
  try {
    // SECURITY: Verify the request actually came from Paystack
    // Paystack signs each webhook with your secret key
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.log('❌ Invalid webhook signature — ignoring');
      return res.status(400).send('Invalid signature');
    }

    const { event, data } = req.body;

    // Only process successful charge events
    if (event === 'charge.success') {
      const { reference, amount, customer, metadata } = data;

      if (amount === AMOUNT_IN_KOBO) {
        await activateSubscription(reference, customer.email, metadata);
        console.log(`✅ Webhook: Payment confirmed for ${customer.email}`);
      }
    }

    // Always respond 200 to Paystack to acknowledge receipt
    res.status(200).send('OK');

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).send('OK'); // Always acknowledge
  }
};

// ─────────────────────────────────────────────
// ACTIVATE SUBSCRIPTION HELPER
// Shared by both verify and webhook
// ─────────────────────────────────────────────

async function activateSubscription(reference, email, metadata) {
  try {
    // Find the pending subscription
    const subscription = await Subscription.findOne({
      checkoutRequestId: reference
    });

    if (!subscription || subscription.status === 'active') {
      return; // Already activated or not found
    }

    // Set 30-day subscription period
    const startDate = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    // Update subscription to active
    await Subscription.findByIdAndUpdate(subscription._id, {
      status: 'active',
      mpesaReceiptNumber: reference,
      startDate,
      expiryDate,
      reminderSent: false
    });

    // Activate the subscriber
    await Subscriber.findByIdAndUpdate(subscription.subscriber, {
      active: true,
      plan: 'premium'
    });

    // Send welcome email
    await sendWelcomeEmail(subscription.subscriber, reference, expiryDate);

    console.log(`✅ Subscription activated for ${email} until ${expiryDate}`);

  } catch (error) {
    console.error('Activation error:', error);
  }
}

// ─────────────────────────────────────────────
// CHECK PAYMENT STATUS (frontend polling)
// ─────────────────────────────────────────────

exports.checkStatus = async (req, res) => {
  try {
    const { reference } = req.params;

    const subscription = await Subscription.findOne({
      checkoutRequestId: reference
    }).populate('subscriber', 'name email');

    if (!subscription) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    res.json({
      success: true,
      status: subscription.status,
      reference: subscription.mpesaReceiptNumber,
      expiryDate: subscription.expiryDate,
      subscriber: subscription.subscriber
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─────────────────────────────────────────────
// ADMIN: GET ALL SUBSCRIPTIONS + REVENUE STATS
// ─────────────────────────────────────────────

exports.getSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find()
      .populate('subscriber', 'name email')
      .sort({ createdAt: -1 });

    const active  = subscriptions.filter(s => s.status === 'active').length;
    const pending = subscriptions.filter(s => s.status === 'pending').length;
    const expired = subscriptions.filter(s => s.status === 'expired').length;

    res.json({
      success: true,
      data: subscriptions,
      stats: {
        total: subscriptions.length,
        active,
        pending,
        expired,
        monthlyRevenue: active * SUBSCRIPTION_AMOUNT,      // KSh
        totalRevenue: subscriptions.filter(s =>
          ['active','expired'].includes(s.status)
        ).length * SUBSCRIPTION_AMOUNT
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─────────────────────────────────────────────
// AUTO-EXPIRE SUBSCRIPTIONS (called by cron job)
// ─────────────────────────────────────────────

exports.processExpirations = async () => {
  try {
    const now = new Date();
    const reminderDate = new Date();
    reminderDate.setDate(reminderDate.getDate() + 5);

    // Send renewal reminders (5 days before expiry)
    const needReminder = await Subscription.find({
      status: 'active',
      expiryDate: { $lte: reminderDate, $gt: now },
      reminderSent: false
    }).populate('subscriber');

    for (const sub of needReminder) {
      if (sub.subscriber) {
        await sendRenewalReminder(sub.subscriber, sub.expiryDate);
        await Subscription.findByIdAndUpdate(sub._id, { reminderSent: true });
        console.log(`📧 Reminder sent to: ${sub.subscriber.email}`);
      }
    }

    // Expire overdue subscriptions
    const expiredSubs = await Subscription.find({
      status: 'active',
      expiryDate: { $lt: now }
    }).populate('subscriber');

    for (const sub of expiredSubs) {
      await Subscription.findByIdAndUpdate(sub._id, { status: 'expired' });
      if (sub.subscriber) {
        await Subscriber.findByIdAndUpdate(sub.subscriber._id, { active: false });
        await sendExpiryEmail(sub.subscriber);
      }
    }

    console.log(`⏰ ${expiredSubs.length} expired, ${needReminder.length} reminders sent`);

  } catch (error) {
    console.error('Expiration error:', error);
  }
};

// ─────────────────────────────────────────────
// EMAIL FUNCTIONS
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

async function sendWelcomeEmail(subscriberId, reference, expiryDate) {
  try {
    const subscriber = await Subscriber.findById(subscriberId);
    if (!subscriber) return;

    const transporter = await getTransporter();
    const firstName = subscriber.name.split(' ')[0];
    const expiryFormatted = moment(expiryDate).format('Do MMMM YYYY');

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: subscriber.email,
      subject: `🛡️ Welcome to CyberWatch Kenya, ${firstName}! You're now protected.`,
      html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to CyberWatch Kenya</title>
</head>
<body style="margin:0;padding:0;background-color:#050a05;font-family:Arial,Helvetica,sans-serif;">

  <!-- WRAPPER -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#050a05;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- ═══ HEADER ═══ -->
          <tr>
            <td style="background:linear-gradient(135deg,#0a1a0a 0%,#0d2010 50%,#0a1a0a 100%);border-radius:12px 12px 0 0;padding:48px 40px 40px;text-align:center;border:1px solid #1a3a1a;border-bottom:none;">

              <!-- Shield Logo -->
              <div style="display:inline-block;background:rgba(0,255,65,0.1);border:2px solid rgba(0,255,65,0.4);border-radius:50%;width:80px;height:80px;line-height:80px;font-size:40px;margin-bottom:20px;">🛡️</div>

              <!-- Brand -->
              <h1 style="margin:0 0 4px;font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">
                CyberWatch <span style="color:#00ff41;">Kenya</span>
              </h1>
              <p style="margin:0 0 24px;font-size:12px;color:#00ff41;letter-spacing:3px;font-family:'Courier New',monospace;">
                CYBERSECURITY INTELLIGENCE
              </p>

              <!-- Green divider -->
              <div style="width:60px;height:3px;background:linear-gradient(90deg,transparent,#00ff41,transparent);margin:0 auto 28px;"></div>

              <!-- Welcome headline -->
              <h2 style="margin:0 0 12px;font-size:24px;color:#ffffff;font-weight:700;">
                Welcome aboard, ${firstName}! 🎉
              </h2>
              <p style="margin:0;font-size:16px;color:#aad4aa;line-height:1.6;">
                You are now officially protected by Kenya's most trusted<br>cybersecurity alert network.
              </p>
            </td>
          </tr>

          <!-- ═══ ABOUT US BAND ═══ -->
          <tr>
            <td style="background:#00ff41;padding:16px 40px;border-left:1px solid #1a3a1a;border-right:1px solid #1a3a1a;">
              <p style="margin:0;font-size:13px;color:#000000;font-weight:700;text-align:center;letter-spacing:1px;">
                🔒 TRUSTED BY KENYANS &nbsp;|&nbsp; 24/7 MONITORING &nbsp;|&nbsp; REAL-TIME ALERTS
              </p>
            </td>
          </tr>

          <!-- ═══ MAIN BODY ═══ -->
          <tr>
            <td style="background:#0a150a;padding:40px;border:1px solid #1a3a1a;border-top:none;border-bottom:none;">

              <!-- Who we are -->
              <h3 style="margin:0 0 16px;font-size:18px;color:#00ff41;font-family:'Courier New',monospace;letter-spacing:1px;">
                // WHO WE ARE
              </h3>
              <p style="margin:0 0 16px;font-size:15px;color:#ccddcc;line-height:1.8;">
                <strong style="color:#ffffff;">CyberWatch Kenya</strong> is a cybersecurity intelligence platform dedicated to protecting Kenyans from online scams, phishing attacks, mobile money fraud, and digital threats.
              </p>
              <p style="margin:0 0 32px;font-size:15px;color:#ccddcc;line-height:1.8;">
                Our team monitors the digital landscape <strong style="color:#00ff41;">24 hours a day, 7 days a week</strong> — tracking emerging scams, exposing fraudsters, and delivering actionable alerts so you can stay one step ahead of cybercriminals.
              </p>

              <!-- What you'll receive -->
              <h3 style="margin:0 0 20px;font-size:18px;color:#00ff41;font-family:'Courier New',monospace;letter-spacing:1px;">
                // WHAT YOU'LL RECEIVE
              </h3>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="padding:0 0 12px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1f0d;border:1px solid #1e3a1e;border-radius:8px;padding:16px;">
                      <tr>
                        <td width="44" style="font-size:28px;vertical-align:middle;padding:0 16px 0 4px;">🚨</td>
                        <td style="vertical-align:middle;">
                          <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#ffffff;">Real-Time Scam Alerts</p>
                          <p style="margin:0;font-size:13px;color:#88aa88;">Instant email the moment a new threat is detected targeting Kenyans</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 12px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1f0d;border:1px solid #1e3a1e;border-radius:8px;padding:16px;">
                      <tr>
                        <td width="44" style="font-size:28px;vertical-align:middle;padding:0 16px 0 4px;">📱</td>
                        <td style="vertical-align:middle;">
                          <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#ffffff;">M-PESA Fraud Warnings</p>
                          <p style="margin:0;font-size:13px;color:#88aa88;">SIM swap attacks, fake Safaricom agents, and mobile money scams</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 12px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1f0d;border:1px solid #1e3a1e;border-radius:8px;padding:16px;">
                      <tr>
                        <td width="44" style="font-size:28px;vertical-align:middle;padding:0 16px 0 4px;">💼</td>
                        <td style="vertical-align:middle;">
                          <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#ffffff;">Job & Investment Scam Alerts</p>
                          <p style="margin:0;font-size:13px;color:#88aa88;">Fake recruiters, pyramid schemes, and crypto fraud targeting Kenyans</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 12px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1f0d;border:1px solid #1e3a1e;border-radius:8px;padding:16px;">
                      <tr>
                        <td width="44" style="font-size:28px;vertical-align:middle;padding:0 16px 0 4px;">🔐</td>
                        <td style="vertical-align:middle;">
                          <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#ffffff;">Weekly Cybersecurity Tips</p>
                          <p style="margin:0;font-size:13px;color:#88aa88;">Practical advice to secure your devices, accounts, and personal data</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td>
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1f0d;border:1px solid #1e3a1e;border-radius:8px;padding:16px;">
                      <tr>
                        <td width="44" style="font-size:28px;vertical-align:middle;padding:0 16px 0 4px;">🌍</td>
                        <td style="vertical-align:middle;">
                          <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#ffffff;">East Africa Coverage</p>
                          <p style="margin:0;font-size:13px;color:#88aa88;">Threats affecting Kenya, Uganda, Tanzania, and the wider region</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Payment receipt box -->
              <h3 style="margin:0 0 16px;font-size:18px;color:#00ff41;font-family:'Courier New',monospace;letter-spacing:1px;">
                // YOUR SUBSCRIPTION DETAILS
              </h3>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#050f05;border:1px solid #00ff41;border-radius:8px;overflow:hidden;margin-bottom:32px;">
                <tr>
                  <td style="background:rgba(0,255,65,0.1);padding:12px 20px;border-bottom:1px solid #1a3a1a;">
                    <p style="margin:0;font-size:11px;color:#00ff41;letter-spacing:2px;font-family:'Courier New',monospace;">PAYMENT CONFIRMED ✓</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;">
                          <span style="font-size:13px;color:#88aa88;">Status</span>
                        </td>
                        <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;text-align:right;">
                          <span style="font-size:13px;color:#00ff41;font-weight:700;">🟢 ACTIVE</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;">
                          <span style="font-size:13px;color:#88aa88;">Reference</span>
                        </td>
                        <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;text-align:right;">
                          <span style="font-size:13px;color:#ffffff;font-family:'Courier New',monospace;">${reference}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;">
                          <span style="font-size:13px;color:#88aa88;">Amount Paid</span>
                        </td>
                        <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;text-align:right;">
                          <span style="font-size:13px;color:#ffffff;font-weight:700;">KSh 30</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;">
                          <span style="font-size:13px;color:#88aa88;">Subscriber</span>
                        </td>
                        <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;text-align:right;">
                          <span style="font-size:13px;color:#ffffff;">${subscriber.name}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="font-size:13px;color:#88aa88;">Valid Until</span>
                        </td>
                        <td style="padding:8px 0;text-align:right;">
                          <span style="font-size:13px;color:#00ff41;font-weight:700;">${expiryFormatted}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center">
                    <a href="${process.env.SITE_URL || 'http://localhost:5000'}"
                      style="display:inline-block;background:#00ff41;color:#000000;font-size:15px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:8px;letter-spacing:0.5px;">
                      🛡️ Visit CyberWatch Kenya →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Security tip of the day -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#0a1a0a,#0d2010);border:1px solid #1e3a1e;border-left:4px solid #00ff41;border-radius:0 8px 8px 0;padding:20px;margin-bottom:8px;">
                <tr>
                  <td>
                    <p style="margin:0 0 8px;font-size:11px;color:#00ff41;letter-spacing:2px;font-family:'Courier New',monospace;">💡 SECURITY TIP</p>
                    <p style="margin:0;font-size:14px;color:#ccddcc;line-height:1.7;">
                      <strong style="color:#fff;">Never share your M-PESA PIN</strong> with anyone — not even someone claiming to be from Safaricom. Safaricom will <em>never</em> call you asking for your PIN or OTP code.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- ═══ FOOTER ═══ -->
          <tr>
            <td style="background:#030803;border:1px solid #1a3a1a;border-top:2px solid #0d2010;border-radius:0 0 12px 12px;padding:32px 40px;text-align:center;">

              <p style="margin:0 0 8px;font-size:20px;">🛡️</p>
              <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">CyberWatch Kenya</p>
              <p style="margin:0 0 20px;font-size:12px;color:#557755;font-family:'Courier New',monospace;">Protecting Kenyans Online Since 2024</p>

              <p style="margin:0 0 16px;font-size:12px;color:#557755;">
                You are receiving this because you subscribed at CyberWatch Kenya.<br>
                We will send you a renewal reminder 5 days before your subscription expires.
              </p>

              <p style="margin:0;font-size:11px;color:#334433;">
                © 2024 CyberWatch Kenya. All rights reserved. &nbsp;|&nbsp; Built to protect Kenyans 🇰🇪
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
      `
    });
    console.log(`📧 Welcome email sent to ${subscriber.email}`);
  } catch (err) {
    console.error('Welcome email error:', err.message);
  }
}

async function sendRenewalReminder(subscriber, expiryDate) {
  try {
    const transporter = await getTransporter();
    const renewUrl = `${process.env.SITE_URL}/subscribe.html?renew=true&email=${subscriber.email}`;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: subscriber.email,
      subject: '⚠️ CyberWatch Kenya — Your subscription expires in 5 days',
      html: `
        <!DOCTYPE html><html>
        <body style="background:#0a0a0a;font-family:'Courier New',monospace;padding:20px;">
        <div style="max-width:600px;margin:0 auto;background:#0d1117;border:1px solid #1e2d1e;border-radius:8px;padding:32px;">
          <h1 style="color:#00ff41;">🛡️ CyberWatch Kenya</h1>
          <h2 style="color:#ffcc00;">⚠️ Your subscription expires on ${moment(expiryDate).format('Do MMMM YYYY')}</h2>
          <p style="color:#ccc;">Hi ${subscriber.name}, renew now to keep receiving scam alerts.</p>
          <div style="text-align:center;margin:32px 0;">
            <a href="${renewUrl}" style="background:#00ff41;color:#000;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;">
              Renew for KSh 30 →
            </a>
          </div>
          <p style="color:#555;font-size:11px;">© 2024 CyberWatch Kenya</p>
        </div>
        </body></html>
      `
    });
  } catch (err) {
    console.error('Reminder email error:', err.message);
  }
}

async function sendExpiryEmail(subscriber) {
  try {
    const transporter = await getTransporter();
    const renewUrl = `${process.env.SITE_URL}/subscribe.html?renew=true&email=${subscriber.email}`;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: subscriber.email,
      subject: '❌ CyberWatch Kenya — Your subscription has expired',
      html: `
        <!DOCTYPE html><html>
        <body style="background:#0a0a0a;font-family:'Courier New',monospace;padding:20px;">
        <div style="max-width:600px;margin:0 auto;background:#0d1117;border:1px solid #1e2d1e;border-radius:8px;padding:32px;">
          <h1 style="color:#00ff41;">🛡️ CyberWatch Kenya</h1>
          <h2 style="color:#ff2244;">Your subscription has expired</h2>
          <p style="color:#ccc;">Hi ${subscriber.name}, you will no longer receive scam alerts.</p>
          <p style="color:#ccc;">Renew for just <strong style="color:#00ff41;">KSh 30/month</strong> to stay protected.</p>
          <div style="text-align:center;margin:32px 0;">
            <a href="${renewUrl}" style="background:#00ff41;color:#000;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold;">
              Renew Now — KSh 30 →
            </a>
          </div>
          <p style="color:#555;font-size:11px;">© 2024 CyberWatch Kenya</p>
        </div>
        </body></html>
      `
    });
  } catch (err) {
    console.error('Expiry email error:', err.message);
  }
}
