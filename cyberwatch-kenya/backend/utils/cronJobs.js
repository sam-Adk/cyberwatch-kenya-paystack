/**
 * utils/cronJobs.js
 *
 * Scheduled tasks:
 * - Daily 8am:    check expiring subscriptions, send reminders
 * - Daily midnight: expire overdue subscriptions
 * - Every Monday 8am: send weekly scam digest to premium subscribers
 */

const cron = require('node-cron');
const { processExpirations } = require('../controllers/paystackController');
const { sendWeeklyDigest }   = require('./weeklyDigest');

function startCronJobs() {

  // ── Daily 8am — subscription checks ──────────
  cron.schedule('0 8 * * *', async () => {
    console.log('⏰ Running daily subscription check...');
    await processExpirations();
  }, { timezone: 'Africa/Nairobi' });

  // ── Daily midnight — expire overdue subs ──────
  cron.schedule('0 0 * * *', async () => {
    console.log('⏰ Midnight subscription cleanup...');
    await processExpirations();
  }, { timezone: 'Africa/Nairobi' });

  // ── Every Monday 8am — weekly digest ─────────
  // Cron: minute hour * * weekday (1 = Monday)
  cron.schedule('0 8 * * 1', async () => {
    console.log('📰 Sending weekly digest to premium subscribers...');
    await sendWeeklyDigest();
  }, { timezone: 'Africa/Nairobi' });

  console.log('✅ Cron jobs started — subscriptions checked daily, digest every Monday 8am');
}

module.exports = { startCronJobs };
