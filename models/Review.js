// Review model 
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  // Review Details
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating cannot exceed 5']
  },
  comment: {
    type: String,
    required: [true, 'Review comment is required'],
    maxlength: [1000, 'Review comment cannot exceed 1000 characters'],
    trim: true
  },
  title: {
    type: String,
    maxlength: [100, 'Review title cannot exceed 100 characters'],
    trim: true
  },

  // Relationships
  customer: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'Customer is required']
  },
  serviceProvider: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'Service provider is required']
  },
  service: {
    type: mongoose.Schema.ObjectId,
    ref: 'Service'
  },
  request: {
    type: mongoose.Schema.ObjectId,
    ref: 'Request'
  },

  // Detailed Ratings
  aspects: {
    quality: {
      type: Number,
      min: 1,
      max: 5
    },
    punctuality: {
      type: Number,
      min: 1,
      max: 5
    },
    professionalism: {
      type: Number,
      min: 1,
      max: 5
    },
    communication: {
      type: Number,
      min: 1,
      max: 5
    },
    value: {
      type: Number,
      min: 1,
      max: 5
    },
    cleanliness: {
      type: Number,
      min: 1,
      max: 5
    }
  },

  // Media
  images: [{
    url: String,
    caption: String,
    thumbnail: String
  }],

  // Review Metadata
  isVerifiedPurchase: {
    type: Boolean,
    default: false
  },
  isAnonymous: {
    type: Boolean,
    default: false
  },
  
  // Response from Service Provider
  response: {
    comment: String,
    respondedAt: Date,
    isPublic: {
      type: Boolean,
      default: true
    }
  },

  // Moderation
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'flagged'],
    default: 'pending'
  },
  moderationNotes: String,
  moderatedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  moderatedAt: Date,

  // Helpfulness
  helpful: {
    count: {
      type: Number,
      default: 0
    },
    users: [{
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    }]
  },
  
  // Reporting
  reports: [{
    user: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    reason: {
      type: String,
      enum: ['inappropriate', 'spam', 'fake', 'offensive', 'irrelevant', 'other']
    },
    comment: String,
    reportedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['pending', 'reviewed', 'resolved'],
      default: 'pending'
    }
  }],

  // Additional Information
  serviceDate: Date,
  projectValue: Number,
  wouldRecommend: {
    type: Boolean,
    default: true
  },
  
  // SEO and Search
  tags: [String],
  
  // Analytics
  analytics: {
    views: {
      type: Number,
      default: 0
    },
    clicks: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
reviewSchema.index({ serviceProvider: 1, rating: -1 });
reviewSchema.index({ customer: 1 });
reviewSchema.index({ service: 1 });
reviewSchema.index({ request: 1 });
reviewSchema.index({ createdAt: -1 });
reviewSchema.index({ status: 1 });
reviewSchema.index({ rating: -1, createdAt: -1 });

// Ensure one review per customer per request
reviewSchema.index(
  { customer: 1, request: 1 },
  { unique: true, sparse: true }
);

// Virtual for average aspect rating
reviewSchema.virtual('aspectsAverage').get(function() {
  if (!this.aspects) return null;
  
  const aspects = Object.values(this.aspects).filter(rating => rating > 0);
  if (aspects.length === 0) return null;
  
  const sum = aspects.reduce((total, rating) => total + rating, 0);
  return Math.round((sum / aspects.length) * 10) / 10;
});

// Virtual for review age
reviewSchema.virtual('reviewAge').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
});

// Pre-save middleware to validate review
reviewSchema.pre('save', async function(next) {
  // Ensure customer cannot review themselves
  if (this.customer.toString() === this.serviceProvider.toString()) {
    next(new Error('Cannot review yourself'));
  }
  
  // Auto-approve verified purchase reviews
  if (this.isVerifiedPurchase && this.status === 'pending') {
    this.status = 'approved';
  }
  
  next();
});

// Post-save middleware to update provider rating
reviewSchema.post('save', async function() {
  if (this.status === 'approved') {
    await this.constructor.updateProviderRating(this.serviceProvider);
    
    if (this.service) {
      await this.constructor.updateServiceRating(this.service);
    }
  }
});

// Post-remove middleware to update provider rating
reviewSchema.post('remove', async function() {
  await this.constructor.updateProviderRating(this.serviceProvider);
  
  if (this.service) {
    await this.constructor.updateServiceRating(this.service);
  }
});

// Static method to update provider rating
reviewSchema.statics.updateProviderRating = async function(providerId) {
  try {
    const stats = await this.aggregate([
      { $match: { serviceProvider: providerId, status: 'approved' } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 }
        }
      }
    ]);

    if (stats.length > 0) {
      await mongoose.model('User').findByIdAndUpdate(providerId, {
        'rating.average': Math.round(stats[0].avgRating * 10) / 10,
        'rating.count': stats[0].totalReviews
      });
    } else {
      await mongoose.model('User').findByIdAndUpdate(providerId, {
        'rating.average': 0,
        'rating.count': 0
      });
    }
  } catch (error) {
    console.error('Error updating provider rating:', error);
  }
};

// Static method to update service rating
reviewSchema.statics.updateServiceRating = async function(serviceId) {
  try {
    const stats = await this.aggregate([
      { $match: { service: serviceId, status: 'approved' } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 }
        }
      }
    ]);

    if (stats.length > 0) {
      await mongoose.model('Service').findByIdAndUpdate(serviceId, {
        'rating.average': Math.round(stats[0].avgRating * 10) / 10,
        'rating.count': stats[0].totalReviews
      });
    } else {
      await mongoose.model('Service').findByIdAndUpdate(serviceId, {
        'rating.average': 0,
        'rating.count': 0
      });
    }
  } catch (error) {
    console.error('Error updating service rating:', error);
  }
};

// Static method to get review statistics
reviewSchema.statics.getReviewStats = async function(providerId) {
  const stats = await this.aggregate([
    { $match: { serviceProvider: providerId, status: 'approved' } },
    {
      $group: {
        _id: null,
        totalReviews: { $sum: 1 },
        averageRating: { $avg: '$rating' },
        ratingDistribution: {
          $push: '$rating'
        },
        averageAspects: {
          $avg: {
            $avg: [
              '$aspects.quality',
              '$aspects.punctuality', 
              '$aspects.professionalism',
              '$aspects.communication',
              '$aspects.value'
            ]
          }
        }
      }
    }
  ]);

  if (stats.length === 0) {
    return {
      totalReviews: 0,
      averageRating: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      averageAspects: 0
    };
  }

  const result = stats[0];
  
  // Calculate rating distribution
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  result.ratingDistribution.forEach(rating => {
    distribution[rating] = (distribution[rating] || 0) + 1;
  });

  return {
    totalReviews: result.totalReviews,
    averageRating: Math.round(result.averageRating * 10) / 10,
    ratingDistribution: distribution,
    averageAspects: Math.round(result.averageAspects * 10) / 10
  };
};

// Instance method to mark as helpful
reviewSchema.methods.markAsHelpful = function(userId) {
  if (!this.helpful.users.includes(userId)) {
    this.helpful.users.push(userId);
    this.helpful.count = this.helpful.users.length;
    return this.save();
  }
  return Promise.resolve(this);
};

// Instance method to unmark as helpful
reviewSchema.methods.unmarkAsHelpful = function(userId) {
  const index = this.helpful.users.indexOf(userId);
  if (index > -1) {
    this.helpful.users.splice(index, 1);
    this.helpful.count = this.helpful.users.length;
    return this.save();
  }
  return Promise.resolve(this);
};

module.exports = mongoose.model('Review', reviewSchema);