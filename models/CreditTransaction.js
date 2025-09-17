const mongoose = require('mongoose');

const creditTransactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'User is required'],
    index: true
  },
  
  type: {
    type: String,
    enum: ['purchase', 'spend', 'refund', 'bonus', 'adjustment'],
    required: [true, 'Transaction type is required'],
    index: true
  },
  
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    validate: {
      validator: function(value) {
        // Purchase, bonus, refund should be positive
        // Spend should be negative
        if (this.type === 'spend') {
          return value <= 0;
        } else if (['purchase', 'bonus', 'refund'].includes(this.type)) {
          return value > 0;
        }
        return true; // adjustment can be positive or negative
      },
      message: 'Amount sign must match transaction type'
    }
  },
  
  // For purchases - the cost in real money
  cost: {
    type: Number,
    min: 0
  },
  
  currency: {
    type: String,
    enum: ['gbp', 'usd', 'eur'],
    default: 'gbp'
  },
  
  // Stripe payment details
  stripePaymentIntentId: {
    type: String,
    sparse: true // Allow null but enforce uniqueness when present
  },
  
  stripePaymentMethodId: {
    type: String
  },
  
  stripeChargeId: {
    type: String
  },
  
  // For lead contacts
  leadId: {
    type: mongoose.Schema.ObjectId,
    ref: 'Request'
  },
  
  // Package information for purchases
  packageType: {
    type: String,
    enum: ['starter', 'professional', 'business', 'custom']
  },
  
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded', 'cancelled'],
    default: 'pending',
    index: true
  },
  
  // Reason for refunds or adjustments
  reason: {
    type: String,
    maxlength: 500
  },
  
  failureReason: {
    type: String,
    maxlength: 500
  },
  
  // Balance after this transaction
  balanceAfter: {
    type: Number,
    default: 0
  },
  
  // Additional metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Admin who processed manual transactions
  processedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  
  completedAt: {
    type: Date
  },
  
  refundedAt: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
creditTransactionSchema.index({ user: 1, createdAt: -1 });
creditTransactionSchema.index({ type: 1, status: 1 });
creditTransactionSchema.index({ stripePaymentIntentId: 1 }, { sparse: true, unique: true });
creditTransactionSchema.index({ leadId: 1 }, { sparse: true });

// Virtual for formatted amount
creditTransactionSchema.virtual('formattedAmount').get(function() {
  return this.amount >= 0 ? `+${this.amount}` : `${this.amount}`;
});

// Virtual for transaction description
creditTransactionSchema.virtual('description').get(function() {
  switch (this.type) {
    case 'purchase':
      return `Purchased ${this.amount} credits (${this.packageType} package)`;
    case 'spend':
      return this.leadId ? 
        `Used ${Math.abs(this.amount)} credits to contact lead` : 
        `Spent ${Math.abs(this.amount)} credits`;
    case 'refund':
      return `Refund: ${this.amount} credits`;
    case 'bonus':
      return `Bonus credits: ${this.amount}`;
    case 'adjustment':
      return `Credit adjustment: ${this.formattedAmount}`;
    default:
      return 'Credit transaction';
  }
});

// Static method to get user's transaction summary
creditTransactionSchema.statics.getUserSummary = async function(userId, timeframe = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - timeframe);
  
  const summary = await this.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startDate },
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
  
  return {
    purchased: summary.find(s => s._id === 'purchase')?.totalAmount || 0,
    spent: Math.abs(summary.find(s => s._id === 'spend')?.totalAmount || 0),
    refunded: summary.find(s => s._id === 'refund')?.totalAmount || 0,
    totalCost: summary.reduce((sum, s) => sum + (s.totalCost || 0), 0),
    transactionCount: summary.reduce((sum, s) => sum + s.count, 0)
  };
};

// Method to process transaction and update user balance
creditTransactionSchema.methods.processTransaction = async function() {
  if (this.status !== 'pending') {
    throw new Error('Transaction already processed');
  }
  
  const User = mongoose.model('User');
  const user = await User.findById(this.user);
  
  if (!user) {
    throw new Error('User not found');
  }
  
  // Update user credits
  const previousBalance = user.credits || 0;
  user.credits = Math.max(0, previousBalance + this.amount);
  
  // Set balance after transaction
  this.balanceAfter = user.credits;
  this.status = 'completed';
  this.completedAt = new Date();
  
  // Save both documents
  await user.save();
  await this.save();
  
  return {
    previousBalance,
    newBalance: user.credits,
    amountChanged: this.amount
  };
};

// Pre-save middleware to set balanceAfter for completed transactions
creditTransactionSchema.pre('save', async function(next) {
  if (this.isNew && this.status === 'completed' && !this.balanceAfter) {
    try {
      const User = mongoose.model('User');
      const user = await User.findById(this.user).select('credits');
      this.balanceAfter = (user?.credits || 0) + this.amount;
    } catch (error) {
      // Don't fail the save if we can't calculate balance
    }
  }
  next();
});

module.exports = mongoose.model('CreditTransaction', creditTransactionSchema);