const express = require('express');
const { body, query, validationResult } = require('express-validator');

const Service = require('../models/Service');
const User = require('../models/User');
const Category = require('../models/Category');
const Review = require('../models/Review');
const { 
  protect, 
  optionalAuth,
  requireServiceProvider, 
  requireOwnership 
} = require('../middleware/auth');
const logger = require('../utils/loggerutility');
const { upload: multerUpload } = require('../middleware/uploadmiddleware'); // Rename for clarity

const router = express.Router();
router.get('/getuserservice', protect, async (req, res) => {
  try {
    const services = await Service.find({ provider: req.user.id, isActive: true, isPaused: false })
      .select('title shortDescription pricing primaryImage rating')
      .lean();

    res.json({
      success: true,
      data: services.map(service => ({
        ...service,
        priceDisplay: service.priceDisplay,
      })),
    });
  } catch (error) {
    logger.error('Get services error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch services',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

// @desc    Update service status (e.g., pause/unpause)
// @route   PUT /api/services/:id/status
// @access  Private
router.put(
  '/:id/status',
  protect,
  [
    body('isPaused').isBoolean().withMessage('isPaused must be a boolean'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { isPaused } = req.body;
      const service = await Service.findOneAndUpdate(
        { _id: req.params.id, provider: req.user.id },
        { isPaused },
        { new: true, runValidators: true }
      ).select('title isPaused');

      if (!service) {
        return res.status(404).json({
          success: false,
          message: 'Service not found or unauthorized',
        });
      }

      res.json({
        success: true,
        message: 'Service status updated successfully',
        data: service,
      });
    } catch (error) {
      logger.error('Update service status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update service status',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      });
    }
  }
);
// @desc    Get all services (with filters and search)
// @route   GET /api/services
// @access  Public
router.get('/', optionalAuth, [
  query('search').optional().isString(),
  query('category').optional().isMongoId(),
  query('location').optional().isString(),
  query('radius').optional().isInt({ min: 1, max: 100 }),
  query('minPrice').optional().isFloat({ min: 0 }),
  query('maxPrice').optional().isFloat({ min: 0 }),
  query('minRating').optional().isFloat({ min: 0, max: 5 }),
  query('priceType').optional().isIn(['hourly', 'fixed', 'per_project', 'per_item', 'per_sqft', 'negotiable']),
  query('verified').optional().isBoolean(),
  query('featured').optional().isBoolean(),
  query('sortBy').optional().isIn(['rating', 'price', 'distance', 'newest', 'popular']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      search,
      category,
      location,
      radius = 25,
      minPrice,
      maxPrice,
      minRating,
      priceType,
      verified,
      featured,
      sortBy = 'rating',
      page = 1,
      limit = 20
    } = req.query;

    // Build query
    let query = { isActive: true, isPaused: false };
    let sort = {};

    // Text search
    if (search) {
      query.$text = { $search: search };
    }

    // Category filter
    if (category) {
      query.category = category;
    }

    // Price filters
    if (minPrice || maxPrice) {
      query['pricing.amount.min'] = {};
      if (minPrice) query['pricing.amount.min'].$gte = parseFloat(minPrice);
      if (maxPrice) query['pricing.amount.max'] = { $lte: parseFloat(maxPrice) };
    }

    // Price type filter
    if (priceType) {
      query['pricing.type'] = priceType;
    }

    // Rating filter
    if (minRating) {
      query['rating.average'] = { $gte: parseFloat(minRating) };
    }

    // Featured filter
    if (featured !== undefined) {
      query.isFeatured = featured === 'true';
    }

    // Location-based search
    if (location) {
      const [lat, lng] = location.split(',').map(Number);
      if (lat && lng) {
        query.location = {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [lng, lat]
            },
            $maxDistance: radius * 1000 // Convert km to meters
          }
        };
      }
    }

    // Sorting
    switch (sortBy) {
      case 'rating':
        sort = { 'rating.average': -1, 'rating.count': -1 };
        break;
      case 'price':
        sort = { 'pricing.amount.min': 1 };
        break;
      case 'newest':
        sort = { createdAt: -1 };
        break;
      case 'popular':
        sort = { 'stats.bookings': -1, 'stats.views': -1 };
        break;
      case 'distance':
        // Distance sorting handled by $near
        break;
      default:
        sort = { 'rating.average': -1, createdAt: -1 };
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Execute query
    let services = await Service.find(query)
      .populate('provider', 'firstName lastName avatar businessName rating isVerified')
      .populate('category', 'name slug icon')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // Filter by verified providers if requested
    if (verified === 'true') {
      services = services.filter(service => service.provider.isVerified);
    }

    // Get total count for pagination
    const total = await Service.countDocuments(query);

    res.json({
      success: true,
      data: {
        services,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Get provider services error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get provider services',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Get my services
// @route   GET /api/services/my-services
// @access  Private (Service Providers only)
router.get('/my-services', protect, requireServiceProvider, [
  query('status').optional().isIn(['active', 'paused', 'all']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 20 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { status = 'all', page = 1, limit = 10 } = req.query;
    
    let query = { 
      provider: req.user.id,
      isActive: true 
    };

    if (status === 'active') {
      query.isPaused = false;
    } else if (status === 'paused') {
      query.isPaused = true;
    }

    const skip = (page - 1) * limit;

    const services = await Service.find(query)
      .populate('category', 'name slug icon')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Service.countDocuments(query);

    // Get service statistics
    const stats = await Service.aggregate([
      { $match: { provider: req.user._id, isActive: true } },
      {
        $group: {
          _id: null,
          totalServices: { $sum: 1 },
          activeServices: { $sum: { $cond: [{ $eq: ['$isPaused', false] }, 1, 0] } },
          pausedServices: { $sum: { $cond: [{ $eq: ['$isPaused', true] }, 1, 0] } },
          totalViews: { $sum: '$stats.views' },
          totalInquiries: { $sum: '$stats.inquiries' },
          totalBookings: { $sum: '$stats.bookings' },
          averageRating: { $avg: '$rating.average' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        services,
        stats: stats[0] || {
          totalServices: 0,
          activeServices: 0,
          pausedServices: 0,
          totalViews: 0,
          totalInquiries: 0,
          totalBookings: 0,
          averageRating: 0
        },
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Get my services error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get services',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Get featured services
// @route   GET /api/services/featured
// @access  Public
router.get('/featured', [
  query('category').optional().isMongoId(),
  query('location').optional().isString(),
  query('limit').optional().isInt({ min: 1, max: 20 })
], async (req, res) => {
  try {
    const { category, location, limit = 8 } = req.query;

    let query = {
      isActive: true,
      isPaused: false,
      isFeatured: true
    };

    if (category) {
      query.category = category;
    }

    let services = Service.find(query)
      .populate('provider', 'firstName lastName avatar businessName rating isVerified')
      .populate('category', 'name slug icon')
      .sort({ 'rating.average': -1, 'stats.bookings': -1 })
      .limit(parseInt(limit));

    // Location-based sorting if location provided
    if (location) {
      const [lat, lng] = location.split(',').map(Number);
      if (lat && lng) {
        query.location = {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [lng, lat]
            },
            $maxDistance: 50000 // 50km
          }
        };
      }
    }

    services = await services;

    res.json({
      success: true,
      data: { services }
    });

  } catch (error) {
    logger.error('Get featured services error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get featured services',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Search services
// @route   GET /api/services/search
// @access  Public
router.get('/search', [
  query('q').notEmpty().withMessage('Search query is required'),
  query('category').optional().isMongoId(),
  query('location').optional().isString(),
  query('radius').optional().isInt({ min: 1, max: 100 }),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { q, category, location, radius = 25, page = 1, limit = 20 } = req.query;

    // Use the Service model's search method
    let searchQuery = Service.searchServices(q, {
      category,
      location: location ? location.split(',').map(Number) : null,
      radius
    });

    const skip = (page - 1) * limit;

    const services = await searchQuery
      .populate('provider', 'firstName lastName avatar businessName rating isVerified')
      .populate('category', 'name slug icon')
      .sort({ score: { $meta: 'textScore' }, 'rating.average': -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const totalQuery = Service.searchServices(q, {
      category,
      location: location ? location.split(',').map(Number) : null,
      radius
    });
    const total = await totalQuery.countDocuments();

    res.json({
      success: true,
      data: {
        services,
        searchQuery: q,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Search services error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search services',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Add service FAQ
// @route   POST /api/services/:id/faqs
// @access  Private (Service owner only)
router.post('/:id/faqs', protect, requireOwnership(Service, 'id', 'provider'), [
  body('question').notEmpty().withMessage('Question is required'),
  body('answer').notEmpty().withMessage('Answer is required'),
  body('order').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const service = await Service.findById(req.params.id);
    
    const faq = {
      question: req.body.question,
      answer: req.body.answer,
      order: req.body.order || service.faqs.length
    };

    service.faqs.push(faq);
    await service.save();

    res.json({
      success: true,
      message: 'FAQ added successfully',
      data: { faq: service.faqs[service.faqs.length - 1] }
    });

  } catch (error) {
    logger.error('Add FAQ error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add FAQ',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Update service FAQ
// @route   PUT /api/services/:id/faqs/:faqId
// @access  Private (Service owner only)
router.put('/:id/faqs/:faqId', protect, requireOwnership(Service, 'id', 'provider'), [
  body('question').optional().isString(),
  body('answer').optional().isString(),
  body('order').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    const faq = service.faqs.id(req.params.faqId);
    
    if (!faq) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    Object.assign(faq, req.body);
    await service.save();

    res.json({
      success: true,
      message: 'FAQ updated successfully',
      data: { faq }
    });

  } catch (error) {
    logger.error('Update FAQ error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update FAQ',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Delete service FAQ
// @route   DELETE /api/services/:id/faqs/:faqId
// @access  Private (Service owner only)
router.delete('/:id/faqs/:faqId', protect, requireOwnership(Service, 'id', 'provider'), async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    const faq = service.faqs.id(req.params.faqId);
    
    if (!faq) {
      return res.status(404).json({
        success: false,
        message: 'FAQ not found'
      });
    }

    faq.remove();
    await service.save();

    res.json({
      success: true,
      message: 'FAQ deleted successfully'
    });

  } catch (error) {
    logger.error('Delete FAQ error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete FAQ',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Remove service image
// @route   DELETE /api/services/:id/images/:imageId
// @access  Private (Service owner only)
router.delete('/:id/images/:imageId', protect, requireOwnership(Service, 'id', 'provider'), async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    
    const imageIndex = service.images.findIndex(img => img._id.toString() === req.params.imageId);
    
    if (imageIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Image not found'
      });
    }

    // Don't allow removing the only image
    if (service.images.length === 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove the only image. Please add another image first.'
      });
    }

    service.images.splice(imageIndex, 1);
    
    // If removed image was primary, make first image primary
    if (!service.images.some(img => img.isPrimary) && service.images.length > 0) {
      service.images[0].isPrimary = true;
    }

    await service.save();

    res.json({
      success: true,
      message: 'Image removed successfully'
    });

  } catch (error) {
    logger.error('Remove image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove image',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Set primary image
// @route   PATCH /api/services/:id/images/:imageId/primary
// @access  Private (Service owner only)
router.patch('/:id/images/:imageId/primary', protect, requireOwnership(Service, 'id', 'provider'), async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    
    // Reset all images to non-primary
    service.images.forEach(img => img.isPrimary = false);
    
    // Set selected image as primary
    const targetImage = service.images.find(img => img._id.toString() === req.params.imageId);
    
    if (!targetImage) {
      return res.status(404).json({
        success: false,
        message: 'Image not found'
      });
    }

    targetImage.isPrimary = true;
    await service.save();

    res.json({
      success: true,
      message: 'Primary image updated successfully'
    });

  } catch (error) {
    logger.error('Set primary image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set primary image',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});



// @desc    Get single service
// @route   GET /api/services/:id
// @access  Public
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const service = await Service.findOne({ 
      _id: req.params.id, 
      isActive: true 
    })
    .populate('provider', 'firstName lastName avatar businessName rating totalJobs isVerified location address socialLinks')
    .populate('category', 'name slug icon parent')
    .populate('subCategory', 'name slug icon')
    .populate({
      path: 'reviews',
      populate: {
        path: 'customer',
        select: 'firstName lastName avatar'
      },
      options: { sort: { createdAt: -1 }, limit: 10 }
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Increment view count (only if not the owner)
    if (!req.user || req.user.id !== service.provider._id.toString()) {
      await Service.findByIdAndUpdate(service._id, {
        $inc: { 'stats.views': 1 }
      });
    }

    // Get related services
    const relatedServices = await Service.find({
      _id: { $ne: service._id },
      category: service.category._id,
      isActive: true,
      isPaused: false
    })
    .populate('provider', 'firstName lastName avatar rating isVerified')
    .populate('category', 'name slug icon')
    .sort({ 'rating.average': -1 })
    .limit(4);

    res.json({
      success: true,
      data: {
        service,
        relatedServices
      }
    });

  } catch (error) {
    logger.error('Get service error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get service',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Create new service
// @route   POST /api/services
// @access  Private (Service Providers only)
router.post('/', protect, requireServiceProvider, multerUpload.array('images', 10), [
  body('title').notEmpty().withMessage('Service title is required').isLength({ max: 100 }),
  body('description').notEmpty().withMessage('Description is required').isLength({ max: 2000 }),
  body('category').isMongoId().withMessage('Valid category ID is required'),
  body('pricing.type').isIn(['hourly', 'fixed', 'per_project', 'per_item', 'per_sqft', 'negotiable']),
  body('pricing.amount.min').optional().isFloat({ min: 0 }),
  body('pricing.amount.max').optional().isFloat({ min: 0 }),
  body('location.coordinates').isArray({ min: 2, max: 2 }).withMessage('Valid coordinates required'),
  body('serviceAreas').optional().isArray(),
  body('features').optional().isArray(),
  body('whatsIncluded').optional().isArray(),
  body('requirements').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    // Validate category exists
    const category = await Category.findById(req.body.category);
    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category'
      });
    }

    // Process multerUploaded images
    const images = req.files ? req.files.map((file, index) => ({
      url: file.path,
      caption: req.body[`imageCaption${index}`] || '',
      isPrimary: index === 0
    })) : [];

    const serviceData = {
      ...req.body,
      provider: req.user.id,
      images,
      location: {
        type: 'Point',
        coordinates: req.body.location.coordinates
      }
    };

    const service = await Service.create(serviceData);

    // Populate the response
    await service.populate('provider', 'firstName lastName businessName avatar');
    await service.populate('category', 'name slug icon');

    res.status(201).json({
      success: true,
      message: 'Service created successfully',
      data: { service }
    });

  } catch (error) {
    logger.error('Create service error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create service',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Update service
// @route   PUT /api/services/:id
// @access  Private (Service owner only)
router.put('/:id', protect, requireOwnership(Service, 'id', 'provider'), multerUpload.array('newImages', 10), [
  body('title').optional().isLength({ max: 100 }),
  body('description').optional().isLength({ max: 2000 }),
  body('pricing.amount.min').optional().isFloat({ min: 0 }),
  body('pricing.amount.max').optional().isFloat({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const updateData = { ...req.body };
    
    // Handle new images
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map(file => ({
        url: file.path,
        caption: '',
        isPrimary: false
      }));
      
      // Combine with existing images
      updateData.images = [...(req.resource.images || []), ...newImages];
    }

    const service = await Service.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
    .populate('provider', 'firstName lastName businessName avatar')
    .populate('category', 'name slug icon');

    res.json({
      success: true,
      message: 'Service updated successfully',
      data: { service }
    });

  } catch (error) {
    logger.error('Update service error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update service',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Delete service
// @route   DELETE /api/services/:id
// @access  Private (Service owner only)
router.delete('/:id', protect, requireOwnership(Service, 'id', 'provider'), async (req, res) => {
  try {
    await Service.findByIdAndUpdate(req.params.id, { isActive: false });

    res.json({
      success: true,
      message: 'Service deleted successfully'
    });

  } catch (error) {
    logger.error('Delete service error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete service',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Toggle service pause status
// @route   PATCH /api/services/:id/toggle-pause
// @access  Private (Service owner only)
router.patch('/:id/toggle-pause', protect, requireOwnership(Service, 'id', 'provider'), async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    service.isPaused = !service.isPaused;
    await service.save();

    res.json({
      success: true,
      message: `Service ${service.isPaused ? 'paused' : 'activated'} successfully`,
      data: { service }
    });

  } catch (error) {
    logger.error('Toggle pause error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle service status',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Get services by provider
// @route   GET /api/services/provider/:providerId
// @access  Public
router.get('/provider/:providerId', [
  query('status').optional().isIn(['active', 'paused', 'all']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 20 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { status = 'active', page = 1, limit = 10 } = req.query;
    
    let query = { 
      provider: req.params.providerId,
      isActive: true 
    };

    if (status === 'active') {
      query.isPaused = false;
    } else if (status === 'paused') {
      query.isPaused = true;
    }

    const skip = (page - 1) * limit;

    const services = await Service.find(query)
      .populate('category', 'name slug icon')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Service.countDocuments(query);

    res.json({
      success: true,
      data: {
        services,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {

    logger.error('Delete service error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete service',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;