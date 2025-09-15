const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  selectedProvider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true
  },
  subCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  },
  status: {
    type: String,
    enum: ['published', 'receiving_quotes', 'quotes_received', 'in_progress', 'completed', 'cancelled'],
    default: 'published'
  },
  payment: {
    totalAmount: { type: Number, default: 0 },
    status: { type: String, default: 'pending' }
  },
  quotes: [{
    provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    amount: Number,
    details: String
  }],
  title: String,
  description: String,
  customFields: [{
    name: String,
    value: mongoose.Schema.Types.Mixed // Supports text, number, date, etc.
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },

 analytics: {
    quotesReceived: {
      type: Number,
      default: 0
    },
    views: {
      type: Number,
      default: 0
    },
    contactsInitiated: {
      type: Number,
      default: 0
    },
    contactedProviders: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    leadsGenerated: {
      type: Number,
      default: 0
    }
  },
  

});
requestSchema.index({ 'location.coordinates': '2dsphere' });

// Add indexes for efficient lead matching
requestSchema.index({ category: 1, status: 1, 'location.coordinates': '2dsphere' });
requestSchema.index({ customer: 1, status: 1, createdAt: -1 });

// Add method to check if request can receive quotes
requestSchema.methods.isActive = function() {
  const activeStatuses = ['published', 'receiving_quotes', 'quotes_received'];
  return activeStatuses.includes(this.status) && 
         this.expiresAt && 
         this.expiresAt > new Date();
};

// Add virtual for lead generation count
requestSchema.virtual('totalLeads').get(function() {
  return this.analytics?.leadsGenerated || 0;
});
module.exports = mongoose.model('Request', requestSchema);