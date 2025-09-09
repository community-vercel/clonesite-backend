const express = require('express');
const { body, validationResult, query } = require('express-validator');
const multer = require('multer');
const path = require('path');

const User = require('../models/User');
const Service = require('../models/Service');
const Request = require('../models/request');
const Review = require('../models/Review');
const { protect, requireVerification, requireOwnership } = require('../middleware/auth');
const logger = require('../utils/loggerutility');
const { upload: multerUpload } = require('../middleware/uploadmiddleware'); // Rename for clarity

const router = express.Router();

// @desc    Get all users (with filters and search)
// @route   GET /api/users
// @access  Public
router.get('/', [
  query('search').optional().isString(),
  query('userType').optional().isIn(['customer', 'service_provider', 'both']),
  query('category').optional().isMongoId(),
  query('location').optional().isString(),
  query('radius').optional().isInt({ min: 1, max: 100 }),
  query('verified').optional().isBoolean(),
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
      userType,
      category,
      location,
      radius = 25,
      verified,
      page = 1,
      limit = 20
    } = req.query;

    // Build query
    let query = { isActive: true };

    // Search by name or skills
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { businessName: { $regex: search, $options: 'i' } },
        { skills: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // Filter by user type
    if (userType) {
      query.userType = userType;
    }

    // Filter by category
    if (category) {
      query.categories = category;
    }

    // Filter by verification status
    if (verified !== undefined) {
      query.isVerified = verified;
    }

    // Location-based search
    if (location) {
      // Parse location (assuming format: "lat,lng")
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

    // Pagination
    const skip = (page - 1) * limit;

    // Execute query
    const users = await User.find(query)
      .select('-password -emailVerificationToken -resetPasswordToken')
      .populate('categories', 'name slug icon')
      .sort({ 'rating.average': -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findOne({ _id: req.params.id, isActive: true })
      .select('-password -emailVerificationToken -resetPasswordToken')
      .populate('categories', 'name slug icon')
      .populate({
        path: 'reviews',
        populate: {
          path: 'customer',
          select: 'firstName lastName avatar'
        },
        options: { sort: { createdAt: -1 }, limit: 10 }
      });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user's services if they're a service provider
    let services = [];
    if (user.userType === 'service_provider' || user.userType === 'both') {
      services = await Service.find({ 
        provider: user._id, 
        isActive: true 
      })
      .populate('category', 'name slug')
      .sort({ createdAt: -1 })
      .limit(6);
    }

    // Get recent work/completed requests
    const recentWork = await Request.find({
      $or: [
        { customer: user._id },
        { selectedProvider: user._id }
      ],
      status: 'completed'
    })
    .populate('category', 'name')
    .sort({ updatedAt: -1 })
    .limit(5);

    res.json({
      success: true,
      data: {
        user,
        services,
        recentWork
      }
    });

  } catch (error) {
    logger.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
router.put('/profile', protect, [
  body('firstName').optional().isLength({ min: 2, max: 50 }),
  body('lastName').optional().isLength({ min: 2, max: 50 }),
  body('phone').optional().isMobilePhone(),
  body('bio').optional().isLength({ max: 500 }),
  body('businessName').optional().isLength({ max: 100 }),
  body('experience').optional().isInt({ min: 0, max: 50 }),
  body('skills').optional().isArray(),
  body('hourlyRate.min').optional().isFloat({ min: 0 }),
  body('hourlyRate.max').optional().isFloat({ min: 0 })
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

    const updateFields = { ...req.body };
    delete updateFields.password;
    delete updateFields.email;
    delete updateFields.userType;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateFields,
      { new: true, runValidators: true }
    )
    .select('-password')
    .populate('categories', 'name slug icon');

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user }
    });

  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Upload avatar
// @route   POST /api/users/avatar
// @access  Private
router.post('/avatar', protect, multerUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { avatar: req.file.path },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Avatar updated successfully',
      data: { 
        user,
        avatar: req.file.path
      }
    });
  } catch (error) {
    logger.error('Upload avatar error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload avatar',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Update location
// @route   PUT /api/users/location
// @access  Private
router.put('/location', protect, [
  body('address.street').optional().isString(),
  body('address.city').notEmpty().withMessage('City is required'),
  body('address.state').optional().isString(),
  body('address.zipCode').optional().isString(),
  body('address.country').optional().isString(),
  body('coordinates').isArray({ min: 2, max: 2 }).withMessage('Coordinates must be [longitude, latitude]'),
  body('serviceRadius').optional().isInt({ min: 1, max: 100 })
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

    const { address, coordinates, serviceRadius } = req.body;

    const updateData = {};
    if (address) updateData.address = address;
    if (coordinates) {
      updateData.location = {
        type: 'Point',
        coordinates: coordinates
      };
    }
    if (serviceRadius) updateData.serviceRadius = serviceRadius;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Location updated successfully',
      data: { user }
    });

  } catch (error) {
    logger.error('Update location error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update location',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Add portfolio item
// @route   POST /api/users/portfolio
// @access  Private
router.post('/portfolio', protect, multerUpload.array('images', 5), [
  body('title').notEmpty().withMessage('Portfolio title is required'),
  body('description').notEmpty().withMessage('Description is required'),
  body('projectDate').optional().isISO8601(),
  body('category').optional().isString()
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

    const portfolioItem = {
      title: req.body.title,
      description: req.body.description,
      projectDate: req.body.projectDate || new Date(),
      category: req.body.category,
      client: req.body.client,
      images: req.files ? req.files.map(file => file.path) : []
    };

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $push: { portfolio: portfolioItem } },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Portfolio item added successfully',
      data: { 
        user,
        portfolioItem: user.portfolio[user.portfolio.length - 1]
      }
    });

  } catch (error) {
    logger.error('Add portfolio error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add portfolio item',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Update portfolio item
// @route   PUT /api/users/portfolio/:portfolioId
// @access  Private
router.put('/portfolio/:portfolioId', protect, [
  body('title').optional().isString(),
  body('description').optional().isString(),
  body('projectDate').optional().isISO8601(),
  body('category').optional().isString()
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

    const user = await User.findById(req.user.id);
    const portfolioItem = user.portfolio.id(req.params.portfolioId);
    
    if (!portfolioItem) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio item not found'
      });
    }

    // Update portfolio item
    Object.assign(portfolioItem, req.body);
    await user.save();

    res.json({
      success: true,
      message: 'Portfolio item updated successfully',
      data: { portfolioItem }
    });

  } catch (error) {
    logger.error('Update portfolio error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update portfolio item',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Delete portfolio item
// @route   DELETE /api/users/portfolio/:portfolioId
// @access  Private
router.delete('/portfolio/:portfolioId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const portfolioItem = user.portfolio.id(req.params.portfolioId);
    
    if (!portfolioItem) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio item not found'
      });
    }

    portfolioItem.remove();
    await user.save();

    res.json({
      success: true,
      message: 'Portfolio item deleted successfully'
    });

  } catch (error) {
    logger.error('Delete portfolio error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete portfolio item',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Add certification
// @route   POST /api/users/certifications
// @access  Private
router.post('/certifications', protect, multerUpload.single('image'), [
  body('name').notEmpty().withMessage('Certification name is required'),
  body('issuer').notEmpty().withMessage('Issuer is required'),
  body('issueDate').isISO8601().withMessage('Valid issue date is required'),
  body('expiryDate').optional().isISO8601(),
  body('credentialId').optional().isString()
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

    const certification = {
      name: req.body.name,
      issuer: req.body.issuer,
      issueDate: req.body.issueDate,
      expiryDate: req.body.expiryDate,
      credentialId: req.body.credentialId,
      imageUrl: req.file ? req.file.path : null
    };

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $push: { certifications: certification } },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Certification added successfully',
      data: { 
        user,
        certification: user.certifications[user.certifications.length - 1]
      }
    });

  } catch (error) {
    logger.error('Add certification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add certification',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Update availability
// @route   PUT /api/users/availability
// @access  Private
router.put('/availability', protect, [
  body('days').isArray().withMessage('Days must be an array'),
  body('hours.start').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Invalid start time format'),
  body('hours.end').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Invalid end time format'),
  body('timezone').optional().isString()
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

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { availability: req.body },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Availability updated successfully',
      data: { user }
    });

  } catch (error) {
    logger.error('Update availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update availability',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Update preferences
// @route   PUT /api/users/preferences
// @access  Private
router.put('/preferences', protect, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { preferences: { ...req.user.preferences, ...req.body } },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Preferences updated successfully',
      data: { user }
    });

  } catch (error) {
    logger.error('Update preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update preferences',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Get user dashboard stats
// @route   GET /api/users/dashboard
// @access  Private
router.get('/dashboard', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType;

    let stats = {};

    if (userType === 'customer' || userType === 'both') {
      // Customer stats
      const customerStats = await Request.aggregate([
        { $match: { customer: userId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalSpent: { $sum: '$payment.totalAmount' }
          }
        }
      ]);

      stats.customer = {
        totalRequests: customerStats.reduce((sum, stat) => sum + stat.count, 0),
        activeRequests: customerStats.find(s => ['published', 'receiving_quotes', 'quotes_received'].includes(s._id))?.count || 0,
        completedRequests: customerStats.find(s => s._id === 'completed')?.count || 0,
        totalSpent: customerStats.reduce((sum, stat) => sum + (stat.totalSpent || 0), 0)
      };
    }

    if (userType === 'service_provider' || userType === 'both') {
      // Service provider stats
      const providerStats = await Request.aggregate([
        { $match: { selectedProvider: userId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalEarnings: { $sum: '$payment.totalAmount' }
          }
        }
      ]);

      const serviceCount = await Service.countDocuments({ provider: userId, isActive: true });
      const quotesCount = await Request.countDocuments({ 'quotes.provider': userId });

      stats.provider = {
        totalServices: serviceCount,
        totalQuotes: quotesCount,
        activeJobs: providerStats.find(s => s._id === 'in_progress')?.count || 0,
        completedJobs: providerStats.find(s => s._id === 'completed')?.count || 0,
        totalEarnings: providerStats.reduce((sum, stat) => sum + (stat.totalEarnings || 0), 0),
        rating: req.user.rating
      };
    }

    // Recent activities
    const recentRequests = await Request.find({
      $or: [
        { customer: userId },
        { selectedProvider: userId },
        { 'quotes.provider': userId }
      ]
    })
    .populate('category', 'name icon')
    .populate('customer', 'firstName lastName avatar')
    .populate('selectedProvider', 'firstName lastName avatar')
    .sort({ updatedAt: -1 })
    .limit(10);

    res.json({
      success: true,
      data: {
        stats,
        recentRequests
      }
    });

  } catch (error) {
    logger.error('Get dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard data',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Deactivate user account
// @route   DELETE /api/users/account
// @access  Private
router.delete('/account', protect, [
  body('password').notEmpty().withMessage('Password is required for account deletion'),
  body('reason').optional().isString()
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

    const user = await User.findById(req.user.id).select('+password');

    // Verify password
    const isPasswordMatch = await user.matchPassword(req.body.password);
    if (!isPasswordMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Deactivate account instead of deleting
    user.isActive = false;
    user.deactivatedAt = new Date();
    user.deactivationReason = req.body.reason;
    await user.save();

    // Deactivate all user's services
    await Service.updateMany(
      { provider: req.user.id },
      { isActive: false, isPaused: true }
    );

    res.json({
      success: true,
      message: 'Account deactivated successfully'
    });

  } catch (error) {
    logger.error('Deactivate account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to deactivate account',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Get nearby service providers
// @route   GET /api/users/nearby
// @access  Public
router.get('/nearby', [
  query('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
  query('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
  query('radius').optional().isInt({ min: 1, max: 100 }),
  query('category').optional().isMongoId(),
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

    const { lat, lng, radius = 25, category, limit = 10 } = req.query;

    let query = {
      userType: { $in: ['service_provider', 'both'] },
      isActive: true,
      isVerified: true,
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: radius * 1000 // Convert km to meters
        }
      }
    };

    if (category) {
      query.categories = category;
    }

    const providers = await User.find(query)
      .select('-password -emailVerificationToken -resetPasswordToken')
      .populate('categories', 'name slug icon')
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: { providers }
    });

  } catch (error) {
    logger.error('Get nearby providers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get nearby providers',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;