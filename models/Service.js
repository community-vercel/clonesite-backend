// Service model 
const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  // Basic Information
  title: {
    type: String,
    required: [true, 'Service title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Service description is required'],
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  shortDescription: {
    type: String,
    maxlength: [200, 'Short description cannot exceed 200 characters']
  },
  
  // Service Provider
  provider: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'Service provider is required']
  },
  
  // Category
  category: {
    type: mongoose.Schema.ObjectId,
    ref: 'Category',
    required: [true, 'Service category is required']
  },
  subCategory: {
    type: mongoose.Schema.ObjectId,
    ref: 'Category'
  },
  
  // Pricing
  pricing: {
    type: {
      type: String,
      enum: ['hourly', 'fixed', 'per_project', 'per_item', 'per_sqft', 'negotiable'],
      required: [true, 'Pricing type is required']
    },
    amount: {
      min: Number,
      max: Number
    },
    currency: {
      type: String,
      default: 'USD'
    },
    unit: String // e.g., 'per hour', 'per room', 'per sq ft'
  },
  
  // Location and Availability
  serviceAreas: [{
    city: String,
    state: String,
    zipCodes: [String],
    radius: Number // in kilometers
  }],
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    }
  },
  
  // Service Details
  duration: {
    min: Number, // in minutes
    max: Number,
    unit: {
      type: String,
      enum: ['minutes', 'hours', 'days', 'weeks'],
      default: 'hours'
    }
  },
  
  // Images and Media
  images: [{
    url: {
      type: String,
      required: true
    },
    caption: String,
    isPrimary: {
      type: Boolean,
      default: false
    }
  }],
  videos: [{
    url: String,
    thumbnail: String,
    caption: String
  }],
  
  // Service Features
  features: [String],
  whatsIncluded: [String],
  whatsNotIncluded: [String],
  
  // Requirements
  requirements: [String],
  
  // Availability
  availability: {
    schedule: {
      monday: { available: Boolean, hours: [{ start: String, end: String }] },
      tuesday: { available: Boolean, hours: [{ start: String, end: String }] },
      wednesday: { available: Boolean, hours: [{ start: String, end: String }] },
      thursday: { available: Boolean, hours: [{ start: String, end: String }] },
      friday: { available: Boolean, hours: [{ start: String, end: String }] },
      saturday: { available: Boolean, hours: [{ start: String, end: String }] },
      sunday: { available: Boolean, hours: [{ start: String, end: String }] }
    },
    leadTime: {
      type: Number,
      default: 24 // hours
    },
    maxAdvanceBooking: {
      type: Number,
      default: 30 // days
    }
  },
  
  // Statistics and Performance
  stats: {
    views: {
      type: Number,
      default: 0
    },
    inquiries: {
      type: Number,
      default: 0
    },
    bookings: {
      type: Number,
      default: 0
    },
    completedJobs: {
      type: Number,
      default: 0
    }
  },
  
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
  
  // Service Status
  isActive: {
    type: Boolean,
    default: true
  },
  isPaused: {
    type: Boolean,
    default: false
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  
  // SEO and Marketing
  seo: {
    title: String,
    description: String,
    keywords: [String]
  },
  tags: [String],
  
  // Additional Options
  options: [{
    name: String,
    description: String,
    price: Number,
    required: {
      type: Boolean,
      default: false
    }
  }],
  
  // Frequently Asked Questions
  faqs: [{
    question: String,
    answer: String,
    order: {
      type: Number,
      default: 0
    }
  }],
  
  // Service Packages
  packages: [{
    name: String,
    description: String,
    price: Number,
    features: [String],
    duration: Number,
    isPopular: {
      type: Boolean,
      default: false
    }
  }],
  
  // Quality Assurance
  qualityChecks: [{
    name: String,
    description: String,
    passed: {
      type: Boolean,
      default: false
    },
    checkedAt: Date,
    checkedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    }
  }],
  
  // Compliance and Licensing
  licenses: [{
    name: String,
    number: String,
    issuer: String,
    expiryDate: Date,
    verified: {
      type: Boolean,
      default: false
    }
  }],
  
  // Insurance
  insurance: {
    hasInsurance: {
      type: Boolean,
      default: false
    },
    provider: String,
    policyNumber: String,
    coverage: Number,
    expiryDate: Date
  },
  
  // Response Time
  responseTime: {
    average: {
      type: Number,
      default: 0 // in hours
    },
    target: {
      type: Number,
      default: 24 // in hours
    }
  },
  
  // Cancellation Policy
  cancellationPolicy: {
    type: String,
    enum: ['flexible', 'moderate', 'strict'],
    default: 'moderate'
  },
  
  // Service History
  serviceHistory: {
    totalRevenue: {
      type: Number,
      default: 0
    },
    lastBooking: Date,
    popularTimes: [{
      day: String,
      hours: [String]
    }]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
serviceSchema.index({ location: '2dsphere' });
serviceSchema.index({ provider: 1 });
serviceSchema.index({ category: 1 });
serviceSchema.index({ 'pricing.type': 1 });
serviceSchema.index({ 'rating.average': -1 });
serviceSchema.index({ isActive: 1, isPaused: 1 });
serviceSchema.index({ createdAt: -1 });
serviceSchema.index({ title: 'text', description: 'text', tags: 'text' });

// Virtual for reviews
serviceSchema.virtual('reviews', {
  ref: 'Review',
  localField: '_id',
  foreignField: 'service',
  justOne: false
});

// Virtual for primary image
serviceSchema.virtual('primaryImage').get(function() {
  const primaryImg = this.images.find(img => img.isPrimary);
  return primaryImg ? primaryImg.url : (this.images.length > 0 ? this.images[0].url : 'default-service.jpg');
});

// Virtual for price display
serviceSchema.virtual('priceDisplay').get(function() {
  if (this.pricing.type === 'negotiable') {
    return 'Price negotiable';
  }
  
  const { min, max, currency } = this.pricing.amount || {};
  const symbol = currency === 'USD' ?  currency:'';
  
  if (min && max && min !== max) {
    return `${symbol}${min} - ${symbol}${max}`;
  } else if (min) {
    return `${symbol}${min}`;
  }
  
  return 'Contact for pricing';
});

// Pre-save middleware to set primary image
serviceSchema.pre('save', function(next) {
  if (this.images && this.images.length > 0) {
    const hasPrimary = this.images.some(img => img.isPrimary);
    if (!hasPrimary) {
      this.images[0].isPrimary = true;
    }
  }
  next();
});

// Static method to find nearby services
serviceSchema.statics.findNearby = function(coordinates, maxDistance = 50000) {
  return this.find({
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: coordinates
        },
        $maxDistance: maxDistance // meters
      }
    },
    isActive: true,
    isPaused: false
  });
};

// Static method to search services
serviceSchema.statics.searchServices = function(query, filters = {}) {
  const searchQuery = {};
  
  // Text search
  if (query) {
    searchQuery.$text = { $search: query };
  }
  
  // Category filter
  if (filters.category) {
    searchQuery.category = filters.category;
  }
  
  // Price range filter
  if (filters.priceMin || filters.priceMax) {
    searchQuery['pricing.amount.min'] = {};
    if (filters.priceMin) {
      searchQuery['pricing.amount.min'].$gte = filters.priceMin;
    }
    if (filters.priceMax) {
      searchQuery['pricing.amount.max'].$lte = filters.priceMax;
    }
  }
  
  // Rating filter
  if (filters.minRating) {
    searchQuery['rating.average'] = { $gte: filters.minRating };
  }
  
  // Location filter
  if (filters.location && filters.radius) {
    searchQuery.location = {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: filters.location
        },
        $maxDistance: filters.radius * 1000 // convert km to meters
      }
    };
  }
  
  // Active services only
  searchQuery.isActive = true;
  searchQuery.isPaused = false;
  
  return this.find(searchQuery);
};

// Instance method to check if service is available at given time
serviceSchema.methods.isAvailableAt = function(dateTime) {
  const day = dateTime.toLocaleLowerCase().substring(0, 3); // e.g., 'mon'
  const dayMap = {
    'mon': 'monday',
    'tue': 'tuesday', 
    'wed': 'wednesday',
    'thu': 'thursday',
    'fri': 'friday',
    'sat': 'saturday',
    'sun': 'sunday'
  };
  
  const daySchedule = this.availability.schedule[dayMap[day]];
  if (!daySchedule || !daySchedule.available) {
    return false;
  }
  
  // Check if the time falls within available hours
  const requestTime = dateTime.getHours() * 100 + dateTime.getMinutes();
  
  return daySchedule.hours.some(slot => {
    const startTime = parseInt(slot.start.replace(':', ''));
    const endTime = parseInt(slot.end.replace(':', ''));
    return requestTime >= startTime && requestTime <= endTime;
  });
};

module.exports = mongoose.model('Service', serviceSchema);