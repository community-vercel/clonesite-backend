const express = require('express');
const { body, query, validationResult } = require('express-validator');
const mongoose = require('mongoose');

const Request = require('../models/request');
const User = require('../models/User');
const Category = require('../models/Category');
const Notification = require('../models/notifiication');
const { 
  protect, 
  requireCustomer,
  requireServiceProvider,
  requireOwnership 
} = require('../middleware/auth');
const { upload: multerUpload } = require('../middleware/uploadmiddleware'); // Rename for clarity
const sendEmail = require('../utils/email');
const logger = require('../utils/loggerutility');

const router = express.Router();







// @desc    Cancel request
// @route   PATCH /api/requests/:id/cancel
// @access  Private (Request owner only)
router.patch('/:id/cancel', protect, requireOwnership(Request, 'id', 'customer'), async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);

    if (!['published', 'receiving_quotes', 'quotes_received'].includes(request.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel request in current status'
      });
    }

    request.status = 'cancelled';
    await request.save();

    // Notify providers who submitted quotes
    for (const quote of request.quotes) {
      await Notification.create({
        user: quote.provider,
        type: 'request_cancelled',
        title: 'Request Cancelled',
        message: `The request "${request.title}" has been cancelled by the customer`,
        data: { requestId: request._id }
      });
    }

    res.json({
      success: true,
      message: 'Request cancelled successfully'
    });

  } catch (error) {
    logger.error('Cancel request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel request',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Submit quote for request
// @route   POST /api/requests/:id/quotes
// @access  Private (Service Providers)
router.post('/:id/quotes', protect, requireServiceProvider, [
  body('message').optional().isLength({ max: 1000 }),
  body('pricing.amount').isFloat({ min: 0 }).withMessage('Valid price is required'),
  body('pricing.type').isIn(['hourly', 'fixed', 'per_project']).withMessage('Valid pricing type required'),
  body('timeline.startDate').optional().isISO8601(),
  body('timeline.duration').isInt({ min: 1 }).withMessage('Duration is required'),
  body('timeline.completionDate').optional().isISO8601()
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

    const request = await Request.findById(req.params.id)
      .populate('customer', 'firstName lastName email');

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    // Check if request is still accepting quotes
    if (!request.isActive()) {
      return res.status(400).json({
        success: false,
        message: 'Request is no longer accepting quotes'
      });
    }

    // Check if provider already submitted a quote
    const existingQuote = request.quotes.find(
      quote => quote.provider.toString() === req.user.id
    );

    if (existingQuote) {
      return res.status(400).json({
        success: false,
        message: 'You have already submitted a quote for this request'
      });
    }

    // Add quote to request
    const quoteData = {
      provider: req.user.id,
      message: req.body.message,
      pricing: req.body.pricing,
      timeline: req.body.timeline,
      submittedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    };

    request.quotes.push(quoteData);
    request.analytics.quotesReceived = request.quotes.length;

    // Update status if this is the first quote
    if (request.quotes.length === 1) {
      request.status = 'quotes_received';
    }

    await request.save();

    // Notify customer
    await Notification.create({
      user: request.customer._id,
      type: 'quote_received',
      title: 'New Quote Received',
      message: `${req.user.fullName} submitted a quote for "${request.title}"`,
      data: {
        requestId: request._id,
        providerId: req.user.id,
        quoteAmount: req.body.pricing.amount
      }
    });

    // Send email to customer
    try {
      await sendEmail({
        email: request.customer.email,
        subject: 'New Quote for Your Service Request',
        template: 'quoteReceived',
        data: {
          customerName: request.customer.fullName,
          providerName: req.user.fullName,
          requestTitle: request.title,
          quoteAmount: req.body.pricing.amount,
          currency: req.body.pricing.currency || 'USD',
          requestUrl: `${process.env.CLIENT_URL}/requests/${request._id}`
        }
      });
    } catch (emailError) {
      logger.error('Quote notification email failed:', emailError);
    }

    const submittedQuote = request.quotes[request.quotes.length - 1];

    res.status(201).json({
      success: true,
      message: 'Quote submitted successfully',
      data: { quote: submittedQuote }
    });

  } catch (error) {
    logger.error('Submit quote error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit quote',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Update quote
// @route   PUT /api/requests/:id/quotes/:quoteId
// @access  Private (Quote owner only)
router.put('/:id/quotes/:quoteId', protect, requireServiceProvider, [
  body('message').optional().isLength({ max: 1000 }),
  body('pricing.amount').optional().isFloat({ min: 0 }),
  body('timeline.duration').optional().isInt({ min: 1 })
], async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    const quote = request.quotes.id(req.params.quoteId);
    
    if (!quote) {
      return res.status(404).json({
        success: false,
        message: 'Quote not found'
      });
    }

    // Check if user owns the quote
    if (quote.provider.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this quote'
      });
    }

    // Check if quote is still pending
    if (quote.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update accepted or rejected quote'
      });
    }

    // Create revision
    const revision = {
      message: req.body.message || quote.message,
      pricing: req.body.pricing || quote.pricing,
      timeline: req.body.timeline || quote.timeline,
      revisedAt: new Date()
    };

    quote.revisions.push(revision);

    // Update current quote
    Object.assign(quote, req.body);
    quote.submittedAt = new Date(); // Update submission time

    await request.save();

    res.json({
      success: true,
      message: 'Quote updated successfully',
      data: { quote }
    });

  } catch (error) {
    logger.error('Update quote error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update quote',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Withdraw quote
// @route   DELETE /api/requests/:id/quotes/:quoteId
// @access  Private (Quote owner only)
router.delete('/:id/quotes/:quoteId', protect, requireServiceProvider, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    const quote = request.quotes.id(req.params.quoteId);
    
    if (!quote) {
      return res.status(404).json({
        success: false,
        message: 'Quote not found'
      });
    }

    // Check if user owns the quote
    if (quote.provider.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to withdraw this quote'
      });
    }

    // Check if quote can be withdrawn
    if (quote.status === 'accepted') {
      return res.status(400).json({
        success: false,
        message: 'Cannot withdraw accepted quote'
      });
    }

    quote.status = 'withdrawn';
    await request.save();

    res.json({
      success: true,
      message: 'Quote withdrawn successfully'
    });

  } catch (error) {
    logger.error('Withdraw quote error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to withdraw quote',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Accept quote
// @route   POST /api/requests/:id/quotes/:quoteId/accept
// @access  Private (Request owner only)
router.post('/:id/quotes/:quoteId/accept', protect, requireOwnership(Request, 'id', 'customer'), async (req, res) => {
  try {
    const request = req.resource;
    const quote = request.quotes.id(req.params.quoteId);
    
    if (!quote) {
      return res.status(404).json({
        success: false,
        message: 'Quote not found'
      });
    }

    if (quote.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Quote is not available for acceptance'
      });
    }

    // Select provider and accept quote
    request.selectedProvider = quote.provider;
    request.selectedQuote = quote._id;
    request.status = 'provider_selected';

    // Set quote as accepted
    quote.status = 'accepted';

    // Reject all other quotes
    request.quotes.forEach(q => {
      if (q._id.toString() !== quote._id.toString() && q.status === 'pending') {
        q.status = 'rejected';
      }
    });

    // Set up project details
    request.project = {
      startDate: quote.timeline.startDate || new Date(),
      expectedEndDate: quote.timeline.completionDate,
      milestones: []
    };

    // Set payment information
    request.payment = {
      totalAmount: quote.pricing.amount,
      currency: quote.pricing.currency || 'USD',
      method: 'card',
      schedule: 'on_completion'
    };

    await request.save();

    // Notify selected provider
    await Notification.create({
      user: quote.provider,
      type: 'quote_accepted',
      title: 'Quote Accepted!',
      message: `Your quote for "${request.title}" has been accepted`,
      data: {
        requestId: request._id,
        quoteAmount: quote.pricing.amount
      }
    });

    // Notify rejected providers
    const rejectedProviders = request.quotes
      .filter(q => q.status === 'rejected')
      .map(q => q.provider);

    for (const providerId of rejectedProviders) {
      await Notification.create({
        user: providerId,
        type: 'quote_rejected',
        title: 'Quote Not Selected',
        message: `Your quote for "${request.title}" was not selected`,
        data: { requestId: request._id }
      });
    }

    res.json({
      success: true,
      message: 'Quote accepted successfully',
      data: { request }
    });

  } catch (error) {
    logger.error('Accept quote error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept quote',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Get my requests (as customer)
// @route   GET /api/requests/my-requests
// @access  Private (Customers)
router.get('/my-requests', protect, requireCustomer, [
  query('status').optional().isIn(['draft', 'published', 'receiving_quotes', 'quotes_received', 'provider_selected', 'in_progress', 'completed', 'cancelled']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    let query = { customer: req.user.id };

    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const requests = await Request.find(query)
      .populate('category', 'name slug icon')
      .populate('selectedProvider', 'firstName lastName avatar businessName rating')
      .populate('quotes.provider', 'firstName lastName avatar businessName rating')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Request.countDocuments(query);

    // Get request statistics
    const stats = await Request.aggregate([
      { $match: { customer: req.user._id || req.use.userId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalSpent: { $sum: '$payment.totalAmount' }
        }
      }
    ]);

    const requestStats = {
      total: stats.reduce((sum, stat) => sum + stat.count, 0),
      active: stats.filter(s => ['published', 'receiving_quotes', 'quotes_received', 'provider_selected', 'in_progress'].includes(s._id)).reduce((sum, stat) => sum + stat.count, 0),
      completed: stats.find(s => s._id === 'completed')?.count || 0,
      cancelled: stats.find(s => s._id === 'cancelled')?.count || 0,
      totalSpent: stats.reduce((sum, stat) => sum + (stat.totalSpent || 0), 0)
    };

    res.json({
      success: true,
      data: {
        requests,
        stats: requestStats,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Get my requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get requests',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Get my quotes (as service provider)
// @route   GET /api/requests/my-quotes
// @access  Private (Service Providers)
router.get('/my-quotes', protect, requireServiceProvider, [
  query('status').optional().isIn(['pending', 'accepted', 'rejected', 'withdrawn']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    let matchQuery = {
      'quotes.provider': req.user._id
    };

    let pipeline = [
      { $match: matchQuery },
      { $unwind: '$quotes' },
      { $match: { 'quotes.provider': req.user._id } }
    ];

    if (status) {
      pipeline.push({ $match: { 'quotes.status': status } });
    }

    pipeline.push(
      {
        $lookup: {
          from: 'users',
          localField: 'customer',
          foreignField: '_id',
          as: 'customer'
        }
      },
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: '$customer' },
      { $unwind: '$category' },
      {
        $project: {
          title: 1,
          description: 1,
          status: 1,
          location: 1,
          createdAt: 1,
          updatedAt: 1,
          quote: '$quotes',
          customer: {
            firstName: '$customer.firstName',
            lastName: '$customer.lastName',
            avatar: '$customer.avatar',
            rating: '$customer.rating'
          },
          category: {
            name: '$category.name',
            slug: '$category.slug',
            icon: '$category.icon'
          }
        }
      },
      { $sort: { 'quote.submittedAt': -1 } }
    );

    const skip = (page - 1) * limit;
    pipeline.push({ $skip: skip }, { $limit: parseInt(limit) });

    const quotes = await Request.aggregate(pipeline);

    // Get total count
    const totalPipeline = [
      { $match: matchQuery },
      { $unwind: '$quotes' },
      { $match: { 'quotes.provider': req.user._id } }
    ];

    if (status) {
      totalPipeline.push({ $match: { 'quotes.status': status } });
    }

    totalPipeline.push({ $count: 'total' });
    const totalResult = await Request.aggregate(totalPipeline);
    const total = totalResult[0]?.total || 0;

    res.json({
      success: true,
      data: {
        quotes,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Get my quotes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get quotes',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});


// @desc    Get all requests (for service providers)
// @route   GET /api/requests
// @access  Private (Service Providers)
router.get('/', protect, requireServiceProvider, [
  query('status').optional().isIn(['published', 'receiving_quotes', 'quotes_received', 'provider_selected', 'in_progress', 'completed', 'cancelled']),
  query('category').optional().isMongoId(),
  query('location').optional().isString(),
  query('radius').optional().isInt({ min: 1, max: 100 }),
  query('budget.min').optional().isFloat({ min: 0 }),
  query('budget.max').optional().isFloat({ min: 0 }),
  query('urgency').optional().isIn(['low', 'medium', 'high', 'urgent']),
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
      status,
      category,
      location,
      radius = 25,
      urgency,
      page = 1,
      limit = 20
    } = req.query;

    // Build query - only show active requests
    let query = {
      status: { $in: ['published', 'receiving_quotes', 'quotes_received'] },
      expiresAt: { $gt: new Date() }
    };

    // Filter by status
    if (status) {
      query.status = status;
    }

    // Filter by category
    if (category) {
      query.category = category;
    }

    // Filter by urgency
    if (urgency) {
      query['timeline.urgency'] = urgency;
    }

    // Budget filter
    if (req.query['budget.min'] || req.query['budget.max']) {
      query.budget = {};
      if (req.query['budget.min']) {
        query.budget.min = { $gte: parseFloat(req.query['budget.min']) };
      }
      if (req.query['budget.max']) {
        query.budget.max = { $lte: parseFloat(req.query['budget.max']) };
      }
    }

    // Location-based search
    if (location) {
      const [lat, lng] = location.split(',').map(Number);
      if (lat && lng) {
        query['location.coordinates'] = {
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

    // Exclude requests where provider already submitted a quote
    query['quotes.provider'] = { $ne: req.user.id };

    // Pagination
    const skip = (page - 1) * limit;

    const requests = await Request.find(query)
      .populate('customer', 'firstName lastName avatar rating isVerified')
      .populate('category', 'name slug icon')
      .populate('subCategory', 'name slug')
      .select('-quotes') // Don't show quotes to other providers
      .sort({ 
        'timeline.urgency': -1, 
        createdAt: -1 
      })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Request.countDocuments(query);

    res.json({
      success: true,
      data: {
        requests,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Get requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get requests',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Get single request
// @route   GET /api/requests/:id
// @access  Private
// @desc    Get a specific request by ID
// @route   GET /api/requests/:id
// @access  Private (Customers only)
router.get('/:id', protect, requireCustomer, async (req, res) => {
  try {
    // Validate ObjectId
   

    const request = await Request.findById(req.params.id)
      .populate('category', 'name slug icon')
      .populate('selectedProvider', 'firstName lastName avatar businessName rating')
      .populate('quotes.provider', 'firstName lastName avatar businessName rating');

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found',
      });
    }

    // Ensure the user owns the request
    if (request.customer.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this request',
      });
    }

    res.json({
      success: true,
      data: request,
    });
  } catch (error) {
    logger.error('Get request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get request',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});
// @desc    Create new request
// @route   POST /api/requests
// @access  Private (Customers)
// router.post('/', protect, requireCustomer, multerUpload.array('attachments', 5), [
//   body('title').notEmpty().withMessage('Request title is required').isLength({ max: 200 }),
//   body('description').notEmpty().withMessage('Description is required').isLength({ max: 2000 }),
//   body('category').isMongoId().withMessage('Valid category is required'),
//   body('location.address').notEmpty().withMessage('Address is required'),
//   body('location.city').notEmpty().withMessage('City is required'),
//   body('location.coordinates').isArray({ min: 2, max: 2 }).withMessage('Valid coordinates required'),
// body('timeline.urgency').optional().isIn(['asap', 'within_week', 'within_month', 'flexible']),
// body('timeline.flexibility').optional().isIn(['flexible', 'strict']),
//   body('budget.min').optional().isFloat({ min: 0 }),
//   body('budget.max').optional().isFloat({ min: 0 }),
//   body('budget.type').optional().isIn(['hourly', 'fixed', 'per_project', 'negotiable'])
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

//     // Validate category exists
//     const category = await Category.findById(req.body.category);
//     if (!category) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid category'
//       });
//     }

//     // Process multerUploaded attachments
//     const attachments = req.files ? req.files.map(file => ({
//       type: file.mimetype.startsWith('image/') ? 'image' : 'document',
//       url: file.path,
//       filename: file.originalname,
//       size: file.size
//     })) : [];

//     const requestData = {
//       ...req.body,
//       customer: req.user.id,
//       attachments,
//       status: 'published'
//     };

//     const request = await Request.create(requestData);

//     // Populate the response
//     await request.populate('customer', 'firstName lastName avatar');
//     await request.populate('category', 'name slug icon');

//     // Find nearby service providers to notify
//     const nearbyProviders = await User.findNearby(
//       req.body.location.coordinates,
//       25000 // 25km
//     ).where({
//       userType: { $in: ['service_provider', 'both'] },
//       categories: category._id,
//       isActive: true,
//       isVerified: true
//     });

//     // Send notifications to nearby providers
//     for (const provider of nearbyProviders) {
//       await Notification.create({
//         user: provider._id,
//         type: 'new_request',
//         title: 'New Service Request',
//         message: `New ${category.name} request in your area: ${request.title}`,
//         data: {
//           requestId: request._id,
//           category: category.name
//         }
//       });

//       // Send email notification
//       try {
//         await sendEmail({
//           email: provider.email,
//           subject: 'New Service Request in Your Area',
//           template: 'newRequest',
//           data: {
//             providerName: provider.fullName,
//             requestTitle: request.title,
//             category: category.name,
//             location: request.location.city,
//             requestUrl: `${process.env.CLIENT_URL}/requests/${request._id}`
//           }
//         });
//       } catch (emailError) {
//         logger.error('Email notification failed:', emailError);
//       }
//     }

//     res.status(201).json({
//       success: true,
//       message: 'Request created successfully',
//       data: { request }
//     });

//   } catch (error) {
//     logger.error('Create request error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create request',
//       error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
//     });
//   }
// });
// Modify your existing POST /api/requests route to include lead generation
// Add this to your request router file

// @desc    Create new request with lead generation
// @route   POST /api/requests
// @access  Private (Customers)
router.post('/', protect, requireCustomer, multerUpload.array('attachments', 5), [
  body('title').notEmpty().withMessage('Request title is required').isLength({ max: 200 }),
  body('description').notEmpty().withMessage('Description is required').isLength({ max: 2000 }),
  body('category').isMongoId().withMessage('Valid category is required'),
  body('location.address').notEmpty().withMessage('Address is required'),
  body('location.city').notEmpty().withMessage('City is required'),
  body('location.coordinates').isArray({ min: 2, max: 2 }).withMessage('Valid coordinates required'),
  body('timeline.urgency').optional().isIn(['asap', 'within_week', 'within_month', 'flexible']),
  body('timeline.flexibility').optional().isIn(['flexible', 'strict']),
  body('budget.min').optional().isFloat({ min: 0 }),
  body('budget.max').optional().isFloat({ min: 0 }),
  body('budget.type').optional().isIn(['hourly', 'fixed', 'per_project', 'negotiable'])
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

    // Process uploaded attachments
    const attachments = req.files ? req.files.map(file => ({
      type: file.mimetype.startsWith('image/') ? 'image' : 'document',
      url: file.path,
      filename: file.originalname,
      size: file.size
    })) : [];

    const requestData = {
      ...req.body,
      customer: req.user.id,
      attachments,
      status: 'published',
      analytics: {
        quotesReceived: 0,
        views: 0,
        contactsInitiated: 0,
        contactedProviders: []
      }
    };

    const request = await Request.create(requestData);

    // Populate the response
    await request.populate('customer', 'firstName lastName avatar');
    await request.populate('category', 'name slug icon');

    // Find matching service providers for leads
    const matchingProviders = await User.find({
      userType: { $in: ['service_provider', 'both'] },
      categories: category._id,
      isActive: true,
      isVerified: true,
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: req.body.location.coordinates
          },
          $maxDistance: 50000 // 50km
        }
      }
    }).limit(20); // Limit initial leads

    // Send notifications to nearby providers (keep existing notification logic)
    for (const provider of matchingProviders) {
      await Notification.create({
        user: provider._id,
        type: 'new_request',
        title: 'New Service Request',
        message: `New ${category.name} request in your area: ${request.title}`,
        data: {
          requestId: request._id,
          category: category.name
        }
      });

      // Send email notification (keep existing email logic)
      try {
        await sendEmail({
          email: provider.email,
          subject: 'New Service Request in Your Area',
          template: 'newRequest',
          data: {
            providerName: provider.fullName,
            requestTitle: request.title,
            category: category.name,
            location: request.location.city,
            requestUrl: `${process.env.CLIENT_URL}/requests/${request._id}`
          }
        });
      } catch (emailError) {
        logger.error('Email notification failed:', emailError);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Request created successfully',
      data: { 
        request,
        leadsCount: matchingProviders.length // Include leads count in response
      }
    });

  } catch (error) {
    logger.error('Create request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create request',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Update request
// @route   PUT /api/requests/:id
// @access  Private (Request owner only)
router.put('/:id', protect, requireOwnership(Request, 'id', 'customer'), [
  body('title').optional().isLength({ max: 200 }),
  body('description').optional().isLength({ max: 2000 }),
  body('timeline.preferredDate').optional().isISO8601(),
  body('budget.min').optional().isFloat({ min: 0 }),
  body('budget.max').optional().isFloat({ min: 0 })
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

    // Don't allow updates if quotes have been received
    if (req.resource.quotes.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update request after receiving quotes'
      });
    }

    const request = await Request.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
    .populate('customer', 'firstName lastName avatar')
    .populate('category', 'name slug icon');

    res.json({
      success: true,
      message: 'Request updated successfully',
      data: { request }
    });

  } catch (error) {
    logger.error('Update request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update request',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});



// @desc    Start project
// @route   POST /api/requests/:id/start
// @access  Private (Selected provider only)
router.post('/:id/start', protect, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    // Check if user is the selected provider
    if (!request.selectedProvider || request.selectedProvider.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to start this project'
      });
    }

    if (request.status !== 'provider_selected') {
      return res.status(400).json({
        success: false,
        message: 'Project cannot be started in current status'
      });
    }

    request.status = 'in_progress';
    request.project.startDate = new Date();
    
    await request.save();

    // Notify customer
    await Notification.create({
      user: request.customer,
      type: 'project_started',
      title: 'Project Started',
      message: `${req.user.fullName} has started working on "${request.title}"`,
      data: { requestId: request._id }
    });

    res.json({
      success: true,
      message: 'Project started successfully',
      data: { request }
    });

  } catch (error) {
    logger.error('Start project error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start project',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @desc    Complete project
// @route   POST /api/requests/:id/complete
// @access  Private (Selected provider only)
router.post('/:id/complete', protect, async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    // Check if user is the selected provider
    if (!request.selectedProvider || request.selectedProvider.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to complete this project'
      });
    }

    if (request.status !== 'in_progress') {
      return res.status(400).json({
        success: false,
        message: 'Project cannot be completed in current status'
      });
    }

    request.status = 'completed';
    request.project.actualEndDate = new Date();
    
    await request.save();

    // Notify customer
    await Notification.create({
      user: request.customer,
      type: 'project_completed',
      title: 'Project Completed',
      message: `${req.user.fullName} has completed "${request.title}"`,
      data: { requestId: request._id }
    });

    res.json({
      success: true,
      message: 'Project completed successfully',
      data: { request }
    });

  } catch (error) {
    logger.error('Complete project error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete project',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;