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
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Request', requestSchema);