const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // Recipient
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'User is required']
  },

  // Notification Type
  type: {
    type: String,
    required: [true, 'Notification type is required'],
    enum: [
      'new_request',
      'quote_received',
      'quote_accepted',
      'quote_rejected',
      'request_cancelled',
      'project_started',
      'project_completed',
      'payment_received',
      'payment_pending',
      'review_received',
      'message_received',
      'profile_verified',
      'service_approved',
      'service_rejected',
      'reminder',
      'system_update',
      'promotion',
      'welcome'
    ]
  },

  // Content
  title: {
    type: String,
    required: [true, 'Notification title is required'],
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  message: {
    type: String,
    required: [true, 'Notification message is required'],
    maxlength: [500, 'Message cannot exceed 500 characters']
  },
  
  // Status
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  
  // Priority
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },

  // Actions
  actionUrl: String,
  actionLabel: String,
  
  // Additional Data
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Channels
  channels: {
    inApp: {
      type: Boolean,
      default: true
    },
    email: {
      type: Boolean,
      default: false
    },
    sms: {
      type: Boolean,
      default: false
    },
    push: {
      type: Boolean,
      default: false
    }
  },

  // Delivery Status
  deliveryStatus: {
    inApp: {
      status: {
        type: String,
        enum: ['pending', 'delivered', 'failed'],
        default: 'pending'
      },
      deliveredAt: Date,
      error: String
    },
    email: {
      status: {
        type: String,
        enum: ['pending', 'sent', 'delivered', 'failed'],
        default: 'pending'
      },
      sentAt: Date,
      deliveredAt: Date,
      error: String
    },
    sms: {
      status: {
        type: String,
        enum: ['pending', 'sent', 'delivered', 'failed'],
        default: 'pending'
      },
      sentAt: Date,
      deliveredAt: Date,
      error: String
    },
    push: {
      status: {
        type: String,
        enum: ['pending', 'sent', 'delivered', 'failed'],
        default: 'pending'
      },
      sentAt: Date,
      deliveredAt: Date,
      error: String
    }
  },

  // Scheduling
  scheduledFor: Date,
  expiresAt: Date,

  // Grouping
  group: String,
  category: String,

  // Metadata
  metadata: {
    source: String,
    campaign: String,
    version: String,
    tags: [String]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, isRead: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ scheduledFor: 1 });
notificationSchema.index({ expiresAt: 1 });
notificationSchema.index({ priority: 1, createdAt: -1 });

// Virtual for time ago
notificationSchema.virtual('timeAgo').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
});

// Virtual for is expired
notificationSchema.virtual('isExpired').get(function() {
  if (!this.expiresAt) return false;
  return this.expiresAt < new Date();
});

// Virtual for is scheduled
notificationSchema.virtual('isScheduled').get(function() {
  if (!this.scheduledFor) return false;
  return this.scheduledFor > new Date();
});

// Pre-save middleware
notificationSchema.pre('save', function(next) {
  // Mark in-app delivery as delivered when created
  if (this.isNew && this.channels.inApp) {
    this.deliveryStatus.inApp.status = 'delivered';
    this.deliveryStatus.inApp.deliveredAt = new Date();
  }
  
  // Set default expiry (30 days)
  if (!this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  
  next();
});

// Static method to create notification
notificationSchema.statics.createNotification = async function(notificationData) {
  try {
    const notification = new this(notificationData);
    await notification.save();
    
    // Emit socket event if user is online
    const io = require('../server').get('socketio');
    if (io) {
      io.to(`user_${notification.user}`).emit('notification', {
        id: notification._id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        priority: notification.priority,
        data: notification.data,
        createdAt: notification.createdAt
      });
    }
    
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

// Static method to mark as read
notificationSchema.statics.markAsRead = async function(userId, notificationIds) {
  try {
    const result = await this.updateMany(
      {
        user: userId,
        _id: { $in: notificationIds },
        isRead: false
      },
      {
        isRead: true,
        readAt: new Date()
      }
    );
    
    return result;
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    throw error;
  }
};

// Static method to mark all as read
notificationSchema.statics.markAllAsRead = async function(userId) {
  try {
    const result = await this.updateMany(
      {
        user: userId,
        isRead: false
      },
      {
        isRead: true,
        readAt: new Date()
      }
    );
    
    return result;
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
};

// Static method to get unread count
notificationSchema.statics.getUnreadCount = async function(userId) {
  try {
    const count = await this.countDocuments({
      user: userId,
      isRead: false,
      $or: [
        { expiresAt: { $gt: new Date() } },
        { expiresAt: null }
      ]
    });
    
    return count;
  } catch (error) {
    console.error('Error getting unread count:', error);
    return 0;
  }
};

// Static method to clean expired notifications
notificationSchema.statics.cleanExpired = async function() {
  try {
    const result = await this.deleteMany({
      expiresAt: { $lt: new Date() }
    });
    
    console.log(`Cleaned ${result.deletedCount} expired notifications`);
    return result;
  } catch (error) {
    console.error('Error cleaning expired notifications:', error);
    throw error;
  }
};

// Static method to get notifications with pagination
notificationSchema.statics.getNotifications = async function(userId, options = {}) {
  try {
    const {
      page = 1,
      limit = 20,
      type,
      priority,
      unreadOnly = false
    } = options;

    let query = {
      user: userId,
      $or: [
        { expiresAt: { $gt: new Date() } },
        { expiresAt: null }
      ]
    };

    if (type) query.type = type;
    if (priority) query.priority = priority;
    if (unreadOnly) query.isRead = false;

    const skip = (page - 1) * limit;

    const notifications = await this.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await this.countDocuments(query);

    return {
      notifications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    };
  } catch (error) {
    console.error('Error getting notifications:', error);
    throw error;
  }
};

// Instance method to mark as read
notificationSchema.methods.markAsRead = function() {
  if (!this.isRead) {
    this.isRead = true;
    this.readAt = new Date();
    return this.save();
  }
  return Promise.resolve(this);
};

// Instance method to send via email
notificationSchema.methods.sendEmail = async function() {
  try {
    const user = await mongoose.model('User').findById(this.user);
    if (!user || !user.preferences.notifications.email) {
      return { success: false, reason: 'Email notifications disabled' };
    }

    const sendEmail = require('../utils/email');
    
    await sendEmail({
      email: user.email,
      subject: this.title,
      template: 'notification',
      data: {
        name: user.fullName,
        title: this.title,
        message: this.message,
        actionUrl: this.actionUrl,
        actionLabel: this.actionLabel
      }
    });

    this.deliveryStatus.email.status = 'sent';
    this.deliveryStatus.email.sentAt = new Date();
    await this.save();

    return { success: true };
  } catch (error) {
    this.deliveryStatus.email.status = 'failed';
    this.deliveryStatus.email.error = error.message;
    await this.save();
    
    return { success: false, error: error.message };
  }
};

// Instance method to send push notification
notificationSchema.methods.sendPush = async function() {
  try {
    const user = await mongoose.model('User').findById(this.user);
    if (!user || !user.preferences.notifications.push) {
      return { success: false, reason: 'Push notifications disabled' };
    }

    // Implement push notification logic here
    // This would typically integrate with Firebase, OneSignal, etc.
    
    this.deliveryStatus.push.status = 'sent';
    this.deliveryStatus.push.sentAt = new Date();
    await this.save();

    return { success: true };
  } catch (error) {
    this.deliveryStatus.push.status = 'failed';
    this.deliveryStatus.push.error = error.message;
    await this.save();
    
    return { success: false, error: error.message };
  }
};

// Static method for bulk notifications
notificationSchema.statics.sendBulkNotifications = async function(notifications) {
  try {
    const results = {
      successful: 0,
      failed: 0,
      errors: []
    };

    for (const notificationData of notifications) {
      try {
        await this.createNotification(notificationData);
        results.successful++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          notification: notificationData,
          error: error.message
        });
      }
    }

    return results;
  } catch (error) {
    console.error('Error sending bulk notifications:', error);
    throw error;
  }
};

module.exports = mongoose.model('Notification', notificationSchema);