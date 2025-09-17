const express = require('express');
require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Request = require('../models/request');
const CreditTransaction = require('../models/CreditTransaction');
const { protect, requireServiceProvider } = require('../middleware/auth');
const logger = require('../utils/loggerutility');
const router = express.Router();

// Create Stripe customer if not exists
const getOrCreateStripeCustomer = async (user) => {
  if (user.stripeCustomerId) {
    try {
      // Verify the customer still exists in Stripe
      const customer = await stripe.customers.retrieve(user.stripeCustomerId);
      return customer;
    } catch (error) {
      // Customer doesn't exist, create a new one
      logger.warn(`Stripe customer ${user.stripeCustomerId} not found, creating new one`);
    }
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    name: `${user.firstName} ${user.lastName}`,
    email: user.email,
    phone: user.phone || undefined,
    metadata: {
      userId: user._id.toString(),
      userType: user.userType,
      businessName: user.businessName || undefined
    }
  });

  // Save customer ID to user
  user.stripeCustomerId = customer.id;
  await user.save();

  return customer;
};

// Create Payment Intent for credit purchase
router.post('/create-payment-intent', protect, requireServiceProvider, [
  body('package').isIn(['starter', 'professional', 'business']).withMessage('Invalid credit package'),
  body('credits').isInt({ min: 1 }).withMessage('Credits must be a positive integer'),
  body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
  body('currency').isIn(['gbp', 'usd', 'eur']).withMessage('Invalid currency'),
  body('autoTopUp').isBoolean().withMessage('autoTopUp must be a boolean'),
  body('leadId').optional().isMongoId()
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

    const { package: packageType, credits, amount, currency, autoTopUp, leadId } = req.body;
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get or create Stripe customer
    const stripeCustomer = await getOrCreateStripeCustomer(user);

    // Calculate amount in smallest currency unit (pence for GBP)
    const amountInCents = Math.round(amount * 100);

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency.toLowerCase(),
      customer: stripeCustomer.id,
      metadata: {
        userId: user._id.toString(),
        packageType,
        credits: credits.toString(),
        autoTopUp: autoTopUp.toString(),
        leadId: leadId || '',
        purpose: 'credit_purchase'
      },
      description: `${credits} credits - ${packageType} package`,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    // Create setup intent for future payments if autoTopUp is enabled
    let setupIntent = null;
    if (autoTopUp) {
      setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomer.id,
        usage: 'off_session',
        metadata: {
          userId: user._id.toString(),
          purpose: 'auto_topup'
        }
      });
    }

    res.json({
      success: true,
      data: {
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        setupIntentId: setupIntent?.id,
        setupClientSecret: setupIntent?.client_secret,
        stripeCustomerId: stripeCustomer.id,
        amount: amountInCents,
        currency: currency.toLowerCase()
      }
    });

  } catch (error) {
    logger.error('Create payment intent error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment intent',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// SECURE: Confirm payment after Stripe handles card processing
router.post('/confirm-payment', protect, requireServiceProvider, [
  body('paymentIntentId').isString().withMessage('Payment intent ID is required'),
  body('leadId').optional().isMongoId()
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

    const { paymentIntentId, leadId } = req.body;
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Retrieve the payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    // Verify payment belongs to this user
    if (paymentIntent.customer !== user.stripeCustomerId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized payment intent'
      });
    }

    // Check if payment was successful
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({
        success: false,
        message: 'Payment not completed',
        paymentStatus: paymentIntent.status
      });
    }

    // Payment successful - add credits to user account
    const credits = parseInt(paymentIntent.metadata.credits);
    const packageType = paymentIntent.metadata.packageType;
    const autoTopUp = paymentIntent.metadata.autoTopUp === 'true';

    // Update user credits
    user.credits = (user.credits || 0) + credits;
    
    // Update user stats
    user.stats = user.stats || {};
    user.stats.totalCreditsPurchased = (user.stats.totalCreditsPurchased || 0) + credits;
    user.stats.totalSpent = (user.stats.totalSpent || 0) + (paymentIntent.amount / 100);
    
    // Save auto top-up preference if enabled
    if (autoTopUp && paymentIntent.payment_method) {
      user.preferences = user.preferences || {};
      user.preferences.autoTopUp = {
        enabled: true,
        paymentMethodId: paymentIntent.payment_method,
        threshold: 10, // Auto top-up when credits fall below 10
        packageType: packageType
      };
    }

    await user.save();

    // Create credit transaction record
    const creditTransaction = new CreditTransaction({
      user: user._id,
      type: 'purchase',
      amount: credits,
      cost: paymentIntent.amount / 100,
      currency: paymentIntent.currency,
      stripePaymentIntentId: paymentIntent.id,
      stripePaymentMethodId: paymentIntent.payment_method,
      packageType,
      status: 'completed',
      metadata: {
        autoTopUp,
        leadId: leadId || null
      }
    });

    await creditTransaction.save();

    // If leadId is provided, automatically contact the lead
    let contactResult = null;
    if (leadId) {
      try {
        const request = await Request.findById(leadId)
          .populate('customer', 'firstName lastName email phone');

        if (request && request.isActive()) {
          const leadCost = calculateLeadCost(request, user);
          
          // Check if user has enough credits and hasn't already contacted
          const alreadyContacted = request.analytics?.contactedProviders?.includes(user._id);
          
          if (!alreadyContacted && user.credits >= leadCost) {
            // Deduct credits
            user.credits -= leadCost;
            
            // Record the contact
            request.analytics = request.analytics || {};
            request.analytics.contactedProviders = request.analytics.contactedProviders || [];
            request.analytics.contactedProviders.push(user._id);
            request.analytics.contactsInitiated = (request.analytics.contactsInitiated || 0) + 1;

            // Add quote/response to request
            request.quotes = request.quotes || [];
            request.quotes.push({
              provider: user._id,
              message: `Hi ${request.customer.firstName}, I'm interested in your ${request.category?.name || 'project'} project. I'd love to discuss how I can help you.`,
              contactedAt: new Date(),
              amount: null
            });

            request.analytics.quotesReceived = (request.analytics.quotesReceived || 0) + 1;
            if (!request.analytics.firstResponseTime) {
              request.analytics.firstResponseTime = new Date();
            }

            await request.save();
            await user.save();

            // Create credit transaction for lead contact
            const leadTransaction = new CreditTransaction({
              user: user._id,
              type: 'spend',
              amount: -leadCost,
              leadId: request._id,
              status: 'completed',
              metadata: {
                purpose: 'lead_contact',
                customerName: `${request.customer.firstName} ${request.customer.lastName}`
              }
            });

            await leadTransaction.save();

            contactResult = {
              success: true,
              creditsUsed: leadCost,
              customerContact: {
                name: `${request.customer.firstName} ${request.customer.lastName}`,
                email: request.customer.email,
                phone: request.customer.phone
              }
            };

            // Update user stats
            user.stats.leadsContacted = (user.stats.leadsContacted || 0) + 1;
            user.stats.creditsSpent = (user.stats.creditsSpent || 0) + leadCost;
            await user.save();
          }
        }
      } catch (contactError) {
        logger.error('Auto contact lead after payment error:', contactError);
        // Don't fail the payment if lead contact fails
      }
    }

    res.json({
      success: true,
      message: 'Payment processed successfully and credits added',
      data: {
        creditsPurchased: credits,
        newCreditBalance: user.credits,
        amountPaid: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
        packageType,
        transactionId: creditTransaction._id,
        stripePaymentIntentId: paymentIntent.id,
        autoTopUpEnabled: autoTopUp,
        leadContact: contactResult
      }
    });

  } catch (error) {
    logger.error('Confirm payment error:', error);
    
    // Handle specific Stripe errors
    if (error.type === 'StripeCardError') {
      return res.status(400).json({
        success: false,
        message: error.message,
        error: 'card_error'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to process payment',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Payment processing error'
    });
  }
});

// Handle auto top-up for low credits
router.post('/auto-topup', protect, requireServiceProvider, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if auto top-up is enabled and user has low credits
    const autoTopUpSettings = user.preferences?.autoTopUp;
    if (!autoTopUpSettings?.enabled || user.credits > autoTopUpSettings.threshold) {
      return res.status(400).json({
        success: false,
        message: 'Auto top-up not needed'
      });
    }

    // Get pricing for the package
    const packagePricing = {
      starter: { credits: 280, price: 392.00 },
      professional: { credits: 560, price: 700.00 },
      business: { credits: 1120, price: 1200.00 }
    };

    const packageData = packagePricing[autoTopUpSettings.packageType];
    if (!packageData) {
      return res.status(400).json({
        success: false,
        message: 'Invalid package type for auto top-up'
      });
    }

    // Create payment intent for auto top-up
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(packageData.price * 100),
      currency: 'gbp',
      customer: user.stripeCustomerId,
      payment_method: autoTopUpSettings.paymentMethodId,
      confirmation_method: 'automatic',
      confirm: true,
      off_session: true, // This payment is happening off-session
      metadata: {
        userId: user._id.toString(),
        packageType: autoTopUpSettings.packageType,
        credits: packageData.credits.toString(),
        purpose: 'auto_topup'
      },
      description: `Auto top-up: ${packageData.credits} credits`
    });

    if (paymentIntent.status === 'succeeded') {
      // Add credits to user account
      user.credits += packageData.credits;
      user.stats.totalCreditsPurchased = (user.stats.totalCreditsPurchased || 0) + packageData.credits;
      user.stats.totalSpent = (user.stats.totalSpent || 0) + packageData.price;
      await user.save();

      // Create transaction record
      const creditTransaction = new CreditTransaction({
        user: user._id,
        type: 'purchase',
        amount: packageData.credits,
        cost: packageData.price,
        currency: 'gbp',
        stripePaymentIntentId: paymentIntent.id,
        stripePaymentMethodId: autoTopUpSettings.paymentMethodId,
        packageType: autoTopUpSettings.packageType,
        status: 'completed',
        metadata: {
          autoTopUp: true,
          triggered: true
        }
      });

      await creditTransaction.save();

      res.json({
        success: true,
        message: 'Auto top-up completed successfully',
        data: {
          creditsPurchased: packageData.credits,
          newCreditBalance: user.credits,
          amountCharged: packageData.price
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Auto top-up payment failed',
        paymentStatus: paymentIntent.status
      });
    }

  } catch (error) {
    logger.error('Auto top-up error:', error);
    
    // If the payment fails due to authentication required, disable auto top-up
    if (error.code === 'authentication_required') {
      try {
        await User.findByIdAndUpdate(req.user.id, {
          'preferences.autoTopUp.enabled': false
        });
      } catch (updateError) {
        logger.error('Failed to disable auto top-up:', updateError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Auto top-up failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Auto top-up error'
    });
  }
});

// Webhook handler for Stripe events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.error('Webhook signature verification failed:', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object;
        logger.info(`Payment succeeded: ${paymentIntent.id}`);
        
        // Update transaction status if exists
        await CreditTransaction.findOneAndUpdate(
          { stripePaymentIntentId: paymentIntent.id },
          { 
            status: 'completed',
            completedAt: new Date()
          }
        );
        break;

      case 'payment_intent.payment_failed':
        const failedPayment = event.data.object;
        logger.error(`Payment failed: ${failedPayment.id}`);
        
        // Update transaction status
        await CreditTransaction.findOneAndUpdate(
          { stripePaymentIntentId: failedPayment.id },
          { 
            status: 'failed',
            failureReason: failedPayment.last_payment_error?.message
          }
        );
        break;

      case 'customer.subscription.deleted':
        // Handle subscription cancellation if you add subscriptions later
        break;

      default:
        logger.info(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

// Get user's payment methods
router.get('/payment-methods', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.stripeCustomerId) {
      return res.json({
        success: true,
        data: { paymentMethods: [] }
      });
    }

    const paymentMethods = await stripe.paymentMethods.list({
      customer: user.stripeCustomerId,
      type: 'card',
    });

    const formattedMethods = paymentMethods.data.map(pm => ({
      id: pm.id,
      brand: pm.card.brand,
      last4: pm.card.last4,
      expMonth: pm.card.exp_month,
      expYear: pm.card.exp_year,
      isDefault: false // You can implement default payment method logic
    }));

    res.json({
      success: true,
      data: {
        paymentMethods: formattedMethods
      }
    });

  } catch (error) {
    logger.error('Get payment methods error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve payment methods'
    });
  }
});

// Get credit transaction history
router.get('/transactions', protect, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const transactions = await CreditTransaction.find({ user: req.user.id })
      .populate('leadId', 'title category')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await CreditTransaction.countDocuments({ user: req.user.id });

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    logger.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve transactions'
    });
  }
});

// Helper function to calculate lead cost
const calculateLeadCost = (request, provider) => {
  const baseCost = 5;
  let cost = baseCost;

  // Adjust based on budget
  if (request.budget?.amount) {
    if (request.budget.amount > 1000) cost += 5;
    else if (request.budget.amount > 500) cost += 3;
    else if (request.budget.amount > 100) cost += 1;
  }

  // Adjust based on urgency
  if (request.timeline?.urgency === 'urgent') cost += 3;
  else if (request.timeline?.urgency === 'high') cost += 1;

  // Promotional leads are cheaper
  if (request.promotionalLead) cost = Math.max(1, Math.floor(cost * 0.5));

  return Math.max(1, cost);
};

module.exports = router;