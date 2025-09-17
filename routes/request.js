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
// @desc    Get leads for service provider
// @route   GET /api/provider-leads
// @access  Private (Service Providers)
// router.get('/getleads', protect, requireServiceProvider, [
//   query('page').optional().isInt({ min: 1 }),
//   query('limit').optional().isInt({ min: 1, max: 50 }),
//   query('status').optional().isIn(['published', 'receiving_quotes', 'quotes_received']),
//   query('category').optional().isMongoId(),
//   query('location').optional().isString(),
//   query('radius').optional().isInt({ min: 1, max: 100 }),
//   query('urgency').optional().isIn(['low', 'medium', 'high', 'urgent']),
//   query('sortBy').optional().isIn(['rating', 'distance', 'urgency', 'newest', 'matchScore'])
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

//     const {
//       page = 1,
//       limit = 20,
//       status,
//       category,
//       location,
//       radius = 50,
//       urgency,
//       sortBy = 'matchScore'
//     } = req.query;

//     // Build query - only show active requests
//     let query = {
//       status: { $in: ['published', 'receiving_quotes', 'quotes_received'] },
//       expiresAt: { $gt: new Date() }
//     };

//     // Filter by status
//     if (status) {
//       query.status = status;
//     }

//     // Filter by category (provider's categories)
//     const provider = await User.findById(req.user.id).select('categories');
//     if (category) {
//       query.category = category;
//     } else if (provider.categories.length > 0) {
//       query.category = { $in: provider.categories };
//     }
// console.log("total",provider);
// console.log("total",query);

//     // Filter by urgency
//     if (urgency) {
//       query['timeline.urgency'] = urgency;
//     }

//     // Location-based search
//     if (location) {
//       const [lat, lng] = location.split(',').map(Number);
//       if (lat && lng) {
//         query['location.coordinates'] = {
//           $near: {
//             $geometry: {
//               type: 'Point',
//               coordinates: [lng, lat]
//             },
//             $maxDistance: radius * 1000 // Convert km to meters
//           }
//         };
//       }
//     }

//     // Exclude requests where provider already submitted a quote
//     query['quotes.provider'] = { $ne: req.user.id };

//     // Pagination
//     const skip = (page - 1) * limit;
// console.log("total",query);

//     // Execute query
//     const requests = await Request.find(query)
//       .populate('customer', 'firstName lastName avatar email phone isVerified')
//       .populate('category', 'name slug icon')
//       .select('-quotes') // Don't show quotes to provider
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(parseInt(limit));

//     const total = await Request.countDocuments(query);
// console.log("total",total);
//     // Transform requests into leads format
//     const leads = requests.map(request => {
//       const customer = request.customer;
//       return {
//         id: request._id,
//         name: `${customer.firstName} ${customer.lastName}`,
//         location: request.location.city || request.location.address,
//         region: request.location.region || 'Nationwide',
//         service: request.category.name,
//         description: request.description,
//         credits: request.analytics ? request.analytics.credits || null : null, // Add credits logic if implemented
//         responseCount: `${request.quotes.length}/5`, // Simplified response count
//         timeAgo: `${Math.floor((new Date() - request.createdAt) / 60000)}m ago`, // Approximate time
//         avatar: customer.firstName.charAt(0).toUpperCase(),
//         avatarColor: `bg-${['blue', 'green', 'purple', 'red'][Math.floor(Math.random() * 4)]}-500`,
//         highlighted: request.timeline.urgency === 'urgent',
//         phone: customer.phone || 'N/A',
//         email: customer.email || 'N/A',
//         serviceType: request.category.name,
//         fullLocation: `${request.location.city || request.location.address} (${request.location.region || 'Nationwide'})`,
//         remoteService: request.remoteService || 'Happy to receive service online or remotely',
//         verified: customer.isVerified || false,
//         hiringIntent: request.timeline.urgency === 'urgent' ? 'High hiring intent' : 'Medium hiring intent',
//         additionalDetails: !!request.attachments.length,
//         professionalResponses: `${request.quotes.length}/5 professionals have responded.`,
//         details: request.details || 'What service do you need?'
//       };
//     });

//     // Sort based on sortBy
//     let sortedLeads = [...leads];
//     switch (sortBy) {
//       case 'rating':
//         sortedLeads.sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0)); // Simplified
//         break;
//       case 'distance':
//         sortedLeads.sort((a, b) => a.location.localeCompare(b.location)); // Simplified
//         break;
//       case 'urgency':
//         sortedLeads.sort((a, b) => (b.highlighted ? 1 : 0) - (a.highlighted ? 1 : 0));
//         break;
//       case 'newest':
//         sortedLeads.sort((a, b) => new Date(b.timeAgo) - new Date(a.timeAgo));
//         break;
//       case 'matchScore':
//         sortedLeads.sort((a, b) => calculateMatchScore(b) - calculateMatchScore(a));
//         break;
//     }

//     res.json({
//       success: true,
//       data: {
//         leads: sortedLeads,
//         pagination: {
//           currentPage: parseInt(page),
//           totalPages: Math.ceil(total / limit),
//           totalItems: total,
//           itemsPerPage: parseInt(limit)
//         }
//       }
//     });
//   } catch (error) {
//     logger.error('Get provider leads error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to get leads',
//       error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
//     });
//   }
// });

// Helper function to calculate match score (simplified)
// function calculateMatchScore(lead) {
//   let score = 0;
//   if (lead.verified) score += 30;
//   if (lead.highlighted) score += 40;
//   if (lead.credits) score += 20;
//   return score;
// }



const calculateMatchScore = (request, provider) => {
  let score = 0;
  
  // Category match (40% weight)
  if (provider.categories.includes(request.category.toString())) {
    score += 40;
  }
  
  // Location proximity (25% weight)
  if (request.location && provider.serviceAreas) {
    const distance = calculateDistance(
      request.location.coordinates,
      provider.location?.coordinates
    );
    if (distance <= 10) score += 25;
    else if (distance <= 25) score += 20;
    else if (distance <= 50) score += 15;
  }
  
  // Provider rating (20% weight)
  if (provider.rating?.average >= 4.5) score += 20;
  else if (provider.rating?.average >= 4.0) score += 15;
  else if (provider.rating?.average >= 3.5) score += 10;
  
  // Response time (10% weight)
  if (provider.responseTime?.average <= 2) score += 10;
  else if (provider.responseTime?.average <= 6) score += 8;
  else if (provider.responseTime?.average <= 12) score += 5;
  
  // Urgency bonus (5% weight)
  if (request.timeline?.urgency === 'urgent') score += 5;
  
  return Math.min(score, 100);
};

// Helper function to calculate distance between coordinates
const calculateDistance = (coords1, coords2) => {
  if (!coords1 || !coords2) return 1000;
  
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;
  
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// Helper function to determine lead cost (Bark-style pricing)
const calculateLeadCost = (request, provider) => {
  let baseCost = 5; // Base cost in credits
  
  // Category-based pricing
  const premiumCategories = [
    'home-improvement', 'legal-services', 'financial-services',
    'wedding-services', 'business-services'
  ];
  
  if (premiumCategories.includes(request.category.slug)) {
    baseCost = 8;
  }
  
  // Location-based pricing (major cities cost more)
const majorCities = [
  // UK
  'London', 'Manchester', 'Birmingham', 'Glasgow', 'Liverpool', 'Leeds', 'Edinburgh', 'Bristol',

  // USA
  'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 
  'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose',

  // Pakistan
  'Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 
  'Multan', 'Peshawar', 'Quetta', 'Hyderabad'
];
  if (majorCities.some(city => 
    request.location?.city?.toLowerCase().includes(city)
  )) {
    baseCost += 2;
  }
  
  // Urgency pricing
  if (request.timeline?.urgency === 'urgent') {
    baseCost += 1;
  }
  
  // Competition factor (more competition = higher price)
  const quotesCount = request.quotes?.length || 0;
  if (quotesCount < 2) {
    baseCost -= 1; // Less competition
  } else if (quotesCount >= 5) {
    baseCost += 2; // High competition
  }
  
  return Math.max(baseCost, 3); // Minimum 3 credits
};
const parseCoordinates = (locationStr) => {
  if (!locationStr) return null;
  const [lat, lng] = locationStr.split(',').map(Number);
  return (lat && lng && !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)
    ? [lng, lat] // MongoDB expects [lng, lat] order
    : null;
};


router.get('/getleads', protect, requireServiceProvider, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('status').optional().isIn(['published', 'receiving_quotes', 'quotes_received']),
  query('category').optional().isMongoId(),
  query('location').optional().isString(),
  query('radius').optional().isInt({ min: 1, max: 100 }),
  query('urgency').optional().isIn(['low', 'medium', 'high', 'urgent']),
  query('sortBy').optional().isIn(['match_score', 'newest', 'urgency', 'distance', 'credits']),
  query('minBudget').optional().isNumeric(),
  query('maxBudget').optional().isNumeric(),
  query('leadType').optional().isIn(['free', 'paid', 'all'])
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
      page = 1,
      limit = 20,
      status,
      category,
      location,
      radius = 50,
      urgency,
      sortBy = 'match_score',
      minBudget,
      maxBudget,
      leadType = 'all'
    } = req.query;

    // Get provider details with categories and service areas
    const provider = await User.findById(req.user.id)
      .select('categories serviceAreas location rating responseTime profile credits')
      .populate('categories', 'name slug');


    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    // Build base query for active requests
    let query = {
      status: { $in: ['published', 'receiving_quotes', 'quotes_received'] },
      expiresAt: { $gt: new Date() }
    };

    // Filter by status
    if (status) {
      query.status = status;
    }

    // Filter by provider's categories or specific category
    if (category) {
      query.category = category;
    } else if (provider.categories?.length > 0) {
      query.category = { $in: provider.categories.map(cat => cat._id) };
    }

    // Filter by urgency
    if (urgency) {
      query['timeline.urgency'] = urgency;
    }

    // Budget filters
    if (minBudget || maxBudget) {
      query['budget.amount'] = {};
      if (minBudget) query['budget.amount'].$gte = parseFloat(minBudget);
      if (maxBudget) query['budget.amount'].$lte = parseFloat(maxBudget);
    }

    // Location filtering with logging
    if (location) {
      const coords = parseCoordinates(location);
      console.log("Parsed Coordinates:", coords);
      if (coords) {
        query['location.coordinates'] = {
          $geoWithin: {
            $centerSphere: [coords, (radius || 50) / 6378.1] // Radius in radians
          }
        };
        console.log("Geospatial Query Applied:", query['location.coordinates']);
      } else {
        throw new Error('Invalid location coordinates format. Use "lat,lng" (e.g., "31.5204,74.3587")');
      }
    } else if (provider.serviceAreas?.length > 0) {
      console.log("Service Areas:", provider.serviceAreas);
      const areaQueries = provider.serviceAreas
        .filter(area => area.city || area.region)
        .map(area => ({
          $or: [
            area.city ? { 'location.city': { $regex: new RegExp(area.city, 'i') } } : {},
            area.region ? { 'location.region': { $regex: new RegExp(area.region, 'i') } } : {}
          ].filter(Boolean)
        }))
        .filter(query => query.$or.length > 0);
      if (areaQueries.length > 0) {
        query.$or = areaQueries.length === 1 ? areaQueries[0].$or : { $or: [].concat(...areaQueries.map(q => q.$or)) };
        console.log("Service Areas Query Applied:", query.$or);
      }
    } else if (provider.location?.coordinates?.length === 2) {
  const defaultRadius = process.env.DEFAULT_SERVICE_RADIUS ? parseInt(process.env.DEFAULT_SERVICE_RADIUS) : 500; // Configurable via env (e.g., 50km)
  console.log("Using Provider Location:", provider.location.coordinates, "with Radius:", defaultRadius);
  query['location.coordinates'] = {
    $geoWithin: {
      $centerSphere: [provider.location.coordinates, defaultRadius / 6378.1]
    }
  };
}

    // Exclude requests where provider already quoted
    query['quotes.provider'] = { $ne: req.user.id };

    // Exclude requests from blocked customers
    if (provider.blockedCustomers?.length > 0) {
      query.customer = { $nin: provider.blockedCustomers };
    }

    // Log the final query before execution

    // Pagination
    const skip = (page - 1) * limit;


    const requests = await Request.find(query)
      .populate('customer', 'firstName lastName avatar email phone isVerified rating createdAt')
      .populate('category', 'name slug icon pricingInfo customFields')
      .populate('subCategory', 'name slug')
      .select('-quotes.details -internalNotes')
      .sort({ createdAt: -1, 'timeline.urgency': -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

console.log("Custom Field:", JSON.stringify(requests, null, 2));

    const total = await Request.countDocuments(query);

    // Transform requests into Bark-style leads
    const leads = requests.map(request => {

      const customer = request.customer;
      const matchScore = calculateMatchScore(request, provider);
      const leadCost = calculateLeadCost(request, provider);
      const isUrgent = request.timeline?.urgency === 'urgent';
      const isFree = leadCost <= 3 || request.promotionalLead;

      if (leadType === 'free' && !isFree) return null;
      if (leadType === 'paid' && isFree) return null;
                 console.log("Category:",  request[" createdAt "] || request.createdAt); // or any field in category
 const timeAgo = Math.floor((new Date() - new Date(request[" createdAt "] || request.createdAt)) / 60000);
  const timeDisplay =
    timeAgo < 60
      ? `${timeAgo}m ago`
      : timeAgo < 1440
      ? `${Math.floor(timeAgo / 60)}h ago`
      : `${Math.floor(timeAgo / 1440)}d ago`;

  console.log("Time Display:", timeDisplay);
      return {
        id: request._id,
        title: request.title || `${request.category.name} Required`,
        description: request.description || 'Service request',
        customer: {
          id: customer._id,
          name: `${customer.firstName} ${customer.lastName}`,
          avatar: customer.avatar || customer.firstName.charAt(0).toUpperCase(),
          avatarColor: `bg-${['blue', 'green', 'purple', 'red', 'yellow'][Math.floor(Math.random() * 5)]}-500`,
          isVerified: customer.isVerified || false,
          memberSince: customer.createdAt,
          rating: customer.rating?.average || null,
          phone: customer.phone || 'Available after contact',
          email: customer.email || 'Available after contact'
        },
        location: {
          display: request.location?.city || request.location?.address || request.location?.state || 'Remote',
          region: request.location?.region || 'UK',
          full: `${request.location?.state ||request.location?.city || request.location?.address || 'Remote'}, ${request.location?.region || 'UK'}`,
          coordinates: request.location?.coordinates,
          distance: provider.location?.coordinates
            ? calculateDistance(request.location?.coordinates, provider.location.coordinates)
            : null
        },
        service: {
          category: request.category.name,
          subCategory: request.subCategory?.name,
          icon: request.category.icon,
          slug: request.category.slug
        },
        timing: {
          posted: request.createdAt,
          timeAgo: timeDisplay,
          urgency: request.timeline?.urgency || 'medium',
          isUrgent,
          deadline: request['expiresAt'],
          startDate: request.timeline?.startDate
        },
        budget: {
          amount: request.budget?.amount,
          type: request.budget?.type || 'negotiable',
          currency: request.budget?.currency || 'GBP',
          display: request.budget?.amount
            ? `£${request.budget.amount}${request.budget.type === 'hourly' ? '/hr' : ''}`
            : 'Budget negotiable'
        },
        lead: {
          cost: leadCost,
          isFree,
          isPremium: leadCost >= 8,
          matchScore,
          quotesCount: request.analytics?.quotesReceived || 0,
          maxQuotes: 5,
          responseRate: `${request.analytics?.quotesReceived || 0}/5`,
          viewsCount: request.analytics?.views || 0
        },
        flags: {
          highlighted: isUrgent,
          firstToRespond: (request.analytics?.quotesReceived || 0) === 0,
          quickResponse: request.responseTime?.target <= 2,
          verified: customer.isVerified,
          hasAttachments: request.attachments?.length > 0,
          hasAdditionalDetails: !!request.customFields?.length,
          remoteOk: request.remoteService === true
        },
       customFields: request.category?.customFields?.map(field => ({
    key: field.key,
    name: field.label,
    type: field.type,
    value: field.options,
    required: field.required,
    display: `${field.label} (${field.type})`
  })) || [],
        meta: {
          status: request.status,
          expiresAt: request.expiresAt,
          canContact: true,
          hasResponded: false,
          bookmarked: false
        }
      };
    }).filter(lead => lead !== null);

    let sortedLeads = [...leads];
    switch (sortBy) {
      case 'match_score':
        sortedLeads.sort((a, b) => b.lead.matchScore - a.lead.matchScore);
        break;
      case 'newest':
        sortedLeads.sort((a, b) => new Date(b.timing.posted) - new Date(a.timing.posted));
        break;
      case 'urgency':
        sortedLeads.sort((a, b) => {
          const urgencyOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
          return urgencyOrder[b.timing.urgency] - urgencyOrder[a.timing.urgency];
        });
        break;
      case 'distance':
        sortedLeads.sort((a, b) => (a.location.distance || 999) - (b.location.distance || 999));
        break;
      case 'credits':
        sortedLeads.sort((a, b) => a.lead.cost - b.lead.cost);
        break;
    }

    const stats = {
      total: sortedLeads.length,
      free: sortedLeads.filter(lead => lead.lead.isFree).length,
      paid: sortedLeads.filter(lead => !lead.lead.isFree).length,
      urgent: sortedLeads.filter(lead => lead.flags.highlighted).length,
      firstToRespond: sortedLeads.filter(lead => lead.flags.firstToRespond).length,
      averageMatchScore: Math.round(
        sortedLeads.reduce((sum, lead) => sum + lead.lead.matchScore, 0) / sortedLeads.length
      ) || 0,
      totalCreditsRequired: sortedLeads.reduce((sum, lead) => sum + lead.lead.cost, 0)
    };

    res.json({
      success: true,
      data: {
        leads: sortedLeads,
        stats,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        },
        provider: {
          id: provider._id,
          categories: provider.categories,
          serviceAreas: provider.serviceAreas,
          credits: provider.credits || 0,
          rating: provider.rating,
          responseTime: provider.responseTime
        },
        filters: {
          applied: {
            category: category || null,
            location: location || null,
            radius,
            urgency: urgency || null,
            minBudget: minBudget || null,
            maxBudget: maxBudget || null,
            leadType
          },
          available: {
            categories: provider.categories,
            urgencyLevels: ['low', 'medium', 'high', 'urgent'],
            leadTypes: ['all', 'free', 'paid'],
            sortOptions: ['match_score', 'newest', 'urgency', 'distance', 'credits']
          }
        }
      }
    });

  } catch (error) {
    logger.error('Get provider leads error:', error);
    console.error("Error Details:", error); // Log error for debugging
    res.status(500).json({
      success: false,
      message: 'Failed to get leads',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});


// @desc    Get my responses (quotes submitted by provider)
// @route   GET /api/requests/my-responses
// @access  Private (Service Providers)
router.get('/my-responses', protect, requireServiceProvider, [
  query('status').optional().isIn(['pending', 'accepted', 'rejected', 'withdrawn']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('category').optional().isMongoId(),
  query('sortBy').optional().isIn(['newest', 'status', 'responseTime'])
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

    const { status, page = 1, limit = 20, category, sortBy = 'newest' } = req.query;
    const providerId = req.user.id;

    // Build aggregation pipeline
    let pipeline = [
      { $match: { 'quotes.provider': new mongoose.Types.ObjectId(providerId) } },
      { $unwind: '$quotes' },
      { $match: { 'quotes.provider': new mongoose.Types.ObjectId(providerId) } },
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
            _id: '$customer._id',
            name: { $concat: ['$customer.firstName', ' ', '$customer.lastName'] },
            avatar: '$customer.avatar',
            isVerified: '$customer.isVerified',
            email: {
              $cond: {
                if: { $ne: ['$quotes.contactedAt', null] },
                then: '$customer.email',
                else: 'Available after contact'
              }
            },
            phone: {
              $cond: {
                if: { $ne: ['$quotes.contactedAt', null] },
                then: '$customer.phone',
                else: 'Available after contact'
              }
            }
          },
          category: {
            name: '$category.name',
            slug: '$category.slug',
            icon: '$category.icon'
          }
        }
      }
    ];

    // Filter by status
    if (status) {
      pipeline.push({ $match: { 'quote.status': status } });
    }

    // Filter by category
    if (category) {
      pipeline.push({ $match: { 'category._id': new mongoose.Types.ObjectId(category) } });
    }

    // Sort logic
    let sort = {};
    switch (sortBy) {
      case 'status':
        sort = { 'quote.status': 1, 'quote.submittedAt': -1 };
        break;
      case 'responseTime':
        sort = { 'quote.contactedAt': 1 };
        break;
      case 'newest':
      default:
        sort = { 'quote.submittedAt': -1 };
        break;
    }
    pipeline.push({ $sort: sort });

    // Pagination
    const skip = (page - 1) * limit;
    pipeline.push({ $skip: skip }, { $limit: parseInt(limit) });

    // Execute aggregation
    const responses = await Request.aggregate(pipeline);

    // Get total count
    const totalPipeline = [
      { $match: { 'quotes.provider': new mongoose.Types.ObjectId(providerId) } },
      { $unwind: '$quotes' },
      { $match: { 'quotes.provider': new mongoose.Types.ObjectId(providerId) } }
    ];
    if (status) {
      totalPipeline.push({ $match: { 'quotes.status': status } });
    }
    if (category) {
      totalPipeline.push({ $match: { 'category._id': new mongoose.Types.ObjectId(category) } });
    }
    totalPipeline.push({ $count: 'total' });
    const totalResult = await Request.aggregate(totalPipeline);
    const total = totalResult[0]?.total || 0;

    // Transform response data (Bark-style)
    const formattedResponses = responses.map(response => ({
      id: response._id,
      requestId: response._id,
      title: response.title || 'Service Request',
      description: response.description.substring(0, 150) + (response.description.length > 150 ? '...' : ''),
      customer: {
        id: response.customer._id,
        name: response.customer.name,
        avatar: response.customer.avatar || response.customer.name.charAt(0).toUpperCase(),
        isVerified: response.customer.isVerified,
        email: response.customer.email,
        phone: response.customer.phone
      },
      category: response.category.name,
      status: response.quote.status,
      submittedAt: response.quote.submittedAt,
      contactedAt: response.quote.contactedAt,
      responseTime: response.quote.contactedAt ? Math.round((new Date(response.quote.contactedAt) - new Date(response.quote.submittedAt)) / 3600000) : null, // Hours
      amount: response.quote.pricing?.amount || 'Not specified',
      message: response.quote.message || 'No message provided'
    }));

    res.json({
      success: true,
      data: {
        responses: formattedResponses,
        stats: {
          totalResponses: total,
          pending: responses.filter(r => r.quote.status === 'pending').length,
          accepted: responses.filter(r => r.quote.status === 'accepted').length,
          rejected: responses.filter(r => r.quote.status === 'rejected').length
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
    logger.error('Get my responses error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get responses',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

router.get('/contact/:leadId/check', protect, requireServiceProvider, async (req, res) => {
  try {
    const { leadId } = req.params;

    const provider = await User.findById(req.user.id).select('credits stats');
    const request = await Request.findById(leadId)
      .populate('customer', 'firstName lastName email phone isVerified')
      .populate('category', 'name slug pricingInfo');

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found'
      });
    }

    // Check if request is still active
    if (!request.isActive()) {
      return res.status(400).json({
        success: false,
        message: 'This lead is no longer active'
      });
    }

    // Check if provider already contacted this lead
    const alreadyContacted = request.analytics?.contactedProviders?.includes(req.user.id);
    if (alreadyContacted) {
      return res.status(400).json({
        success: false,
        message: 'You have already contacted this lead',
        alreadyContacted: true
      });
    }

    // Calculate lead cost
    const leadCost = calculateLeadCost(request, provider);
    const isFree = leadCost <= 3 || request.promotionalLead;

    // Check if provider has enough credits
    const hasEnoughCredits = isFree || provider.credits >= leadCost;

    res.json({
      success: true,
      data: {
        leadId: request._id,
        customer: {
          name: `${request.customer.firstName} ${request.customer.lastName}`,
          isVerified: request.customer.isVerified
        },
        lead: {
          cost: leadCost,
          isFree,
          title: request.title
        },
        provider: {
          currentCredits: provider.credits || 0,
          hasEnoughCredits,
          creditsNeeded: leadCost - (provider.credits || 0)
        },
        pricing: {
          starterPack: {
            credits: 280,
            price: 392.00,
            pricePerCredit: 1.40,
            originalPrice: 490.00,
            discount: 20,
            enoughForLeads: Math.floor(280 / leadCost)
          }
        }
      }
    });

  } catch (error) {
    console.error('Check lead contact error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check lead contact requirements',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Contact a lead (Bark-style lead purchasing)
router.post('/contact/:leadId', protect, requireServiceProvider, [
  body('message').optional().isLength({ max: 1000 }).withMessage('Message cannot exceed 1000 characters'),
  body('phoneNumber').optional().isMobilePhone().withMessage('Please provide a valid phone number'),
  body('useCredits').isBoolean().withMessage('useCredits must be a boolean')
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

    const { leadId } = req.params;
    const { message, phoneNumber, useCredits = true } = req.body;

    const provider = await User.findById(req.user.id).select('credits stats profile');
    const request = await Request.findById(leadId)
      .populate('customer', 'firstName lastName email phone')
      .populate('category', 'name pricingInfo');

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found'
      });
    }

    // Check if request is still active
    if (!request.isActive()) {
      return res.status(400).json({
        success: false,
        message: 'This lead is no longer active'
      });
    }

    // Check if provider already contacted this lead
    const alreadyContacted = request.analytics?.contactedProviders?.includes(req.user.id);
    if (alreadyContacted) {
      return res.status(400).json({
        success: false,
        message: 'You have already contacted this lead'
      });
    }

    // Calculate lead cost
    const leadCost = calculateLeadCost(request, provider);
    const isFree = leadCost <= 3 || request.promotionalLead;

    // Check provider credits for paid leads
    if (!isFree && useCredits) {
      if (provider.credits < leadCost) {
        return res.status(400).json({
          success: false,
          message: `Insufficient credits. You need ${leadCost} credits to contact this lead.`,
          creditsRequired: leadCost,
          currentCredits: provider.credits || 0,
          needToPurchase: true
        });
      }

      // Deduct credits for paid leads
      provider.credits -= leadCost;
    }

    // Record the contact
    request.analytics = request.analytics || {};
    request.analytics.contactedProviders = request.analytics.contactedProviders || [];
    request.analytics.contactedProviders.push(req.user.id);
    request.analytics.contactsInitiated = (request.analytics.contactsInitiated || 0) + 1;

    // Add quote/response to request
    request.quotes = request.quotes || [];
    request.quotes.push({
      provider: req.user.id,
      message: message || `Hi ${request.customer.firstName}, I'm interested in your ${request.category.name} project. I'd love to discuss how I can help you.`,
      contactPhone: phoneNumber || provider.profile?.phone,
      contactedAt: new Date(),
      amount: null // Will be filled later in quote process
    });

    // Update request analytics
    request.analytics.quotesReceived = (request.analytics.quotesReceived || 0) + 1;
    if (!request.analytics.firstResponseTime) {
      request.analytics.firstResponseTime = new Date();
    }

    await request.save();

    // Update provider stats
    provider.stats = provider.stats || {};
    provider.stats.leadsContacted = (provider.stats.leadsContacted || 0) + 1;
    if (!isFree && useCredits) {
      provider.stats.creditsSpent = (provider.stats.creditsSpent || 0) + leadCost;
    }
    await provider.save();

    // TODO: Send notification to customer
    // TODO: Send confirmation email to provider
    // TODO: Log lead purchase for analytics

    res.json({
      success: true,
      message: 'Successfully contacted lead',
      data: {
        leadId: request._id,
        creditsUsed: !isFree && useCredits ? leadCost : 0,
        remainingCredits: provider.credits,
        customerContact: {
          name: `${request.customer.firstName} ${request.customer.lastName}`,
          email: request.customer.email,
          phone: request.customer.phone
        },
        nextSteps: [
          'Customer has been notified of your interest',
          'They will review your message and may contact you directly',
          'Response time is typically within 24 hours',
          'You can send a detailed quote through your dashboard'
        ]
      }
    });

  } catch (error) {
    console.error('Contact lead error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to contact lead',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Bookmark/save a lead
router.post('/bookmark/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    
    const provider = await User.findById(req.user.id);
    provider.bookmarkedLeads = provider.bookmarkedLeads || [];
    
    const isBookmarked = provider.bookmarkedLeads.includes(leadId);
    
    if (isBookmarked) {
      provider.bookmarkedLeads = provider.bookmarkedLeads.filter(id => !id.equals(leadId));
    } else {
      provider.bookmarkedLeads.push(leadId);
    }
    
    await provider.save();
    
    res.json({
      success: true,
      bookmarked: !isBookmarked,
      message: isBookmarked ? 'Lead removed from bookmarks' : 'Lead bookmarked successfully'
    });
    
  } catch (error) {
    logger.error('Bookmark lead error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bookmark lead'
    });
  }
});
router.post('/credits/purchase', protect, requireServiceProvider, [
  body('package').isIn(['starter', 'professional', 'business']).withMessage('Invalid credit package'),
  body('credits').isInt({ min: 1 }).withMessage('Credits must be a positive integer'),
  body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
  body('paymentMethod').optional().isString()
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

    const { package: packageType, credits, amount, paymentMethod } = req.body;
    
    const provider = await User.findById(req.user.id);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    // TODO: Integrate with payment processor (Stripe, PayPal, etc.)
    // For now, we'll simulate a successful payment
    
    // Add credits to provider account
    provider.credits = (provider.credits || 0) + credits;
    
    // Update purchase history
    provider.stats = provider.stats || {};
    provider.stats.totalCreditsPurchased = (provider.stats.totalCreditsPurchased || 0) + credits;
    provider.stats.totalSpent = (provider.stats.totalSpent || 0) + amount;
    
    await provider.save();

    // TODO: Create purchase record in database
    // TODO: Send purchase confirmation email
    // TODO: Log purchase for analytics

    res.json({
      success: true,
      message: 'Credits purchased successfully',
      data: {
        creditsPurchased: credits,
        newCreditBalance: provider.credits,
        amountPaid: amount,
        package: packageType,
        transactionId: `txn_${Date.now()}` // Generate proper transaction ID
      }
    });

  } catch (error) {
    console.error('Purchase credits error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to purchase credits',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get lead analytics/insights
router.get('/insights', async (req, res) => {
  try {
    const provider = await User.findById(req.user.id);
    
    // Get provider's lead interaction history
    const contactedLeads = await Request.find({
      'analytics.contactedProviders': req.user.id
    }).populate('category', 'name');
    
    const totalContacted = contactedLeads.length;
    const totalSpent = provider.stats?.creditsSpent || 0;
    const avgCostPerLead = totalContacted > 0 ? Math.round(totalSpent / totalContacted) : 0;
    
    // Category breakdown
    const categoryStats = {};
    contactedLeads.forEach(lead => {
      const category = lead.category.name;
      if (!categoryStats[category]) {
        categoryStats[category] = { count: 0, spent: 0 };
      }
      categoryStats[category].count++;
    });
    
    // Success metrics (mock data - implement based on your booking/hiring flow)
    const successMetrics = {
      responseRate: Math.round((totalContacted * 0.3) / totalContacted * 100) || 0,
      hireRate: Math.round((totalContacted * 0.15) / totalContacted * 100) || 0,
      avgResponseTime: '2.5 hours'
    };
    
    res.json({
      success: true,
      data: {
        overview: {
          totalLeadsContacted: totalContacted,
          totalCreditsSpent: totalSpent,
          averageCostPerLead: avgCostPerLead,
          currentCredits: provider.credits || 0
        },
        performance: successMetrics,
        categoryBreakdown: Object.entries(categoryStats).map(([name, stats]) => ({
          category: name,
          leadsContacted: stats.count,
          percentage: Math.round((stats.count / totalContacted) * 100) || 0
        })),
        recommendations: [
          'Focus on leads with higher match scores for better success rates',
          'Respond quickly to urgent leads for competitive advantage',
          'Consider purchasing credits in bulk for better value'
        ]
      }
    });
    
  } catch (error) {
    logger.error('Get insights error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get insights'
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