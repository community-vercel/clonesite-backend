// const mongoose = require('mongoose');

// const requestSchema = new mongoose.Schema({
//   customer: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User',
//     required: true
//   },
//   selectedProvider: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User'
//   },
//   category: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'Category',
//     required: true
//   },
//   subCategory: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'Category'
//   },
//   status: {
//     type: String,
//     enum: ['published', 'receiving_quotes', 'quotes_received', 'in_progress', 'completed', 'cancelled'],
//     default: 'published'
//   },
//   payment: {
//     totalAmount: { type: Number, default: 0 },
//     status: { type: String, default: 'pending' }
//   },
//   quotes: [{
//     provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
//     amount: Number,
//     details: String
//   }],
//   title: String,
//   description: String,
//   customFields: [{
//     name: String,
//     value: mongoose.Schema.Types.Mixed // Supports text, number, date, etc.
//   }],
//   createdAt: { type: Date, default: Date.now },
//   updatedAt: { type: Date, default: Date.now },

//  analytics: {
//     quotesReceived: {
//       type: Number,
//       default: 0
//     },
//     views: {
//       type: Number,
//       default: 0
//     },
//     contactsInitiated: {
//       type: Number,
//       default: 0
//     },
//     contactedProviders: [{
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'User'
//     }],
//     leadsGenerated: {
//       type: Number,
//       default: 0
//     }
//   },
  

// });
// requestSchema.index({ 'location.coordinates': '2dsphere' });

// // Add indexes for efficient lead matching
// requestSchema.index({ category: 1, status: 1, 'location.coordinates': '2dsphere' });
// requestSchema.index({ customer: 1, status: 1, createdAt: -1 });

// // Add method to check if request can receive quotes
// requestSchema.methods.isActive = function() {
//   const activeStatuses = ['published', 'receiving_quotes', 'quotes_received'];
//   return activeStatuses.includes(this.status) && 
//          this.expiresAt && 
//          this.expiresAt > new Date();
// };

// // Add virtual for lead generation count
// requestSchema.virtual('totalLeads').get(function() {
//   return this.analytics?.leadsGenerated || 0;
// });
// module.exports = mongoose.model('Request', requestSchema);

const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  // Customer who made the request
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Selected provider (if any)
  selectedProvider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Category and service type
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true,
    index: true
  },
  subCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  },
  
  // Request details
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    required: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  
  // Dynamic questionnaire answers (Bark-style)
 customFields: [{
    name: String,
    value: mongoose.Schema.Types.Mixed // Supports text, number, date, etc.
  }],
  
  // Location information
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
      index: '2dsphere'
    },
    address: {
      type: String,
      required: true
    },
    city: String,
    region: String,
    postcode: String,
    country: {
      type: String,
      default: 'PK'
    }
  },
  
  // Budget information
  budget: {
    amount: Number,
    currency: {
      type: String,
      default: 'PKR'
    },
    type: {
      type: String,
    },
    flexible: {
      type: Boolean,
      default: true
    }
  },
  
  // Timeline and urgency
  timeline: {
    urgency: {
      type: String,
      index: true
    },
    startDate: Date,
    deadline: Date,
    flexible: {
      type: Boolean,
      default: true
    }
  },
  
  // Request status
  status: {
    type: String,
    enum: [
      'draft', 'published', 'receiving_quotes', 'quotes_received',
      'provider_selected', 'in_progress', 'completed', 'cancelled', 'expired'
    ],
    default: 'published',
    index: true
  },
  
  // Expiration
  expiresAt: {
    type: Date,
    required: true,
    default: function() {
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    },
    index: true
  },
  
  // Quotes from providers
  quotes: [{
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    message: {
      type: String,
      maxlength: [1000, 'Quote message cannot exceed 1000 characters']
    },
    amount: Number,
    details: String,
    contactPhone: String,
    contactEmail: String,
    submittedAt: {
      type: Date,
      default: Date.now
    },
    contactedAt: Date,
    status: {
      type: String,
      enum: ['pending', 'viewed', 'accepted', 'rejected'],
      default: 'pending'
    }
  }],
  
  // Attachments (photos, documents)
  attachments: [{
    type: {
      type: String,
      enum: ['image', 'document', 'video'],
      required: true
    },
    url: {
      type: String,
      required: true
    },
    filename: String,
    size: Number,
    mimeType: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Analytics and tracking
  analytics: {
    views: {
      type: Number,
      default: 0
    },
    quotesReceived: {
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
    },
    responseRate: {
      type: Number,
      default: 0
    },
    averageQuoteAmount: Number,
    firstResponseTime: Date
  },
    createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  // Lead generation settings
  leadSettings: {
    maxProviders: {
      type: Number,
      default: 5,
      min: 1,
      max: 10
    },
    autoExpire: {
      type: Boolean,
      default: true
    },
    allowDirectContact: {
      type: Boolean,
      default: true
    },
    creditCost: {
      type: Number,
      default: 5
    }
  }
});

// Middleware to set location from customer
requestSchema.pre('save', async function(next) {
  if (this.isModified('customer') || this.isNew) {
    const User = mongoose.model('User');
    const customer = await User.findById(this.customer).select('location');
    if (customer && customer.location && customer.location.coordinates) {
      this.location = {
        type: 'Point',
        coordinates: customer.location.coordinates,
        address: customer.location.address || 'Unknown Address',
        city: customer.location.city || '',
        region: customer.location.region || '',
        postcode: customer.location.postcode || '',
        country: customer.location.country || 'PK'
      };
      console.log(`Set location for request ${this._id} from customer ${this.customer}:`, this.location);
    } else {
      // Fallback if customer location is missing
      this.location = {
        type: 'Point',
        coordinates: [73.0479, 33.6844], // Default to Islamabad
        address: 'Default Address',
        city: 'Islamabad',
        region: 'Islamabad Capital Territory',
        postcode: '44000',
        country: 'PK'
      };
      console.warn(`Customer ${this.customer} has no location; using default [73.0479, 33.6844] for request ${this._id}`);
    }
  }
  next();
});

// Add indexes for efficient lead matching
requestSchema.index({ 'location.coordinates': '2dsphere' });
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