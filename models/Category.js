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
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  icon: String,
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
  isActive: { type: Boolean, default: true },
  isFeatured: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },

  // SEO
  seoTitle: String,
  seoDescription: String,
  seoKeywords: [String],

  // Statistics
  stats: {
    totalServices: { type: Number, default: 0 },
    totalProviders: { type: Number, default: 0 },
    totalRequests: { type: Number, default: 0 },
    averagePrice: { type: Number, default: 0 }
  },

  // 🟢 Category-specific dynamic questions (the Bark-style questionnaire)
  customFields: [{
    key: { type: String, required: true }, // e.g. "bedrooms"
    label: { type: String, required: true }, // e.g. "How many bedrooms?"
    type: {
      type: String,
      enum: [
        'text', 'textarea', 'select', 'multiselect',
        'number', 'date', 'boolean', 'file', 'radio'
      ],
      required: true
    },
    options: [String], // For select/multiselect/radio
    required: { type: Boolean, default: false },
    placeholder: String,

    // Validation
    validation: {
      min: Number,
      max: Number,
      pattern: String,
      message: String
    },

    // Conditional logic support
    conditional: {
      dependsOn: String, // key of another field
      value: mongoose.Mixed // show only if value matches
    },

    order: { type: Number, default: 0 }
  }],

  // Pricing guidelines
  pricingInfo: {
    currency: { type: String, default: 'USD' },
    priceRange: { min: Number, max: Number },
    pricingType: {
      type: String,
      enum: ['hourly', 'fixed', 'per_project', 'per_item', 'per_sqft', 'negotiable'],
      default: 'negotiable'
    },
    priceFactors: [String]
  },

  // Popular services in this category
  popularServices: [String],

  // Requirements
  requirements: {
    license: { type: Boolean, default: false },
    insurance: { type: Boolean, default: false },
    certification: { type: Boolean, default: false },
    experience: { min: Number, max: Number },
    backgroundCheck: { type: Boolean, default: false }
  },

  // Metadata
  metadata: {
    color: { type: String, default: '#007bff' },
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

// Virtuals
categorySchema.virtual('children', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parent'
});

// Pre-save slug
categorySchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  next();
});

// Pre-save path
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

// Tree builder
categorySchema.statics.getCategoryTree = async function() {
  const categories = await this.find({ isActive: true })
    .sort({ level: 1, sortOrder: 1 })
    .lean();

  const categoryMap = {};
  const rootCategories = [];

  categories.forEach(cat => {
    cat.children = [];
    categoryMap[cat._id] = cat;
  });

  categories.forEach(cat => {
    if (cat.parent) {
      if (categoryMap[cat.parent]) {
        categoryMap[cat.parent].children.push(cat);
      }
    } else {
      rootCategories.push(cat);
    }
  });

  return rootCategories;
};

module.exports = mongoose.model('Category', categorySchema);
