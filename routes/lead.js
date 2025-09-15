const express = require('express');
const { query, validationResult } = require('express-validator');
const User = require('../models/User');
const Service = require('../models/Service');
const Request = require('../models/request');
const { protect, requireCustomer } = require('../middleware/auth');
const logger = require('../utils/loggerutility');

const router = express.Router();

// @desc    Get leads/service providers for a specific request
// @route   GET /api/leads/:requestId
// @access  Private (Request owner only)
router.get('/:requestId', protect, requireCustomer, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('sortBy').optional().isIn(['rating', 'distance', 'experience', 'price'])
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

    const { page = 1, limit = 20, sortBy = 'rating' } = req.query;

    // Get the request to verify ownership and get details
    const request = await Request.findById(req.params.requestId)
      .populate('category', 'name slug');

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    // Check if user owns the request
    if (request.customer.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view these leads'
      });
    }

    // Build query for finding matching service providers
    let matchQuery = {
      userType: { $in: ['service_provider', 'both'] },
      isActive: true,
      isVerified: true, // Only show verified providers
      categories: request.category._id
    };

    // Location-based filtering (within 50km of request location)
    if (request.location && request.location.coordinates) {
      matchQuery.location = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: request.location.coordinates
          },
          $maxDistance: 50000 // 50km radius
        }
      };
    }

    // Exclude providers who already submitted quotes
    if (request.quotes && request.quotes.length > 0) {
      const quotedProviders = request.quotes.map(quote => quote.provider);
      matchQuery._id = { $nin: quotedProviders };
    }

    // Build sort criteria
    let sort = {};
    switch (sortBy) {
      case 'rating':
        sort = { 'rating.average': -1, 'rating.count': -1 };
        break;
      case 'experience':
        sort = { totalJobs: -1, createdAt: 1 };
        break;
      case 'price':
        // This would need to be based on their service pricing
        sort = { 'rating.average': -1 };
        break;
      default:
        sort = { 'rating.average': -1, totalJobs: -1 };
    }

    const skip = (page - 1) * limit;

    // Find matching service providers
    const providers = await User.find(matchQuery)
      .select('firstName lastName businessName avatar rating isVerified totalJobs location address categories portfolioImages description specializations serviceAreas pricing')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // Get their services for additional context
    const providerIds = providers.map(p => p._id);
    const services = await Service.find({
      provider: { $in: providerIds },
      category: request.category._id,
      isActive: true,
      isPaused: false
    }).select('provider title description pricing images rating');

    // Group services by provider
    const servicesByProvider = {};
    services.forEach(service => {
      const providerId = service.provider.toString();
      if (!servicesByProvider[providerId]) {
        servicesByProvider[providerId] = [];
      }
      servicesByProvider[providerId].push(service);
    });

    // Build leads response with provider and their relevant services
    const leads = providers.map(provider => {
      const providerServices = servicesByProvider[provider._id.toString()] || [];
      const mainService = providerServices[0]; // Get primary service for this category

      return {
        _id: provider._id,
        provider: {
          _id: provider._id,
          firstName: provider.firstName,
          lastName: provider.lastName,
          businessName: provider.businessName,
          avatar: provider.avatar,
          rating: provider.rating,
          isVerified: provider.isVerified,
          totalJobs: provider.totalJobs,
          description: provider.description,
          specializations: provider.specializations,
          location: provider.location
        },
        service: mainService ? {
          _id: mainService._id,
          title: mainService.title,
          description: mainService.description,
          pricing: mainService.pricing,
          images: mainService.images,
          rating: mainService.rating
        } : null,
        serviceAreas: provider.serviceAreas,
        // Create a brief description for this lead
        shortDescription: mainService ? 
          mainService.description.substring(0, 150) + '...' : 
          provider.description ? provider.description.substring(0, 150) + '...' : 
          `Experienced ${request.category.name} professional with ${provider.totalJobs || 0} completed jobs.`,
        matchScore: calculateMatchScore(provider, request), // Custom scoring function
        distance: request.location ? calculateDistance(
          request.location.coordinates,
          provider.location ? provider.location.coordinates : null
        ) : null
      };
    });

    // Sort by match score if not sorting by other criteria
    if (sortBy === 'rating') {
      leads.sort((a, b) => b.matchScore - a.matchScore);
    }

    const total = await User.countDocuments(matchQuery);

    res.json({
      success: true,
      data: {
        leads,
        request: {
          _id: request._id,
          title: request.title,
          description: request.description,
          location: request.location,
          category: request.category,
          budget: request.budget,
          timeline: request.timeline,
          createdAt: request.createdAt
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
    logger.error('Get leads error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get leads',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Helper function to calculate match score based on various factors
function calculateMatchScore(provider, request) {
  let score = 0;

  // Rating weight (40%)
  if (provider.rating && provider.rating.average) {
    score += (provider.rating.average / 5) * 40;
  }

  // Experience weight (30%)
  const jobCount = provider.totalJobs || 0;
  if (jobCount > 0) {
    score += Math.min((jobCount / 50) * 30, 30); // Cap at 50 jobs for full points
  }

  // Verification bonus (20%)
  if (provider.isVerified) {
    score += 20;
  }

  // Location proximity bonus (10%)
  // This would require implementing distance calculation
  score += 10; // Default bonus for now

  return Math.round(score);
}

// Helper function to calculate distance between two coordinates
function calculateDistance(coords1, coords2) {
  if (!coords1 || !coords2) return null;

  const [lng1, lat1] = coords1;
  const [lng2, lat2] = coords2;

  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;

  return Math.round(distance * 10) / 10; // Round to 1 decimal place
}

// @desc    Contact a provider from leads
// @route   POST /api/leads/:requestId/contact/:providerId
// @access  Private (Request owner only)
router.post('/:requestId/contact/:providerId', protect, requireCustomer, async (req, res) => {
  try {
    const request = await Request.findById(req.params.requestId);
    
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    // Check if user owns the request
    if (request.customer.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    const provider = await User.findById(req.params.providerId);
    
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    // Create a conversation or send notification to provider
    // You can implement your messaging system here
    
    // For now, we'll just track the interaction
    await Request.findByIdAndUpdate(req.params.requestId, {
      $inc: { 'analytics.contactsInitiated': 1 },
      $addToSet: { 'analytics.contactedProviders': req.params.providerId }
    });

    res.json({
      success: true,
      message: 'Provider contacted successfully',
      data: {
        providerId: provider._id,
        providerName: provider.businessName || `${provider.firstName} ${provider.lastName}`
      }
    });

  } catch (error) {
    logger.error('Contact provider error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to contact provider',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;