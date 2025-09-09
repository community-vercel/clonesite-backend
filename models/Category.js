const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    unique: true,
    trim: true,
    maxlength: [100, 'Category name cannot exceed 100 characters']
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  description: {
    type: String,
    required: [true, 'Category description is required'],
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  icon: {
    type: String,
    required: [true, 'Category icon is required']
  },
  image: {
    type: String,
    default: 'default-category.jpg'
  },
  
  // Hierarchy
  parent: {
    type: mongoose.Schema.ObjectId,
    ref: 'Category',
    default: null
  },
  level: {
    type: Number,
    default: 0,
    min: 0,
    max: 3
  },
  path: {
    type: String,
    default: ''
  },
  
  // Category Settings
  isActive: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  
  // SEO
  seoTitle: String,
  seoDescription: String,
  seoKeywords: [String],
  
  // Statistics
  stats: {
    totalServices: {
      type: Number,
      default: 0
    },
    totalProviders: {
      type: Number,
      default: 0
    },
    totalRequests: {
      type: Number,
      default: 0
    },
    averagePrice: {
      type: Number,
      default: 0
    }
  },
  
  // Category-specific questions for service requests
  customFields: [{
    name: {
      type: String,
      required: true
    },
    label: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['text', 'textarea', 'select', 'multiselect', 'number', 'date', 'boolean', 'file'],
      required: true
    },
    options: [String], // For select/multiselect
    required: {
      type: Boolean,
      default: false
    },
    placeholder: String,
    validation: {
      min: Number,
      max: Number,
      pattern: String,
      message: String
    },
    order: {
      type: Number,
      default: 0
    }
  }],
  
  // Pricing guidelines
  pricingInfo: {
    currency: {
      type: String,
      default: 'USD'
    },
    priceRange: {
      min: Number,
      max: Number
    },
    pricingType: {
      type: String,
      enum: ['hourly', 'fixed', 'per_project', 'per_item', 'per_sqft', 'negotiable'],
      default: 'negotiable'
    },
    priceFactors: [String] // What affects pricing in this category
  },
  
  // Popular services in this category
  popularServices: [String],
  
  // Required skills/qualifications
  requirements: {
    license: {
      type: Boolean,
      default: false
    },
    insurance: {
      type: Boolean,
      default: false
    },
    certification: {
      type: Boolean,
      default: false
    },
    experience: {
      min: Number,
      max: Number
    },
    backgroundCheck: {
      type: Boolean,
      default: false
    }
  },
  
  // Category metadata
  metadata: {
    color: {
      type: String,
      default: '#007bff'
    },
    tags: [String],
    relatedCategories: [{
      type: mongoose.Schema.ObjectId,
      ref: 'Category'
    }]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
categorySchema.index({ slug: 1 });
categorySchema.index({ parent: 1 });
categorySchema.index({ isActive: 1, isFeatured: 1 });
categorySchema.index({ level: 1, sortOrder: 1 });
categorySchema.index({ name: 'text', description: 'text' });

// Virtual for children categories
categorySchema.virtual('children', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parent',
  justOne: false
});

// Virtual for service providers count
categorySchema.virtual('providersCount', {
  ref: 'User',
  localField: '_id',
  foreignField: 'categories',
  count: true
});

// Virtual for services count
categorySchema.virtual('servicesCount', {
  ref: 'Service',
  localField: '_id',
  foreignField: 'category',
  count: true
});

// Pre-save middleware to generate slug
categorySchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  next();
});

// Pre-save middleware to set path
categorySchema.pre('save', async function(next) {
  if (this.parent) {
    const parentCategory = await this.constructor.findById(this.parent);
    if (parentCategory) {
      this.level = parentCategory.level + 1;
      this.path = parentCategory.path ? `${parentCategory.path}/${parentCategory.slug}` : parentCategory.slug;
    }
  } else {
    this.level = 0;
    this.path = '';
  }
  next();
});

// Static method to get category tree
categorySchema.statics.getCategoryTree = async function() {
  const categories = await this.find({ isActive: true })
    .sort({ level: 1, sortOrder: 1 })
    .lean();
    
  const categoryMap = {};
  const rootCategories = [];
  
  // Create a map of categories
  categories.forEach(category => {
    category.children = [];
    categoryMap[category._id] = category;
  });
  
  // Build the tree
  categories.forEach(category => {
    if (category.parent) {
      if (categoryMap[category.parent]) {
        categoryMap[category.parent].children.push(category);
      }
    } else {
      rootCategories.push(category);
    }
  });
  
  return rootCategories;
};

// Static method to get breadcrumbs
categorySchema.statics.getBreadcrumbs = async function(categoryId) {
  const category = await this.findById(categoryId).populate('parent');
  const breadcrumbs = [];
  
  let current = category;
  while (current) {
    breadcrumbs.unshift({
      id: current._id,
      name: current.name,
      slug: current.slug
    });
    current = current.parent;
  }
  
  return breadcrumbs;
};

// Instance method to get full category path
categorySchema.methods.getFullPath = function() {
  return this.path ? `${this.path}/${this.slug}` : this.slug;
};

module.exports = mongoose.model('Category', categorySchema);