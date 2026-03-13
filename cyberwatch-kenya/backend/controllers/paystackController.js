/**
 * controllers/paystackController.js
 */

const axios = require('axios');
const crypto = require('crypto');
const moment = require('moment');
const Subscriber = require('../models/Subscriber');
const Subscription = require('../models/Subscription');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const SUBSCRIPTION_AMOUNT = 30;
const AMOUNT_IN_KOBO = SUBSCRIPTION_AMOUNT * 100;
const PAYSTACK_URL = 'https://api.paystack.co';

// ─────────────────────────────────────────────
// BREVO HTTP API — replaces nodemailer SMTP
// Works on Render free plan (no port blocking)
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

exports.initializePayment = async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) return res.status(400).json({ success: false, message: 'Name and email are required' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ success: false, message: 'Please enter a valid email address' });

    const existingSubscriber = await Subscriber.findOne({ email: email.toLowerCase() });
    if (existingSubscriber) {
      const activeSub = await Subscription.findOne({ subscriber: existingSubscriber._id, status: 'active', expiryDate: { $gt: new Date() } });
      if (activeSub) return res.status(400).json({ success: false, message: `You already have an active subscription until ${moment(activeSub.expiryDate).format('Do MMMM YYYY')}` });
    }

    const callbackUrl = `${process.env.SITE_URL}/api/paystack/verify`;
    const response = await axios.post(`${PAYSTACK_URL}/transaction/initialize`, {
      email: email.toLowerCase(),
      amount: AMOUNT_IN_KOBO,
      currency: 'KES',
      callback_url: callbackUrl,
      metadata: { name, custom_fields: [{ display_name: 'Subscriber Name', variable_name: 'subscriber_name', value: name }] },
      channels: ['card', 'mobile_money', 'bank_transfer']
    }, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json' } });

    const { authorization_url, reference } = response.data.data;

    let subscriber = existingSubscriber;
    if (!subscriber) {
      subscriber = await Subscriber.create({ name, email: email.toLowerCase(), active: false });
    } else {
      subscriber.name = name;
      await subscriber.save();
    }

    await Subscription.create({ subscriber: subscriber._id, phone: 'N/A', amount: SUBSCRIPTION_AMOUNT, checkoutRequestId: reference, status: 'pending' });
    res.json({ success: true, authorizationUrl: authorization_url, reference });
  } catch (error) {
    console.error('Paystack init error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Failed to initialize payment. Please try again.' });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const { reference } = req.query;
    if (!reference) return res.redirect(`${process.env.SITE_URL}/subscribe.html?error=no_reference`);

    const response = await axios.get(`${PAYSTACK_URL}/transaction/verify/${reference}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } });
    const { status, amount, customer, metadata } = response.data.data;

    if (status === 'success' && amount === AMOUNT_IN_KOBO) {
      await activateSubscription(reference, customer.email, metadata);
      return res.redirect(`${process.env.SITE_URL}/subscribe.html?success=true&reference=${reference}&email=${customer.email}`);
    } else {
      return res.redirect(`${process.env.SITE_URL}/subscribe.html?error=payment_failed`);
    }
  } catch (error) {
    console.error('Paystack verify error:', error.response?.data || error.message);
    res.redirect(`${process.env.SITE_URL}/subscribe.html?error=server_error`);
  }
};

exports.handleWebhook = async (req, res) => {
  try {
    const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(JSON.stringify(req.body)).digest('hex');
    if (hash !== req.headers['x-paystack-signature']) return res.status(400).send('Invalid signature');

    const { event, data } = req.body;
    if (event === 'charge.success' && data.amount === AMOUNT_IN_KOBO) {
      await activateSubscription(data.reference, data.customer.email, data.metadata);
      console.log(`✅ Webhook: Payment confirmed for ${data.customer.email}`);
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).send('OK');
  }
};

async function activateSubscription(reference, email, metadata) {
  try {
    const subscription = await Subscription.findOne({ checkoutRequestId: reference });
    if (!subscription || subscription.status === 'active') return;

    const startDate = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    await Subscription.findByIdAndUpdate(subscription._id, { status: 'active', mpesaReceiptNumber: reference, startDate, expiryDate, reminderSent: false });
    await Subscriber.findByIdAndUpdate(subscription.subscriber, { active: true });
    await sendWelcomeEmail(subscription.subscriber, reference, expiryDate);
    console.log(`✅ Subscription activated for ${email} until ${expiryDate}`);
  } catch (error) {
    console.error('Activation error:', error);
  }
}

exports.checkStatus = async (req, res) => {
  try {
    const { reference } = req.params;
    const subscription = await Subscription.findOne({ checkoutRequestId: reference }).populate('subscriber', 'name email');
    if (!subscription) return res.status(404).json({ success: false, message: 'Payment not found' });
    res.json({ success: true, status: subscription.status, reference: subscription.mpesaReceiptNumber, expiryDate: subscription.expiryDate, subscriber: subscription.subscriber });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find().populate('subscriber', 'name email').sort({ createdAt: -1 });
    const active  = subscriptions.filter(s => s.status === 'active').length;
    const pending = subscriptions.filter(s => s.status === 'pending').length;
    const expired = subscriptions.filter(s => s.status === 'expired').length;
    res.json({ success: true, data: subscriptions, stats: { total: subscriptions.length, active, pending, expired, monthlyRevenue: active * SUBSCRIPTION_AMOUNT, totalRevenue: subscriptions.filter(s => ['active','expired'].includes(s.status)).length * SUBSCRIPTION_AMOUNT } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.processExpirations = async () => {
  try {
    const now = new Date();
    const reminderDate = new Date();
    reminderDate.setDate(reminderDate.getDate() + 5);

    const needReminder = await Subscription.find({ status: 'active', expiryDate: { $lte: reminderDate, $gt: now }, reminderSent: false }).populate('subscriber');
    for (const sub of needReminder) {
      if (sub.subscriber) {
        await sendRenewalReminder(sub.subscriber, sub.expiryDate);
        await Subscription.findByIdAndUpdate(sub._id, { reminderSent: true });
        console.log(`📧 Reminder sent to: ${sub.subscriber.email}`);
      }
    }

    const expiredSubs = await Subscription.find({ status: 'active', expiryDate: { $lt: now } }).populate('subscriber');
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
// EMAIL FUNCTIONS — all use Brevo HTTP API
// ─────────────────────────────────────────────

async function sendWelcomeEmail(subscriberId, reference, expiryDate) {
  try {
    const subscriber = await Subscriber.findById(subscriberId);
    if (!subscriber) return;

    const firstName = subscriber.name.split(' ')[0];
    const expiryFormatted = moment(expiryDate).format('Do MMMM YYYY');

    await sendBrevoEmail({
      to: subscriber.email,
      toName: subscriber.name,
      subject: `🛡️ Welcome to CyberWatch Kenya, ${firstName}! You're now protected.`,
      html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#050a05;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#050a05;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- HEADER -->
        <tr>
          <td style="background:linear-gradient(135deg,#0a1a0a 0%,#0d2010 50%,#0a1a0a 100%);border-radius:12px 12px 0 0;padding:48px 40px 40px;text-align:center;border:1px solid #1a3a1a;border-bottom:none;">
            <div style="background:rgba(0,255,65,0.1);border:2px solid rgba(0,255,65,0.4);border-radius:50%;width:80px;height:80px;line-height:80px;font-size:40px;margin:0 auto 20px;">🛡️</div>
            <h1 style="margin:0 0 4px;font-size:28px;font-weight:800;color:#ffffff;">CyberWatch <span style="color:#00ff41;">Kenya</span></h1>
            <p style="margin:0 0 24px;font-size:12px;color:#00ff41;letter-spacing:3px;font-family:'Courier New',monospace;">CYBERSECURITY INTELLIGENCE</p>
            <div style="width:60px;height:3px;background:linear-gradient(90deg,transparent,#00ff41,transparent);margin:0 auto 28px;"></div>
            <h2 style="margin:0 0 12px;font-size:24px;color:#ffffff;font-weight:700;">Welcome aboard, ${firstName}! 🎉</h2>
            <p style="margin:0;font-size:16px;color:#aad4aa;line-height:1.6;">You are now officially protected by Kenya's most trusted<br>cybersecurity alert network.</p>
          </td>
        </tr>

        <!-- GREEN BAND -->
        <tr>
          <td style="background:#00ff41;padding:16px 40px;border-left:1px solid #1a3a1a;border-right:1px solid #1a3a1a;">
            <p style="margin:0;font-size:13px;color:#000000;font-weight:700;text-align:center;letter-spacing:1px;">🔒 TRUSTED BY KENYANS &nbsp;|&nbsp; 24/7 MONITORING &nbsp;|&nbsp; REAL-TIME ALERTS</p>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="background:#0a150a;padding:40px;border:1px solid #1a3a1a;border-top:none;border-bottom:none;">

            <h3 style="margin:0 0 16px;font-size:18px;color:#00ff41;font-family:'Courier New',monospace;letter-spacing:1px;">// WHO WE ARE</h3>
            <p style="margin:0 0 16px;font-size:15px;color:#ccddcc;line-height:1.8;"><strong style="color:#ffffff;">CyberWatch Kenya</strong> is a cybersecurity intelligence platform dedicated to protecting Kenyans from online scams, phishing attacks, mobile money fraud, and digital threats.</p>
            <p style="margin:0 0 32px;font-size:15px;color:#ccddcc;line-height:1.8;">Our team monitors the digital landscape <strong style="color:#00ff41;">24 hours a day, 7 days a week</strong> — tracking emerging scams, exposing fraudsters, and delivering actionable alerts so you can stay one step ahead of cybercriminals.</p>

            <h3 style="margin:0 0 20px;font-size:18px;color:#00ff41;font-family:'Courier New',monospace;letter-spacing:1px;">// WHAT YOU'LL RECEIVE</h3>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
              <tr><td style="padding:0 0 12px;">
                <table width="100%" cellpadding="16" style="background:#0d1f0d;border:1px solid #1e3a1e;border-radius:8px;">
                  <tr>
                    <td width="44" style="font-size:28px;vertical-align:middle;padding-right:16px;">🚨</td>
                    <td style="vertical-align:middle;padding:0;">
                      <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#ffffff;">Real-Time Scam Alerts</p>
                      <p style="margin:0;font-size:13px;color:#88aa88;">Instant email the moment a new threat is detected targeting Kenyans</p>
                    </td>
                  </tr>
                </table>
              </td></tr>
              <tr><td style="padding:0 0 12px;">
                <table width="100%" cellpadding="16" style="background:#0d1f0d;border:1px solid #1e3a1e;border-radius:8px;">
                  <tr>
                    <td width="44" style="font-size:28px;vertical-align:middle;padding-right:16px;">📱</td>
                    <td style="vertical-align:middle;padding:0;">
                      <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#ffffff;">M-PESA Fraud Warnings</p>
                      <p style="margin:0;font-size:13px;color:#88aa88;">SIM swap attacks, fake Safaricom agents, and mobile money scams</p>
                    </td>
                  </tr>
                </table>
              </td></tr>
              <tr><td style="padding:0 0 12px;">
                <table width="100%" cellpadding="16" style="background:#0d1f0d;border:1px solid #1e3a1e;border-radius:8px;">
                  <tr>
                    <td width="44" style="font-size:28px;vertical-align:middle;padding-right:16px;">💼</td>
                    <td style="vertical-align:middle;padding:0;">
                      <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#ffffff;">Job &amp; Investment Scam Alerts</p>
                      <p style="margin:0;font-size:13px;color:#88aa88;">Fake recruiters, pyramid schemes, and crypto fraud targeting Kenyans</p>
                    </td>
                  </tr>
                </table>
              </td></tr>
              <tr><td style="padding:0 0 12px;">
                <table width="100%" cellpadding="16" style="background:#0d1f0d;border:1px solid #1e3a1e;border-radius:8px;">
                  <tr>
                    <td width="44" style="font-size:28px;vertical-align:middle;padding-right:16px;">🔐</td>
                    <td style="vertical-align:middle;padding:0;">
                      <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#ffffff;">Weekly Cybersecurity Tips</p>
                      <p style="margin:0;font-size:13px;color:#88aa88;">Practical advice to secure your devices, accounts, and personal data</p>
                    </td>
                  </tr>
                </table>
              </td></tr>
              <tr><td>
                <table width="100%" cellpadding="16" style="background:#0d1f0d;border:1px solid #1e3a1e;border-radius:8px;">
                  <tr>
                    <td width="44" style="font-size:28px;vertical-align:middle;padding-right:16px;">🌍</td>
                    <td style="vertical-align:middle;padding:0;">
                      <p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#ffffff;">East Africa Coverage</p>
                      <p style="margin:0;font-size:13px;color:#88aa88;">Threats affecting Kenya, Uganda, Tanzania, and the wider region</p>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>

            <!-- Receipt -->
            <h3 style="margin:0 0 16px;font-size:18px;color:#00ff41;font-family:'Courier New',monospace;letter-spacing:1px;">// YOUR SUBSCRIPTION DETAILS</h3>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#050f05;border:1px solid #00ff41;border-radius:8px;overflow:hidden;margin-bottom:32px;">
              <tr><td style="background:rgba(0,255,65,0.1);padding:12px 20px;border-bottom:1px solid #1a3a1a;">
                <p style="margin:0;font-size:11px;color:#00ff41;letter-spacing:2px;font-family:'Courier New',monospace;">PAYMENT CONFIRMED ✓</p>
              </td></tr>
              <tr><td style="padding:20px;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;font-size:13px;color:#88aa88;">Status</td>
                    <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;text-align:right;font-size:13px;color:#00ff41;font-weight:700;">🟢 ACTIVE</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;font-size:13px;color:#88aa88;">Reference</td>
                    <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;text-align:right;font-size:13px;color:#ffffff;font-family:'Courier New',monospace;">${reference}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;font-size:13px;color:#88aa88;">Amount Paid</td>
                    <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;text-align:right;font-size:13px;color:#ffffff;font-weight:700;">KSh 30</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;font-size:13px;color:#88aa88;">Subscriber</td>
                    <td style="padding:8px 0;border-bottom:1px solid #1a3a1a;text-align:right;font-size:13px;color:#ffffff;">${subscriber.name}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;font-size:13px;color:#88aa88;">Valid Until</td>
                    <td style="padding:8px 0;text-align:right;font-size:13px;color:#00ff41;font-weight:700;">${expiryFormatted}</td>
                  </tr>
                </table>
              </td></tr>
            </table>

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
              <tr><td align="center">
                <a href="${process.env.SITE_URL}" style="display:inline-block;background:#00ff41;color:#000000;font-size:15px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:8px;">
                  🛡️ Visit CyberWatch Kenya →
                </a>
              </td></tr>
            </table>

            <!-- Security Tip -->
            <table width="100%" cellpadding="20" style="background:linear-gradient(135deg,#0a1a0a,#0d2010);border:1px solid #1e3a1e;border-left:4px solid #00ff41;border-radius:0 8px 8px 0;">
              <tr><td>
                <p style="margin:0 0 8px;font-size:11px;color:#00ff41;letter-spacing:2px;font-family:'Courier New',monospace;">💡 SECURITY TIP</p>
                <p style="margin:0;font-size:14px;color:#ccddcc;line-height:1.7;"><strong style="color:#fff;">Never share your M-PESA PIN</strong> with anyone — not even someone claiming to be from Safaricom. Safaricom will <em>never</em> call you asking for your PIN or OTP code.</p>
              </td></tr>
            </table>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#030803;border:1px solid #1a3a1a;border-top:2px solid #0d2010;border-radius:0 0 12px 12px;padding:32px 40px;text-align:center;">
            <p style="margin:0 0 4px;font-size:20px;">🛡️</p>
            <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">CyberWatch Kenya</p>
            <p style="margin:0 0 20px;font-size:12px;color:#557755;font-family:'Courier New',monospace;">Protecting Kenyans Online Since 2024</p>
            <p style="margin:0 0 16px;font-size:12px;color:#557755;">You are receiving this because you subscribed at CyberWatch Kenya.<br>We will send you a renewal reminder 5 days before your subscription expires.</p>
            <p style="margin:0;font-size:11px;color:#334433;">© 2024 CyberWatch Kenya. All rights reserved. &nbsp;|&nbsp; Built to protect Kenyans 🇰🇪</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
    });
    console.log(`📧 Welcome email sent to ${subscriber.email}`);
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
      html: `
<!DOCTYPE html><html>
<body style="margin:0;padding:0;background-color:#050a05;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#050a05;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:linear-gradient(135deg,#1a1000,#2a1a00);border-radius:12px 12px 0 0;padding:40px;text-align:center;border:1px solid #3a2a00;border-bottom:none;">
        <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
        <h1 style="margin:0 0 4px;font-size:24px;color:#ffffff;">CyberWatch <span style="color:#00ff41;">Kenya</span></h1>
        <p style="margin:0 0 20px;font-size:12px;color:#ffcc00;letter-spacing:2px;font-family:'Courier New',monospace;">SUBSCRIPTION EXPIRY NOTICE</p>
        <h2 style="margin:0;font-size:20px;color:#ffcc00;">Your subscription expires on<br>${moment(expiryDate).format('Do MMMM YYYY')}</h2>
      </td></tr>
      <tr><td style="background:#ffcc00;padding:14px 40px;border-left:1px solid #3a2a00;border-right:1px solid #3a2a00;">
        <p style="margin:0;font-size:13px;color:#000;font-weight:700;text-align:center;">⏰ Only 5 days left — Renew now to stay protected</p>
      </td></tr>
      <tr><td style="background:#0a0a05;padding:40px;border:1px solid #3a2a00;border-top:none;border-bottom:none;">
        <p style="font-size:15px;color:#ccddcc;line-height:1.8;">Hi <strong style="color:#fff;">${subscriber.name}</strong>,</p>
        <p style="font-size:15px;color:#ccddcc;line-height:1.8;">Your subscription expires in <strong style="color:#ffcc00;">5 days</strong>. Renew for just <strong style="color:#00ff41;">KSh 30</strong> to stay protected.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:32px 0;">
          <tr><td align="center">
            <a href="${renewUrl}" style="display:inline-block;background:#00ff41;color:#000;font-size:15px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:8px;">🔄 Renew for KSh 30 →</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="background:#030803;border:1px solid #1a3a1a;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">🛡️ CyberWatch Kenya</p>
        <p style="margin:0;font-size:11px;color:#334433;">© 2024 CyberWatch Kenya. Built to protect Kenyans 🇰🇪</p>
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
      html: `
<!DOCTYPE html><html>
<body style="margin:0;padding:0;background-color:#050a05;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#050a05;padding:40px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:linear-gradient(135deg,#1a0000,#2a0505);border-radius:12px 12px 0 0;padding:40px;text-align:center;border:1px solid #3a1010;border-bottom:none;">
        <div style="font-size:48px;margin-bottom:16px;">🔴</div>
        <h1 style="margin:0 0 4px;font-size:24px;color:#ffffff;">CyberWatch <span style="color:#00ff41;">Kenya</span></h1>
        <p style="margin:0 0 20px;font-size:12px;color:#ff4444;letter-spacing:2px;font-family:'Courier New',monospace;">SUBSCRIPTION EXPIRED</p>
        <h2 style="margin:0;font-size:20px;color:#ff4444;">Your subscription has ended</h2>
      </td></tr>
      <tr><td style="background:#ff2244;padding:14px 40px;border-left:1px solid #3a1010;border-right:1px solid #3a1010;">
        <p style="margin:0;font-size:13px;color:#fff;font-weight:700;text-align:center;">❌ You are no longer receiving scam alerts</p>
      </td></tr>
      <tr><td style="background:#0a0505;padding:40px;border:1px solid #3a1010;border-top:none;border-bottom:none;">
        <p style="font-size:15px;color:#ccddcc;line-height:1.8;">Hi <strong style="color:#fff;">${subscriber.name}</strong>,</p>
        <p style="font-size:15px;color:#ccddcc;line-height:1.8;">Your subscription has expired. Renew for just <strong style="color:#00ff41;">KSh 30/month</strong> to get back your protection immediately.</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:32px 0;">
          <tr><td align="center">
            <a href="${renewUrl}" style="display:inline-block;background:#00ff41;color:#000;font-size:15px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:8px;">🛡️ Renew Now — KSh 30 →</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="background:#030803;border:1px solid #1a3a1a;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">🛡️ CyberWatch Kenya</p>
        <p style="margin:0;font-size:11px;color:#334433;">© 2024 CyberWatch Kenya. Built to protect Kenyans 🇰🇪</p>
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
