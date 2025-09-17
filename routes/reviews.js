const express = require('express');
const { body, validationResult } = require('express-validator');
const logger = require('../utils/loggerutility');
const { protect } = require('../middleware/auth');
const Review = require('../models/Review');
const User = require('../models/User');

const router = express.Router();

// @desc    Get reviews for the authenticated service provider
// @route   GET /api/reviews
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const reviews = await Review.find({ serviceProvider: req.user.id, status: 'approved' })
      .select('rating comment title customer aspects createdAt reviewAge')
      .populate('customer', 'firstName lastName avatar')
      .lean();

    res.json({
      success: true,
      data: reviews,
    });
  } catch (error) {
    logger.error('Get reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  }
});

// @desc    Add a response to a review
// @route   PUT /api/reviews/:id/response
// @access  Private
router.put(
  '/:id/response',
  protect,
  [
    body('comment').optional().isLength({ max: 1000 }).withMessage('Response cannot exceed 1000 characters'),
    body('isPublic').optional().isBoolean().withMessage('isPublic must be a boolean'),
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

      const { comment, isPublic } = req.body;
      const review = await Review.findOne({ _id: req.params.id, serviceProvider: req.user.id });

      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found or unauthorized',
        });
      }

      review.response = {
        comment: comment || review.response?.comment,
        respondedAt: new Date(),
        isPublic: isPublic !== undefined ? isPublic : review.response?.isPublic || true,
      };

      await review.save();

      res.json({
        success: true,
        message: 'Response added successfully',
        data: { response: review.response },
      });
    } catch (error) {
      logger.error('Add response error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add response',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      });
    }
  }
);

module.exports = router;