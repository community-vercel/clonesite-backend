const express = require('express');
const { body, validationResult, query } = require('express-validator');
const multer = require('multer');
const path = require('path');
const mongoose = require('mongoose');

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


// @desc    Get user dashboard stats
// @route   GET /api/users/dashboard
// @access  Private
router.get('/dashboard', protect, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id); // Ensure userId is an ObjectId
    const userType = req.user.userType;

    let stats = {};

    if (userType === 'customer' || userType === 'both') {
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
// @desc    Get single user
// @route   GET /api/users/:id
// @access  Public

router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select(
        'firstName lastName email phone businessName website companySize experience bio location avatar'
      )
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Format response to match settings page needs
    const profileData = {
      companyName: user.businessName || '',
      companyLogo: user.avatar || 'default-avatar.jpg',
      name: `${user.firstName} ${user.lastName}`,
      profilePicture: user.avatar || 'default-avatar.jpg',
      companyEmail: user.email || '',
      companyPhone: user.phone || '',
      website: user.website || '',
      companyLocation: {
        address: user.location?.address?.street || '',
        city: user.location?.address?.city || '',
        postcode: user.location?.address?.postcode || '',
        country: user.location?.address?.country || 'PK',
        coordinates: user.location?.coordinates || [73.0479, 33.6844], // Default to Islamabad
        hideLocation: user.preferences?.privacy?.showLastSeen === false,
      },
      companySize: user.companySize || 'self-employed',
      yearsInBusiness: user.experience || 0,
      description: user.bio || '',
    };

    res.json({
      success: true,
      data: profileData,
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile data',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});


// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
// router.put('/profile', protect, [
//   body('firstName').optional().isLength({ min: 2, max: 50 }),
//   body('lastName').optional().isLength({ min: 2, max: 50 }),
//   body('phone').optional().isMobilePhone(),
//   body('bio').optional().isLength({ max: 500 }),
//   body('businessName').optional().isLength({ max: 100 }),
//   body('experience').optional().isInt({ min: 0, max: 50 }),
//   body('skills').optional().isArray(),
//   body('hourlyRate.min').optional().isFloat({ min: 0 }),
//   body('hourlyRate.max').optional().isFloat({ min: 0 })
// ], async (req, res) => {
//   try {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).json({
//         success: false,
//         message: 'Validation failed',
//         errors: errors.array()
//       });
//     }

//     const updateFields = { ...req.body };
//     delete updateFields.password;
//     delete updateFields.email;
//     delete updateFields.userType;

//     const user = await User.findByIdAndUpdate(
//       req.user.id,
//       updateFields,
//       { new: true, runValidators: true }
//     )
//     .select('-password')
//     .populate('categories', 'name slug icon');

//     res.json({
//       success: true,
//       message: 'Profile updated successfully',
//       data: { user }
//     });

//   } catch (error) {
//     logger.error('Update profile error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to update profile',
//       error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
//     });
//   }
// });


// @desc    Update user profile for settings page
// @route   PUT /api/users/profile
// @access  Private
router.put(
  '/profile',
  protect,
  [
    body('companyName').optional().isLength({ max: 100 }).withMessage('Company name cannot exceed 100 characters'),
    body('name').optional().isLength({ min: 2, max: 100 }).withMessage('Name must be between 2 and 100 characters'),
    body('companyEmail').optional().isEmail().withMessage('Invalid email address'),
    body('companyPhone').optional().isMobilePhone().withMessage('Invalid phone number'),
    body('website').optional().isURL().withMessage('Invalid URL'),
    body('companyLocation.address').optional().isString(),
    body('companyLocation.city').optional().isString(),
    body('companyLocation.postcode').optional().matches(/^[A-Z0-9 ]{5,10}$/).withMessage('Invalid postcode'),
    body('companyLocation.country').optional().isString(),
    body('companyLocation.coordinates').optional().isArray({ min: 2, max: 2 }).withMessage('Coordinates must be [longitude, latitude]'),
    body('companySize').optional().isIn(['self-employed', '2-10', '11-50', '51-200', '200+']).withMessage('Invalid company size'),
    body('yearsInBusiness').optional().isInt({ min: 0, max: 50 }).withMessage('Invalid years in business'),
    body('description').optional().isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters'),
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

      const {
        companyName,
        name,
        companyEmail,
        companyPhone,
        website,
        companyLocation,
        companySize,
        yearsInBusiness,
        description,
      } = req.body;

      // Split name into firstName and lastName
      let firstName = '';
      let lastName = '';
      if (name) {
        const nameParts = name.trim().split(' ');
        firstName = nameParts[0];
        lastName = nameParts.slice(1).join(' ') || '';
      }

      // Build update object
      const updateFields = {};
      if (companyName) updateFields.businessName = companyName;
      if (companyEmail) updateFields.email = companyEmail;
      if (companyPhone) updateFields.phone = companyPhone;
      if (website) updateFields.website = website;
      if (companySize) updateFields.companySize = companySize;
      if (yearsInBusiness !== undefined) updateFields.experience = yearsInBusiness;
      if (description) updateFields.bio = description;
      if (firstName) updateFields.firstName = firstName;
      if (lastName) updateFields.lastName = lastName;

      // Update location if provided
      if (companyLocation) {
        updateFields.location = {
          type: 'Point',
          coordinates: companyLocation.coordinates || [0, 0],
          address: {
            street: companyLocation.address || '',
            city: companyLocation.city || '',
            postcode: companyLocation.postcode || '',
            country: companyLocation.country || 'PK',
          },
        };
        updateFields['preferences.privacy.showLastSeen'] = !companyLocation.hideLocation;
      }

      const user = await User.findByIdAndUpdate(
        req.user.id,
        { $set: updateFields },
        { new: true, runValidators: true }
      ).select('firstName lastName email phone businessName website companySize experience bio location avatar');

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          companyName: user.businessName || '',
          companyLogo: user.avatar || 'default-avatar.jpg',
          name: `${user.firstName} ${user.lastName}`,
          profilePicture: user.avatar || 'default-avatar.jpg',
          companyEmail: user.email || '',
          companyPhone: user.phone || '',
          website: user.website || '',
          companyLocation: {
            address: user.location?.address?.street || '',
            city: user.location?.address?.city || '',
            postcode: user.location?.address?.postcode || '',
            country: user.location?.address?.country || 'PK',
            coordinates: user.location?.coordinates || [0, 0],
            hideLocation: user.preferences?.privacy?.showLastSeen === false,
          },
          companySize: user.companySize || 'self-employed',
          yearsInBusiness: user.experience || 0,
          description: user.bio || '',
        },
      });
    } catch (error) {
      logger.error('Update profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update profile',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      });
    }
  }
);

// @desc    Upload company logo or profile picture
// @route   POST /api/users/company-logo
// @access  Private
router.post('/company-logo', protect, multerUpload.single('companyLogo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { avatar: req.file.path },
      { new: true }
    ).select('avatar');

    res.json({
      success: true,
      message: 'Company logo updated successfully',
      data: {
        companyLogo: user.avatar,
      },
    });
  } catch (error) {
    logger.error('Upload company logo error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload company logo',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

// @desc    Upload profile picture
// @route   POST /api/users/profile-picture
// @access  Private
router.post('/profile-picture', protect, multerUpload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { avatar: req.file.path },
      { new: true }
    ).select('avatar');

    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      data: {
        profilePicture: user.avatar,
      },
    });
  } catch (error) {
    logger.error('Upload profile picture error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload profile picture',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
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
// @desc    Get user settings
// @route   GET /api/users/settings
// @access  Private
router.get('/settings', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('preferences notifications emailNotifications paymentMethod')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const settings = {
      notifications: user.notifications || false,
      emailNotifications: user.emailNotifications || false,
      paymentMethod: user.paymentMethod || '',
    };

    res.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    logger.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get settings',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

// @desc    Update user settings
// @route   PUT /api/users/settings
// @access  Private
router.put('/settings', protect, [
  body('notifications').optional().isBoolean(),
  body('emailNotifications').optional().isBoolean(),
  body('paymentMethod').optional().isString(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { 
        notifications: req.body.notifications,
        emailNotifications: req.body.emailNotifications,
        paymentMethod: req.body.paymentMethod,
      },
      { new: true, runValidators: true }
    ).select('notifications emailNotifications paymentMethod');

    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: user,
    });
  } catch (error) {
    logger.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update settings',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});
router.get('/credits', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('credits stats preferences')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Get credit transactions for history
    const CreditTransaction = require('../models/CreditTransaction'); // You'll need to create this model
    const transactions = await CreditTransaction.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const creditsData = {
      currentBalance: user.credits || 0,
      totalPurchased: user.stats?.totalCreditsPurchased || 0,
      totalSpent: user.stats?.creditsSpent || 0,
      autoTopUp: user.preferences?.autoTopUp || {
        enabled: false,
        threshold: 10,
        packageType: 'starter'
      },
      transactions,
      packages: [
        {
          type: 'starter',
          credits: 280,
          price: 392.00,
          originalPrice: 490.00,
          currency: 'GBP',
          perCreditCost: 1.40,
          description: 'Enough for about 10 leads',
          guarantee: true,
          discount: 20
        },
        {
          type: 'professional',
          credits: 500,
          price: 650.00,
          originalPrice: 812.50,
          currency: 'GBP',
          perCreditCost: 1.30,
          description: 'Enough for about 18 leads',
          guarantee: true,
          discount: 20
        },
        {
          type: 'business',
          credits: 1000,
          price: 1200.00,
          originalPrice: 1500.00,
          currency: 'GBP',
          perCreditCost: 1.20,
          description: 'Enough for about 35 leads',
          guarantee: true,
          discount: 20
        }
      ]
    };

    res.json({
      success: true,
      data: creditsData,
    });
  } catch (error) {
    logger.error('Get credits error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get credits information',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

// @desc    Buy credits (initiate Stripe checkout)
// @route   POST /api/users/buy-credits
// @access  Private
router.post('/buy-credits', protect, [
  body('packageType').isIn(['starter', 'professional', 'business']).withMessage('Invalid package type'),
  body('couponCode').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { packageType, couponCode } = req.body;
    
    // Define packages
    const packages = {
      starter: { credits: 280, price: 39200, originalPrice: 49000 }, // Prices in pence
      professional: { credits: 500, price: 65000, originalPrice: 81250 },
      business: { credits: 1000, price: 120000, originalPrice: 150000 }
    };

    const selectedPackage = packages[packageType];
    if (!selectedPackage) {
      return res.status(400).json({
        success: false,
        message: 'Invalid package type'
      });
    }

    // Create Stripe checkout session
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    
    const session = await stripe.checkout.sessions.create({
      customer: req.user.stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: `${selectedPackage.credits} Bark Credits`,
              description: `${packageType.charAt(0).toUpperCase() + packageType.slice(1)} Package`,
            },
            unit_amount: selectedPackage.price,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL}/settings/credits/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/settings/credits`,
      metadata: {
        userId: req.user.id,
        packageType,
        credits: selectedPackage.credits.toString()
      },
      discounts: couponCode ? [{ coupon: couponCode }] : [],
    });

    res.json({
      success: true,
      data: {
        checkoutUrl: session.url,
        sessionId: session.id
      }
    });

  } catch (error) {
    logger.error('Buy credits error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create checkout session',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

// @desc    Get lead settings
// @route   GET /api/users/lead-settings
// @access  Private
router.get('/lead-settings', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('categories', 'name slug')
      .select('categories serviceAreas isNationwide preferences')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Get user's services
    const Service = require('../models/Service');
    const services = await Service.find({ 
      provider: req.user.id, 
      isActive: true 
    })
    .populate('category', 'name slug')
    .select('title category isActive')
    .lean();

    const leadSettingsData = {
      services: services.map(service => ({
        _id: service._id,
        name: service.title,
        category: service.category,
        leads: 'All leads', // This could be customizable
        locations: user.isNationwide ? 'Nationwide' : `${user.serviceAreas?.length || 1} location${(user.serviceAreas?.length || 1) > 1 ? 's' : ''}`
      })),
      locations: user.isNationwide ? 
        [{ type: 'nationwide', name: 'Nationwide', services: services.length }] :
        user.serviceAreas || [],
      onlineRemoteEnabled: user.preferences?.acceptOnlineWork || false,
      categories: user.categories || []
    };

    res.json({
      success: true,
      data: leadSettingsData,
    });
  } catch (error) {
    logger.error('Get lead settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get lead settings',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

// @desc    Update lead settings
// @route   PUT /api/users/lead-settings
// @access  Private
router.put('/lead-settings', protect, [
  body('onlineRemoteEnabled').optional().isBoolean(),
  body('serviceAreas').optional().isArray(),
  body('isNationwide').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { onlineRemoteEnabled, serviceAreas, isNationwide } = req.body;

    const updateFields = {};
    
    if (onlineRemoteEnabled !== undefined) {
      updateFields['preferences.acceptOnlineWork'] = onlineRemoteEnabled;
    }
    
    if (serviceAreas !== undefined) {
      updateFields.serviceAreas = serviceAreas;
    }
    
    if (isNationwide !== undefined) {
      updateFields.isNationwide = isNationwide;
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select('serviceAreas isNationwide preferences');

    res.json({
      success: true,
      message: 'Lead settings updated successfully',
      data: user,
    });
  } catch (error) {
    logger.error('Update lead settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update lead settings',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

// @desc    Get account details
// @route   GET /api/users/account-details
// @access  Private
router.get('/account-details', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('email phone preferences')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const accountData = {
      email: user.email,
      phone: user.phone,
      smsPhone: user.preferences?.notifications?.smsPhone || '',
      emailVerified: user.emailVerified || false,
      phoneVerified: user.phoneVerified || false,
      twoFactorEnabled: user.preferences?.security?.twoFactorEnabled || false
    };

    res.json({
      success: true,
      data: accountData,
    });
  } catch (error) {
    logger.error('Get account details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get account details',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

// @desc    Update account details
// @route   PUT /api/users/account-details
// @access  Private
router.put('/account-details', protect, [
  body('email').optional().isEmail().withMessage('Invalid email address'),
  body('phone').optional().isMobilePhone().withMessage('Invalid phone number'),
  body('smsPhone').optional().isMobilePhone().withMessage('Invalid SMS phone number')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { email, phone, smsPhone } = req.body;

    const updateFields = {};
    
    if (email) {
      // Check if email is already taken by another user
      const existingUser = await User.findOne({ 
        email: email.toLowerCase(), 
        _id: { $ne: req.user.id } 
      });
      
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Email is already in use by another account'
        });
      }
      
      updateFields.email = email.toLowerCase();
      updateFields.emailVerified = false; // Reset verification when email changes
    }
    
    if (phone) {
      updateFields.phone = phone;
      updateFields.phoneVerified = false; // Reset verification when phone changes
    }
    
    if (smsPhone) {
      updateFields['preferences.notifications.smsPhone'] = smsPhone;
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select('email phone preferences emailVerified phoneVerified');

    res.json({
      success: true,
      message: 'Account details updated successfully',
      data: {
        email: user.email,
        phone: user.phone,
        smsPhone: user.preferences?.notifications?.smsPhone || '',
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified
      },
    });
  } catch (error) {
    logger.error('Update account details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update account details',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

// @desc    Change password
// @route   PUT /api/users/change-password
// @access  Private
router.put('/change-password', protect, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.newPassword) {
      throw new Error('Password confirmation does not match');
    }
    return true;
  })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id).select('+password');

    // Verify current password
    const isPasswordMatch = await user.matchPassword(currentPassword);
    if (!isPasswordMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

// @desc    Apply coupon code
// @route   POST /api/users/apply-coupon
// @access  Private
router.post('/apply-coupon', protect, [
  body('couponCode').notEmpty().withMessage('Coupon code is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { couponCode } = req.body;

    // Validate coupon with Stripe
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    
    try {
      const coupon = await stripe.coupons.retrieve(couponCode);
      
      if (!coupon || !coupon.valid) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired coupon code'
        });
      }

      res.json({
        success: true,
        data: {
          coupon: {
            id: coupon.id,
            name: coupon.name,
            percentOff: coupon.percent_off,
            amountOff: coupon.amount_off,
            currency: coupon.currency,
            valid: coupon.valid
          }
        }
      });

    } catch (stripeError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coupon code'
      });
    }

  } catch (error) {
    logger.error('Apply coupon error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to apply coupon',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});
router.get('/:id', async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

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
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to get user',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;