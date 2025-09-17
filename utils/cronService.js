// services/cronService.js
const cron = require('node-cron');
const { checkAndProcessAutoTopUps } = require('./stripeUtils');
const User = require('../models/User');
const CreditTransaction = require('../models/CreditTransaction');
const logger = require('../utils/loggerutility');

class CronService {
  constructor() {
    this.jobs = new Map();
  }

  /**
   * Initialize all cron jobs
   */
  init() {
    this.setupAutoTopUpJob();
    this.setupLowCreditsNotificationJob();
    this.setupCleanupJob();
    this.setupAnalyticsJob();
    
    logger.info('Cron service initialized with all jobs');
  }

  /**
   * Auto top-up job - runs every 5 minutes
   */
  setupAutoTopUpJob() {
    const job = cron.schedule('*/5 * * * *', async () => {
      try {
        logger.info('Starting auto top-up check...');
        const result = await checkAndProcessAutoTopUps();
        
        if (result.processed > 0) {
          logger.info(`Auto top-up completed: ${result.successful} successful, ${result.failed} failed`);
        }
      } catch (error) {
        logger.error('Auto top-up cron job error:', error);
      }
    }, {
      scheduled: false,
      timezone: 'Europe/London'
    });

    this.jobs.set('autoTopUp', job);
    logger.info('Auto top-up cron job scheduled (every 5 minutes)');
  }

  /**
   * Low credits notification job - runs every hour
   */
  setupLowCreditsNotificationJob() {
    const job = cron.schedule('0 * * * *', async () => {
      try {
        logger.info('Checking for users with low credits...');
        
        const usersWithLowCredits = await User.find({
          credits: { $lt: 10 },
          'preferences.notifications.lowCredits': true,
          'preferences.autoTopUp.enabled': { $ne: true }, // Don't notify if auto top-up is enabled
          isActive: true
        }).select('firstName lastName email credits preferences');

        for (const user of usersWithLowCredits) {
          // Here you would send notification (email, push, etc.)
          // For now, just log
          logger.info(`User ${user._id} has low credits (${user.credits}). Notification should be sent.`);
          
          // You can integrate with your email service here
          // await emailService.sendLowCreditsNotification(user);
        }

        if (usersWithLowCredits.length > 0) {
          logger.info(`Processed low credit notifications for ${usersWithLowCredits.length} users`);
        }

      } catch (error) {
        logger.error('Low credits notification job error:', error);
      }
    }, {
      scheduled: false,
      timezone: 'Europe/London'
    });

    this.jobs.set('lowCreditsNotification', job);
    logger.info('Low credits notification job scheduled (hourly)');
  }

  /**
   * Cleanup job - runs daily at 2 AM
   */
  setupCleanupJob() {
    const job = cron.schedule('0 2 * * *', async () => {
      try {
        logger.info('Starting daily cleanup job...');
        
        // Clean up old pending transactions (older than 24 hours)
        const oneDayAgo = new Date();
        oneDayAgo.setHours(oneDayAgo.getHours() - 24);
        
        const expiredTransactions = await CreditTransaction.updateMany(
          {
            status: 'pending',
            createdAt: { $lt: oneDayAgo }
          },
          {
            status: 'cancelled',
            failureReason: 'Transaction expired after 24 hours'
          }
        );

        if (expiredTransactions.modifiedCount > 0) {
          logger.info(`Cancelled ${expiredTransactions.modifiedCount} expired transactions`);
        }

        // Clean up users who haven't verified email after 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const unverifiedUsers = await User.find({
          emailVerified: false,
          createdAt: { $lt: sevenDaysAgo },
          isActive: true
        });

        // You might want to send a final reminder email before deactivating
        // or just mark them as inactive
        for (const user of unverifiedUsers) {
          user.isActive = false;
          await user.save();
          logger.info(`Deactivated unverified user: ${user.email}`);
        }

        logger.info('Daily cleanup job completed');

      } catch (error) {
        logger.error('Cleanup job error:', error);
      }
    }, {
      scheduled: false,
      timezone: 'Europe/London'
    });

    this.jobs.set('cleanup', job);
    logger.info('Cleanup job scheduled (daily at 2 AM)');
  }

  /**
   * Analytics job - runs daily at 3 AM
   */
  setupAnalyticsJob() {
    const job = cron.schedule('0 3 * * *', async () => {
      try {
        logger.info('Starting daily analytics job...');
        
        // Calculate daily statistics
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        
        const endOfYesterday = new Date(yesterday);
        endOfYesterday.setHours(23, 59, 59, 999);

        // Get transaction statistics for yesterday
        const dailyStats = await CreditTransaction.aggregate([
          {
            $match: {
              createdAt: { $gte: yesterday, $lte: endOfYesterday },
              status: 'completed'
            }
          },
          {
            $group: {
              _id: '$type',
              totalAmount: { $sum: '$amount' },
              totalCost: { $sum: '$cost' },
              count: { $sum: 1 }
            }
          }
        ]);

        // Get active users count
        const activeUsers = await User.countDocuments({
          isActive: true,
          lastSeen: { $gte: yesterday }
        });

        // Get new registrations
        const newUsers = await User.countDocuments({
          createdAt: { $gte: yesterday, $lte: endOfYesterday }
        });

        const analytics = {
          date: yesterday.toISOString().split('T')[0],
          activeUsers,
          newUsers,
          transactions: dailyStats.reduce((acc, stat) => {
            acc[stat._id] = {
              count: stat.count,
              amount: stat.totalAmount,
              cost: stat.totalCost || 0
            };
            return acc;
          }, {}),
          totalRevenue: dailyStats
            .filter(s => s._id === 'purchase')
            .reduce((sum, s) => sum + (s.totalCost || 0), 0)
        };

        logger.info('Daily analytics calculated:', analytics);
        
        // Here you would save to your analytics database or send to analytics service
        // await analyticsService.saveDailyStats(analytics);

      } catch (error) {
        logger.error('Analytics job error:', error);
      }
    }, {
      scheduled: false,
      timezone: 'Europe/London'
    });

    this.jobs.set('analytics', job);
    logger.info('Analytics job scheduled (daily at 3 AM)');
  }

  /**
   * Start all cron jobs
   */
  start() {
    this.jobs.forEach((job, name) => {
      job.start();
      logger.info(`Started cron job: ${name}`);
    });
  }

  /**
   * Stop all cron jobs
   */
  stop() {
    this.jobs.forEach((job, name) => {
      job.stop();
      logger.info(`Stopped cron job: ${name}`);
    });
  }

  /**
   * Get status of all jobs
   */
  getStatus() {
    const status = {};
    this.jobs.forEach((job, name) => {
      status[name] = {
        running: job.running || false,
        scheduled: job.scheduled || false
      };
    });
    return status;
  }

  /**
   * Start specific job
   */
  startJob(jobName) {
    const job = this.jobs.get(jobName);
    if (job) {
      job.start();
      logger.info(`Started cron job: ${jobName}`);
      return true;
    }
    return false;
  }

  /**
   * Stop specific job
   */
  stopJob(jobName) {
    const job = this.jobs.get(jobName);
    if (job) {
      job.stop();
      logger.info(`Stopped cron job: ${jobName}`);
      return true;
    }
    return false;
  }

  /**
   * Manually trigger auto top-up check (for testing)
   */
  async triggerAutoTopUp() {
    try {
      logger.info('Manually triggering auto top-up check...');
      const result = await checkAndProcessAutoTopUps();
      logger.info('Manual auto top-up check completed:', result);
      return result;
    } catch (error) {
      logger.error('Manual auto top-up trigger error:', error);
      throw error;
    }
  }
}

// Create singleton instance
const cronService = new CronService();

module.exports = cronService;

// Additional utility for server.js integration
module.exports.initializeCronJobs = () => {
  if (process.env.NODE_ENV !== 'test') { // Don't run cron jobs during testing
    cronService.init();
    cronService.start();
    
    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, stopping cron jobs...');
      cronService.stop();
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, stopping cron jobs...');
      cronService.stop();
    });
  }
};