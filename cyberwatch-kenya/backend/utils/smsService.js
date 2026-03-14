/**
 * utils/smsService.js
 * Sends SMS alerts to premium subscribers via Africa's Talking
 */

const AfricasTalking = require('africastalking');
const Subscriber = require('../models/Subscriber');

const AT = AfricasTalking({
  apiKey:   process.env.AT_API_KEY,
  username: process.env.AT_USERNAME
});

const sms = AT.SMS;

// ─────────────────────────────────────────────
// FORMAT KENYAN PHONE NUMBER
// Converts 07xx, 01xx, +254xx → +254xxxxxxxxx
// ─────────────────────────────────────────────
function formatPhone(phone) {
  if (!phone) return null;
  const clean = phone.replace(/\s+/g, '').replace(/-/g, '');
  if (clean.startsWith('+254')) return clean;
  if (clean.startsWith('254'))  return '+' + clean;
  if (clean.startsWith('0'))    return '+254' + clean.slice(1);
  if (clean.startsWith('7') || clean.startsWith('1')) return '+254' + clean;
  return null;
}

// ─────────────────────────────────────────────
// SEND SCAM ALERT SMS TO PREMIUM SUBSCRIBERS
// ─────────────────────────────────────────────
async function sendAlertSMS(newsletter) {
  try {
    const siteUrl = process.env.SITE_URL || 'https://cyberwatch-kenya.onrender.com';

    // Get premium subscribers with phone numbers and SMS enabled
    const subscribers = await Subscriber.find({
      active:     true,
      plan:       'premium',
      smsEnabled: true,
      phone:      { $nin: [null, ''] }
    });

    if (subscribers.length === 0) {
      console.log('📵 No premium subscribers with phone numbers — skipping SMS');
      return { sent: 0, failed: 0 };
    }

    // Build SMS message (160 chars max for single SMS)
    const preview = newsletter.description.length > 80
      ? newsletter.description.substring(0, 80).trim() + '...'
      : newsletter.description;

    const message =
      `🛡️ CyberWatch Kenya ALERT\n` +
      `⚠️ ${newsletter.category}\n` +
      `${newsletter.title}\n\n` +
      `${preview}\n\n` +
      `Full alert: ${siteUrl}`;

    // Format all phone numbers
    const recipients = subscribers
      .map(s => formatPhone(s.phone))
      .filter(Boolean);

    if (recipients.length === 0) {
      console.log('📵 No valid phone numbers found');
      return { sent: 0, failed: 0 };
    }

    console.log(`📱 Sending SMS to ${recipients.length} premium subscribers...`);

    // Africa's Talking supports bulk SMS — send all at once
    // Note: Remove 'from' to use default shortcode (no approval needed)
    const sendOptions = {
      to:      recipients,
      message: message,
    };
    // Only use sender ID if explicitly set (requires AT approval)
    if (process.env.AT_SENDER_ID) {
      sendOptions.from = process.env.AT_SENDER_ID;
    }

    const result = await sms.send(sendOptions);

    const responses = result.SMSMessageData?.Recipients || [];
    const sent      = responses.filter(r => r.status === 'Success').length;
    const failed    = responses.filter(r => r.status !== 'Success').length;

    console.log(`📱 SMS done — ${sent} sent, ${failed} failed`);
    console.log('📱 Full AT response:', JSON.stringify(responses, null, 2));
    return { sent, failed };

  } catch (error) {
    console.error('SMS error:', error.message);
    return { sent: 0, failed: 0, error: error.message };
  }
}

// ─────────────────────────────────────────────
// SEND WELCOME SMS TO NEW PREMIUM SUBSCRIBER
// ─────────────────────────────────────────────
async function sendWelcomeSMS(phone, name) {
  try {
    const formatted = formatPhone(phone);
    if (!formatted) return;

    const firstName = name.split(' ')[0];
    const message =
      `🛡️ Welcome to CyberWatch Kenya Premium, ${firstName}!\n\n` +
      `You will now receive instant SMS scam alerts before fraudsters can reach you.\n\n` +
      `Stay safe! — CyberWatch Kenya Team`;

    const welcomeOptions = { to: [formatted], message };
    if (process.env.AT_SENDER_ID) welcomeOptions.from = process.env.AT_SENDER_ID;
    await sms.send(welcomeOptions);

    console.log(`📱 Welcome SMS sent to ${formatted}`);
  } catch (error) {
    console.error('Welcome SMS error:', error.message);
  }
}

module.exports = { sendAlertSMS, sendWelcomeSMS, formatPhone };
