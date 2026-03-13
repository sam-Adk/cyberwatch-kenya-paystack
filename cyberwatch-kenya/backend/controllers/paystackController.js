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

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const SUBSCRIPTION_AMOUNT = 50; // KSh 50
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
        amount: AMOUNT_IN_KOBO,          // Amount in kobo (KSh 50 = 5000 kobo)
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
// ─────────────────────────────────────────────
// EMAIL FUNCTIONS — all use Brevo HTTP API
// ─────────────────────────────────────────────

async function sendBrevoEmail({ to, toName, subject, html }) {
  await axios.post(
    'https://api.brevo.com/v3/smtp/email',
    {
      sender: { name: 'CyberWatch Kenya', email: 'securedatakenya@gmail.com' },
      to: [{ email: to, name: toName }],
      subject,
      htmlContent: html
    },
    {
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
      }
    }
  );
}

async function sendWelcomeEmail(subscriberId, reference, expiryDate) {
  try {
    const subscriber = await Subscriber.findById(subscriberId);
    if (!subscriber) return;

    const firstName = subscriber.name.split(' ')[0];
    const expiryFormatted = moment(expiryDate).format('Do MMMM YYYY');
    const siteUrl = process.env.SITE_URL || 'http://localhost:5000';

    await sendBrevoEmail({
      to: subscriber.email,
      toName: subscriber.name,
      subject: `🛡️ Welcome to CyberWatch Kenya, ${firstName}! You're now a Premium member.`,
      html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#050a05;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#050a05;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- HEADER -->
      <tr>
        <td style="background:linear-gradient(135deg,#0a1000 0%,#1a1f00 50%,#0a1000 100%);border-radius:12px 12px 0 0;padding:48px 40px 40px;text-align:center;border:1px solid #2a3a00;border-bottom:none;">
          <div style="background:rgba(0,204,255,0.1);border:2px solid rgba(0,204,255,0.5);border-radius:50%;width:80px;height:80px;line-height:80px;font-size:40px;margin:0 auto 20px;">⭐</div>
          <h1 style="margin:0 0 4px;font-size:28px;font-weight:800;color:#ffffff;">CyberWatch <span style="color:#00ff41;">Kenya</span></h1>
          <p style="margin:0 0 20px;font-size:12px;color:#00ccff;letter-spacing:3px;font-family:'Courier New',monospace;">PREMIUM MEMBER</p>
          <div style="display:inline-block;background:#00ccff;color:#000;font-size:12px;font-weight:800;padding:6px 20px;border-radius:20px;letter-spacing:1px;margin-bottom:20px;">⭐ PREMIUM SUBSCRIBER</div>
          <h2 style="margin:0 0 12px;font-size:24px;color:#ffffff;font-weight:700;">Welcome, ${firstName}! 🎉</h2>
          <p style="margin:0;font-size:16px;color:#aaccdd;line-height:1.6;">Thank you for supporting CyberWatch Kenya.<br>Your premium subscription is now active.</p>
        </td>
      </tr>

      <!-- CYAN BAND -->
      <tr>
        <td style="background:#00ccff;padding:14px 40px;border-left:1px solid #2a3a00;border-right:1px solid #2a3a00;">
          <p style="margin:0;font-size:13px;color:#000;font-weight:800;text-align:center;letter-spacing:1px;">⭐ PREMIUM &nbsp;|&nbsp; PRIORITY ALERTS &nbsp;|&nbsp; SUPPORTING KENYA'S CYBERSECURITY</p>
        </td>
      </tr>

      <!-- BODY -->
      <tr>
        <td style="background:#0a1205;padding:40px;border:1px solid #2a3a00;border-top:none;border-bottom:none;">

          <h3 style="margin:0 0 16px;font-size:16px;color:#00ccff;font-family:'Courier New',monospace;letter-spacing:1px;">// YOUR PREMIUM BENEFITS</h3>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="padding:0 0 10px;">
              <table width="100%" cellpadding="14" style="background:#0d1f10;border:1px solid #1e3a20;border-radius:8px;">
                <tr>
                  <td width="40" style="font-size:24px;vertical-align:middle;padding-right:12px;">🚨</td>
                  <td style="vertical-align:middle;padding:0;"><p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#fff;">Priority Scam Alerts</p><p style="margin:0;font-size:12px;color:#88aa88;">You get alerts before free subscribers</p></td>
                </tr>
              </table>
            </td></tr>
            <tr><td style="padding:0 0 10px;">
              <table width="100%" cellpadding="14" style="background:#0d1f10;border:1px solid #1e3a20;border-radius:8px;">
                <tr>
                  <td width="40" style="font-size:24px;vertical-align:middle;padding-right:12px;">📱</td>
                  <td style="vertical-align:middle;padding:0;"><p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#fff;">M-PESA Fraud Warnings</p><p style="margin:0;font-size:12px;color:#88aa88;">SIM swap, fake agents, mobile money scams</p></td>
                </tr>
              </table>
            </td></tr>
            <tr><td style="padding:0 0 10px;">
              <table width="100%" cellpadding="14" style="background:#0d1f10;border:1px solid #1e3a20;border-radius:8px;">
                <tr>
                  <td width="40" style="font-size:24px;vertical-align:middle;padding-right:12px;">🌍</td>
                  <td style="vertical-align:middle;padding:0;"><p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#fff;">East Africa Coverage</p><p style="margin:0;font-size:12px;color:#88aa88;">Kenya, Uganda, Tanzania and the wider region</p></td>
                </tr>
              </table>
            </td></tr>
            <tr><td>
              <table width="100%" cellpadding="14" style="background:#0d1520;border:1px solid #1e2a3a;border-radius:8px;border-left:4px solid #00ccff;">
                <tr>
                  <td width="40" style="font-size:24px;vertical-align:middle;padding-right:12px;">💙</td>
                  <td style="vertical-align:middle;padding:0;"><p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#00ccff;">Thank You for Supporting Us</p><p style="margin:0;font-size:12px;color:#88aa88;">Your KSh 50 helps us keep protecting Kenyans</p></td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- Payment Receipt -->
          <h3 style="margin:0 0 14px;font-size:16px;color:#00ccff;font-family:'Courier New',monospace;letter-spacing:1px;">// PAYMENT RECEIPT</h3>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#050f05;border:1px solid #00ccff;border-radius:8px;overflow:hidden;margin-bottom:28px;">
            <tr><td style="background:rgba(0,204,255,0.1);padding:12px 20px;border-bottom:1px solid #1a2a3a;">
              <p style="margin:0;font-size:11px;color:#00ccff;letter-spacing:2px;font-family:'Courier New',monospace;">PAYMENT CONFIRMED ✓</p>
            </td></tr>
            <tr><td style="padding:20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #1a2a1a;font-size:13px;color:#888;">Plan</td>
                  <td style="padding:8px 0;border-bottom:1px solid #1a2a1a;text-align:right;"><span style="background:#00ccff;color:#000;font-size:11px;font-weight:800;padding:3px 10px;border-radius:10px;">⭐ PREMIUM</span></td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #1a2a1a;font-size:13px;color:#888;">Reference</td>
                  <td style="padding:8px 0;border-bottom:1px solid #1a2a1a;text-align:right;font-size:13px;color:#fff;font-family:'Courier New',monospace;">${reference}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #1a2a1a;font-size:13px;color:#888;">Amount</td>
                  <td style="padding:8px 0;border-bottom:1px solid #1a2a1a;text-align:right;font-size:13px;color:#fff;font-weight:700;">KSh 50</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;border-bottom:1px solid #1a2a1a;font-size:13px;color:#888;">Name</td>
                  <td style="padding:8px 0;border-bottom:1px solid #1a2a1a;text-align:right;font-size:13px;color:#fff;">${subscriber.name}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:13px;color:#888;">Valid Until</td>
                  <td style="padding:8px 0;text-align:right;font-size:13px;color:#00ccff;font-weight:700;">${expiryFormatted}</td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td align="center">
              <a href="${siteUrl}" style="display:inline-block;background:#00ccff;color:#000;font-size:15px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:8px;">🛡️ Visit CyberWatch Kenya →</a>
            </td></tr>
          </table>

          <!-- Security tip -->
          <table width="100%" cellpadding="16" style="background:#050f05;border-left:4px solid #00ff41;border-radius:0 8px 8px 0;">
            <tr><td>
              <p style="margin:0 0 6px;font-size:11px;color:#00ff41;letter-spacing:2px;font-family:'Courier New',monospace;">💡 SECURITY TIP</p>
              <p style="margin:0;font-size:14px;color:#ccddcc;line-height:1.7;"><strong style="color:#fff;">Never share your M-PESA PIN</strong> with anyone — not even someone claiming to be from Safaricom. Safaricom will never call asking for your PIN or OTP.</p>
            </td></tr>
          </table>

        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td style="background:#030803;border:1px solid #1a3a1a;border-radius:0 0 12px 12px;padding:28px 40px;text-align:center;">
          <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#fff;">🛡️ CyberWatch Kenya</p>
          <p style="margin:0 0 16px;font-size:12px;color:#557755;font-family:'Courier New',monospace;">Protecting Kenyans Online Since 2024</p>
          <p style="margin:0;font-size:11px;color:#334433;">We will remind you 5 days before your subscription expires.<br>© 2024 CyberWatch Kenya 🇰🇪</p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body></html>`
    });
    console.log(`📧 Premium welcome email sent to ${subscriber.email}`);
  } catch (err) {
    console.error('Welcome email error:', err.response?.data || err.message);
  }
}

async function sendRenewalReminder(subscriber, expiryDate) {
  try {
    const renewUrl = `${process.env.SITE_URL}/subscribe.html?renew=true&email=${subscriber.email}`;
    await sendBrevoEmail({
      to: subscriber.email,
      toName: subscriber.name,
      subject: '⚠️ CyberWatch Kenya — Your subscription expires in 5 days',
      html: `<!DOCTYPE html><html>
<body style="margin:0;padding:0;background-color:#050a05;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#050a05;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:linear-gradient(135deg,#1a1000,#2a1a00);border-radius:12px 12px 0 0;padding:40px;text-align:center;border:1px solid #3a2a00;border-bottom:none;">
        <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
        <h1 style="margin:0 0 4px;font-size:24px;color:#fff;">CyberWatch <span style="color:#00ff41;">Kenya</span></h1>
        <p style="margin:0 0 16px;font-size:12px;color:#ffcc00;letter-spacing:2px;font-family:'Courier New',monospace;">SUBSCRIPTION EXPIRY NOTICE</p>
        <h2 style="margin:0;font-size:20px;color:#ffcc00;">Expires on ${moment(expiryDate).format('Do MMMM YYYY')}</h2>
      </td></tr>
      <tr><td style="background:#ffcc00;padding:14px 40px;border-left:1px solid #3a2a00;border-right:1px solid #3a2a00;">
        <p style="margin:0;font-size:13px;color:#000;font-weight:700;text-align:center;">⏰ 5 days left — Renew now to stay protected</p>
      </td></tr>
      <tr><td style="background:#0a0a05;padding:40px;border:1px solid #3a2a00;border-top:none;border-bottom:none;">
        <p style="font-size:15px;color:#ccddcc;line-height:1.8;">Hi <strong style="color:#fff;">${subscriber.name}</strong>, your premium subscription expires in <strong style="color:#ffcc00;">5 days</strong>. Renew for just <strong style="color:#00ff41;">KSh 50</strong> to stay protected.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
          <tr><td align="center"><a href="${renewUrl}" style="display:inline-block;background:#00ff41;color:#000;font-size:15px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:8px;">🔄 Renew for KSh 50 →</a></td></tr>
        </table>
      </td></tr>
      <tr><td style="background:#030803;border:1px solid #1a3a1a;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#fff;">🛡️ CyberWatch Kenya</p>
        <p style="margin:0;font-size:11px;color:#334433;">© 2024 CyberWatch Kenya 🇰🇪</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
    });
  } catch (err) {
    console.error('Reminder email error:', err.response?.data || err.message);
  }
}

async function sendExpiryEmail(subscriber) {
  try {
    const renewUrl = `${process.env.SITE_URL}/subscribe.html?renew=true&email=${subscriber.email}`;
    await sendBrevoEmail({
      to: subscriber.email,
      toName: subscriber.name,
      subject: '❌ CyberWatch Kenya — Your subscription has expired',
      html: `<!DOCTYPE html><html>
<body style="margin:0;padding:0;background-color:#050a05;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#050a05;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:linear-gradient(135deg,#1a0000,#2a0505);border-radius:12px 12px 0 0;padding:40px;text-align:center;border:1px solid #3a1010;border-bottom:none;">
        <div style="font-size:48px;margin-bottom:16px;">🔴</div>
        <h1 style="margin:0 0 4px;font-size:24px;color:#fff;">CyberWatch <span style="color:#00ff41;">Kenya</span></h1>
        <p style="margin:0 0 16px;font-size:12px;color:#ff4444;letter-spacing:2px;font-family:'Courier New',monospace;">SUBSCRIPTION EXPIRED</p>
        <h2 style="margin:0;font-size:20px;color:#ff4444;">Your subscription has ended</h2>
      </td></tr>
      <tr><td style="background:#ff2244;padding:14px 40px;border-left:1px solid #3a1010;border-right:1px solid #3a1010;">
        <p style="margin:0;font-size:13px;color:#fff;font-weight:700;text-align:center;">❌ You are no longer receiving scam alerts</p>
      </td></tr>
      <tr><td style="background:#0a0505;padding:40px;border:1px solid #3a1010;border-top:none;border-bottom:none;">
        <p style="font-size:15px;color:#ccddcc;line-height:1.8;">Hi <strong style="color:#fff;">${subscriber.name}</strong>, your subscription has expired. Renew for just <strong style="color:#00ff41;">KSh 50/month</strong> to get back your protection immediately.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
          <tr><td align="center"><a href="${renewUrl}" style="display:inline-block;background:#00ff41;color:#000;font-size:15px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:8px;">🛡️ Renew Now — KSh 50 →</a></td></tr>
        </table>
      </td></tr>
      <tr><td style="background:#030803;border:1px solid #1a3a1a;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#fff;">🛡️ CyberWatch Kenya</p>
        <p style="margin:0;font-size:11px;color:#334433;">© 2024 CyberWatch Kenya 🇰🇪</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
    });
  } catch (err) {
    console.error('Expiry email error:', err.response?.data || err.message);
  }
}
