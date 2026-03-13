/**
 * utils/cronJobs.js
 *
 * Runs scheduled tasks automatically:
 * - Every day at 8am: check for expiring subscriptions, send reminders
 * - Every day at midnight: expire overdue subscriptions
 *
 * This runs in the background while your server is running.
 * No manual action needed!
 */

const cron = require('node-cron');
const { processExpirations } = require('../controllers/paystackController');

function startCronJobs() {
  // Run every day at 8:00 AM Nairobi time
  // Cron format: minute hour day month weekday
  cron.schedule('0 8 * * *', async () => {
    console.log('⏰ Running daily subscription check...');
    await processExpirations();
  }, {
    timezone: 'Africa/Nairobi'
  });

  // Also run at midnight to catch any missed expirations
  cron.schedule('0 0 * * *', async () => {
    console.log('⏰ Midnight subscription cleanup...');
    await processExpirations();
  }, {
    timezone: 'Africa/Nairobi'
  });

  console.log('✅ Cron jobs started — subscriptions will be checked daily at 8am and midnight');
}

module.exports = { startCronJobs };
