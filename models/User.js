// const mongoose = require('mongoose');
// const bcrypt = require('bcryptjs');
// const jwt = require('jsonwebtoken');

// const userSchema = new mongoose.Schema({
//    firstName: {
//     type: String,
//     required: [true, 'First name is required'],
//     trim: true,
//     maxlength: [50, 'First name cannot exceed 50 characters']
//   },
//   lastName: {
//     type: String,
//     required: [true, 'Last name is required'],
//     trim: true,
//     maxlength: [50, 'Last name cannot exceed 50 characters']
//   },
//   email: {
//     type: String,
//     required: [true, 'Email is required'],
//     unique: true,
//     lowercase: true,
//     match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
//   },
//   password: {
//     type: String,
//     required: [true, 'Password is required'],
//     minlength: [6, 'Password must be at least 6 characters'],
//     select: false
//   },
//   phone: {
//     type: String,
//     match: [/^\+?[\d\s-]{10,}$/, 'Please enter a valid phone number'] // Optional as per Bark
//   },
//   userType: {
//     type: String,
//     enum: ['customer', 'service_provider', 'both'],
//     default: 'service_provider' // Default to service_provider for sellers
//   },
//   // New/Updated fields for Bark's process
//   businessName: {
//     type: String,
//     trim: true,
//     maxlength: [100, 'Company name cannot exceed 100 characters'],
//     default: null // Optional
//   },
//   website: {
//     type: String,
//     match: [/^https?:\/\/[^\s$.?#].[^\s]*$/, 'Please enter a valid URL'],
//     default: null // Optional
//   },
//   companySize: {
//     type: String,
//     enum: ['self-employed', '2-10', '11-50', '51-200', '200+'],
//     default: null // Optional
//   },
//   categories: [{
//     type: mongoose.Schema.ObjectId,
//     ref: 'Category',
//     required: [true, 'At least one service category is required']
//   }],
//   isNationwide: {
//     type: Boolean,
//     default: false
//   },
//   serviceRadius: {
//     type: Number,
//     default: 30, // Default to 30 miles as per Bark
//     min: [0, 'Service radius cannot be negative']
//   },
//   location: {
//     type: {
//       type: String,
//       enum: ['Point'],
//       default: 'Point'
//     },
//     coordinates: {
//       type: [Number], // [longitude, latitude]
//       default: [0, 0]
//     },
//     postcode: {
//       type: String,
//       trim: true,
//       match: [/^[A-Z0-9 ]{5,10}$/, 'Please enter a valid postcode'] // Basic UK postcode validation
//     }
//   },
//   // Profile Information
//   avatar: {
//     type: String,
//     default: 'default-avatar.jpg'
//   },
//   bio: {
//     type: String,
//     maxlength: [500, 'Bio cannot exceed 500 characters']
//   },
  
//   // Location
//   address: {
//     street: String,
//     city: String,
//     state: String,
//     zipCode: String,
//     country: String
//   },
 
//   serviceRadius: {
//     type: Number,
//     default: 25 // km
//   },
  
//   // Service Provider Specific Fields
//   businessName: String,
//   businessLicense: String,
//   businessType: {
//     type: String,
//     enum: ['individual', 'company', 'freelancer']
//   },
//   skills: [{
//     type: String,
//     trim: true
//   }],
//   categories: [{
//     type: mongoose.Schema.ObjectId,
//     ref: 'Category'
//   }],
//   experience: {
//     type: Number, // years
//     min: 0,
//     max: 50
//   },
//   hourlyRate: {
//     min: Number,
//     max: Number,
//     currency: {
//       type: String,
//       default: 'USD'
//     }
//   },
//   availability: {
//     days: [{
//       type: String,
//       enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
//     }],
//     hours: {
//       start: String, // "09:00"
//       end: String    // "17:00"
//     },
//     timezone: String
//   },
  
//   // Portfolio
//   portfolio: [{
//     title: String,
//     description: String,
//     images: [String],
//     projectDate: Date,
//     client: String,
//     category: String
//   }],
  
//   // Certifications
//   certifications: [{
//     name: String,
//     issuer: String,
//     issueDate: Date,
//     expiryDate: Date,
//     credentialId: String,
//     imageUrl: String
//   }],
  
//   // Ratings and Reviews
//   rating: {
//     average: {
//       type: Number,
//       default: 0,
//       min: 0,
//       max: 5
//     },
//     count: {
//       type: Number,
//       default: 0
//     }
//   },
//   totalJobs: {
//     type: Number,
//     default: 0
//   },
  
//   // Financial Information
//   earnings: {
//     total: {
//       type: Number,
//       default: 0
//     },
//     thisMonth: {
//       type: Number,
//       default: 0
//     },
//     lastMonth: {
//       type: Number,
//       default: 0
//     }
//   },
  
//   // Account Status
//   isVerified: {
//     type: Boolean,
//     default: false
//   },
//   isActive: {
//     type: Boolean,
//     default: true
//   },
//   isOnline: {
//     type: Boolean,
//     default: false
//   },
//   lastSeen: {
//     type: Date,
//     default: Date.now
//   },
  
//   // Verification
//   emailVerified: {
//     type: Boolean,
//     default: false
//   },
//   phoneVerified: {
//     type: Boolean,
//     default: false
//   },
//   idVerified: {
//     type: Boolean,
//     default: false
//   },
//   backgroundCheckVerified: {
//     type: Boolean,
//     default: false
//   },
  
//   // Tokens
//   emailVerificationToken: String,
//   emailVerificationExpire: Date,
//   resetPasswordToken: String,
//   resetPasswordExpire: Date,
  
//   // Preferences
//   preferences: {
//     notifications: {
//       email: {
//         type: Boolean,
//         default: true
//       },
//       sms: {
//         type: Boolean,
//         default: false
//       },
//       push: {
//         type: Boolean,
//         default: true
//       }
//     },
//     privacy: {
//       showEmail: {
//         type: Boolean,
//         default: false
//       },
//       showPhone: {
//         type: Boolean,
//         default: false
//       },
//       showLastSeen: {
//         type: Boolean,
//         default: true
//       }
//     }
//   },
  
//   // Social Links
//   socialLinks: {
//     website: String,
//     linkedin: String,
//     facebook: String,
//     instagram: String,
//     twitter: String
//   }
// }, {
//   timestamps: true,
//   toJSON: { virtuals: true },
//   toObject: { virtuals: true }
// });

// // Indexes
// userSchema.index({ location: '2dsphere' });
// userSchema.index({ userType: 1 });
// userSchema.index({ categories: 1 });
// userSchema.index({ 'rating.average': -1 });
// userSchema.index({ isActive: 1, isVerified: 1 });

// // Virtual for full name
// userSchema.virtual('fullName').get(function() {
//   return `${this.firstName} ${this.lastName}`;
// });

// // Virtual for reviews
// userSchema.virtual('reviews', {
//   ref: 'Review',
//   localField: '_id',
//   foreignField: 'serviceProvider',
//   justOne: false
// });

// // Encrypt password before saving
// userSchema.pre('save', async function(next) {
//   if (!this.isModified('password')) return next();
  
//   const salt = await bcrypt.genSalt(10);
//   this.password = await bcrypt.hash(this.password, salt);
//   next();
// });

// // Compare password
// userSchema.methods.matchPassword = async function(enteredPassword) {
//   return await bcrypt.compare(enteredPassword, this.password);
// };

// // Generate JWT token
// userSchema.methods.generateToken = function() {
//   return jwt.sign(
//     { id: this._id, userType: this.userType },
//     process.env.JWT_SECRET,
//     { expiresIn: process.env.JWT_EXPIRE }
//   );
// };

// // Calculate distance to another user
// userSchema.methods.calculateDistance = function(targetLocation) {
//   const earthRadius = 6371; // Earth's radius in kilometers
//   const lat1 = this.location.coordinates[1];
//   const lon1 = this.location.coordinates[0];
//   const lat2 = targetLocation.coordinates[1];
//   const lon2 = targetLocation.coordinates[0];
  
//   const dLat = (lat2 - lat1) * Math.PI / 180;
//   const dLon = (lon2 - lon1) * Math.PI / 180;
  
//   const a = 
//     Math.sin(dLat/2) * Math.sin(dLat/2) +
//     Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
//     Math.sin(dLon/2) * Math.sin(dLon/2);
  
//   const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
//   const distance = earthRadius * c;
  
//   return distance;
// };
// userSchema.statics.findNearby = function (coordinates, maxDistance) {
//   return this.find({
//     location: {
//       $near: {
//         $geometry: {
//           type: 'Point',
//           coordinates, // [lon, lat]
//         },
//         $maxDistance: maxDistance, // in meters
//       },
//     },
//   });
// }

// module.exports = mongoose.model('User', userSchema);

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  phone: {
    type: String,
    match: [/^\+?[\d\s-]{10,}$/, 'Please enter a valid phone number']
  },
  userType: {
    type: String,
    enum: ['customer', 'service_provider', 'both'],
    default: 'service_provider'
  },

  // Business Information
  businessName: {
    type: String,
    trim: true,
    maxlength: [100, 'Company name cannot exceed 100 characters']
  },
  website: {
    type: String,
    match: [/^https?:\/\/[^\s$.?#].[^\s]*$/, 'Please enter a valid URL']
  },
  companySize: {
    type: String,
    enum: ['self-employed', '2-10', '11-50', '51-200', '200+']
  },
  businessType: {
    type: String,
    enum: ['individual', 'company', 'freelancer']
  },
  businessLicense: String,

  // Service Information
  categories: [{
    type: mongoose.Schema.ObjectId,
    ref: 'Category',
    required: [true, 'At least one service category is required']
  }],
  skills: [{
    type: String,
    trim: true
  }],
  experience: {
    type: Number,
    min: 0,
    max: 50
  },
  
  // Location
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0]
    },
    address: {
      street: String,
      city: String,
      state: String,
      postcode: {
        type: String,
        trim: true,
        match: [/^[A-Z0-9 ]{5,10}$/, 'Please enter a valid postcode']
      },
      country: {
        type: String,
        default: 'UK'
      }
    }
  },

  // Service Areas
  serviceAreas: [{
    city: String,
    region: String,
    postcode: String,
    radius: Number // km
  }],
  
  isNationwide: {
    type: Boolean,
    default: false
  },
  
  serviceRadius: {
    type: Number,
    default: 30, // km
    min: [0, 'Service radius cannot be negative']
  },

  // Profile Information
  avatar: {
    type: String,
    default: 'default-avatar.jpg'
  },
  bio: {
    type: String,
    maxlength: [500, 'Bio cannot exceed 500 characters']
  },
  
  // Pricing
  hourlyRate: {
    min: Number,
    max: Number,
    currency: {
      type: String,
      default: 'GBP'
    }
  },
  
  // Availability
  availability: {
    days: [{
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    }],
    hours: {
      start: String, // "09:00"
      end: String    // "17:00"
    },
    timezone: String
  },
  
  // Portfolio
  portfolio: [{
    title: String,
    description: String,
    images: [String],
    projectDate: Date,
    client: String,
    category: String
  }],
  
  // Certifications
  certifications: [{
    name: String,
    issuer: String,
    issueDate: Date,
    expiryDate: Date,
    credentialId: String,
    imageUrl: String
  }],
  
  // Ratings and Reviews
  rating: {
    average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    count: {
      type: Number,
      default: 0
    }
  },
  totalJobs: {
    type: Number,
    default: 0
  },
  
  // STRIPE INTEGRATION - Credit System
  credits: {
    type: Number,
    default: 0,
    min: 0,
    index: true
  },
  
  stripeCustomerId: {
    type: String,
    sparse: true, // Allow null but enforce uniqueness when present
    index: true
  },
  
  defaultPaymentMethodId: {
    type: String
  },
  
  // Financial Information
  earnings: {
    total: {
      type: Number,
      default: 0
    },
    thisMonth: {
      type: Number,
      default: 0
    },
    lastMonth: {
      type: Number,
      default: 0
    }
  },
  
  // Statistics for Bark-style system
  stats: {
    totalCreditsPurchased: {
      type: Number,
      default: 0
    },
    totalSpent: {
      type: Number,
      default: 0
    },
    creditsSpent: {
      type: Number,
      default: 0
    },
    leadsContacted: {
      type: Number,
      default: 0
    },
    leadsHired: {
      type: Number,
      default: 0
    },
    responseRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    averageResponseTime: {
      type: Number, // in hours
      default: 24
    }
  },
  
  // Account Status
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  
  // Verification
  emailVerified: {
    type: Boolean,
    default: false
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  idVerified: {
    type: Boolean,
    default: false
  },
  backgroundCheckVerified: {
    type: Boolean,
    default: false
  },
  
  // Tokens
  emailVerificationToken: String,
  emailVerificationExpire: Date,
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  
  // Preferences with Stripe Integration
  preferences: {
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      sms: {
        type: Boolean,
        default: false
      },
      push: {
        type: Boolean,
        default: true
      },
      lowCredits: {
        type: Boolean,
        default: true
      },
      newLeads: {
        type: Boolean,
        default: true
      }
    },
    privacy: {
      showEmail: {
        type: Boolean,
        default: false
      },
      showPhone: {
        type: Boolean,
        default: false
      },
      showLastSeen: {
        type: Boolean,
        default: true
      }
    },
    autoTopUp: {
      enabled: {
        type: Boolean,
        default: false
      },
      threshold: {
        type: Number,
        default: 10 // Auto top-up when credits fall below this
      },
      packageType: {
        type: String,
        enum: ['starter', 'professional', 'business'],
        default: 'starter'
      },
      paymentMethodId: String
    }
  },
  
  // Social Links
  socialLinks: {
    website: String,
    linkedin: String,
    facebook: String,
    instagram: String,
    twitter: String
  },

  // Bookmarked leads
  bookmarkedLeads: [{
    type: mongoose.Schema.ObjectId,
    ref: 'Request'
  }],

  // Blocked customers
  blockedCustomers: [{
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  }],

  // Response time tracking
  responseTime: {
    average: {
      type: Number, // in hours
      default: 24
    },
    target: {
      type: Number, // in hours
      default: 2
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
userSchema.index({ location: '2dsphere' });
userSchema.index({ userType: 1 });
userSchema.index({ categories: 1 });
userSchema.index({ 'rating.average': -1 });
userSchema.index({ isActive: 1, isVerified: 1 });
userSchema.index({ credits: 1 });
userSchema.index({ stripeCustomerId: 1 }, { sparse: true, unique: true });

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for reviews
userSchema.virtual('reviews', {
  ref: 'Review',
  localField: '_id',
  foreignField: 'serviceProvider',
  justOne: false
});

// Virtual for credit transactions
userSchema.virtual('creditTransactions', {
  ref: 'CreditTransaction',
  localField: '_id',
  foreignField: 'user',
  justOne: false
});

// Virtual to check if credits are low
userSchema.virtual('hasLowCredits').get(function() {
  const threshold = this.preferences?.autoTopUp?.threshold || 10;
  return this.credits < threshold;
});

// Encrypt password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate JWT token
userSchema.methods.generateToken = function() {
  return jwt.sign(
    { id: this._id, userType: this.userType },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE }
  );
};

// Calculate distance to another user
userSchema.methods.calculateDistance = function(targetLocation) {
  const earthRadius = 6371; // Earth's radius in kilometers
  const lat1 = this.location.coordinates[1];
  const lon1 = this.location.coordinates[0];
  const lat2 = targetLocation.coordinates[1];
  const lon2 = targetLocation.coordinates[0];
  
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = earthRadius * c;
  
  return distance;
};

// Check if user can afford to contact a lead
userSchema.methods.canAffordLead = function(leadCost) {
  return this.credits >= leadCost;
};

// Deduct credits for lead contact
userSchema.methods.spendCredits = async function(amount, leadId, reason = 'Lead contact') {
  if (this.credits < amount) {
    throw new Error('Insufficient credits');
  }
  
  this.credits -= amount;
  this.stats.creditsSpent = (this.stats.creditsSpent || 0) + amount;
  
  // Create transaction record
  const CreditTransaction = mongoose.model('CreditTransaction');
  await CreditTransaction.create({
    user: this._id,
    type: 'spend',
    amount: -amount,
    leadId,
    status: 'completed',
    balanceAfter: this.credits,
    metadata: {
      reason,
      purpose: 'lead_contact'
    }
  });
  
  await this.save();
  return this.credits;
};

// Add credits to user account
userSchema.methods.addCredits = async function(amount, transactionData = {}) {
  this.credits += amount;
  this.stats.totalCreditsPurchased = (this.stats.totalCreditsPurchased || 0) + amount;
  
  // Create transaction record
  const CreditTransaction = mongoose.model('CreditTransaction');
  await CreditTransaction.create({
    user: this._id,
    type: transactionData.type || 'purchase',
    amount,
    cost: transactionData.cost,
    currency: transactionData.currency || 'gbp',
    stripePaymentIntentId: transactionData.stripePaymentIntentId,
    stripePaymentMethodId: transactionData.stripePaymentMethodId,
    packageType: transactionData.packageType,
    status: 'completed',
    balanceAfter: this.credits,
    metadata: transactionData.metadata || {}
  });
  
  await this.save();
  return this.credits;
};

// Check if auto top-up should be triggered
userSchema.methods.shouldAutoTopUp = function() {
  const autoTopUp = this.preferences?.autoTopUp;
  return autoTopUp?.enabled && 
         autoTopUp.paymentMethodId && 
         this.credits <= (autoTopUp.threshold || 10);
};

// Static method to find users with low credits who have auto top-up enabled
userSchema.statics.findUsersNeedingAutoTopUp = function() {
  return this.find({
    'preferences.autoTopUp.enabled': true,
    'preferences.autoTopUp.paymentMethodId': { $exists: true },
    $expr: {
      $lte: ['$credits', { $ifNull: ['$preferences.autoTopUp.threshold', 10] }]
    }
  });
};

userSchema.statics.findNearby = function (coordinates, maxDistance) {
  return this.find({
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates, // [lon, lat]
        },
        $maxDistance: maxDistance, // in meters
      },
    },
  });
};

module.exports = mongoose.model('User', userSchema);