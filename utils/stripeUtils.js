// utils/stripeUtils.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User = require('../models/User');
const CreditTransaction = require('../models/CreditTransaction');
const logger = require('./logger');

// Package pricing configuration
const PACKAGE_PRICING = {
  starter: {
    credits: 280,
    price: 392.00, // £392.00 inc VAT
    originalPrice: 490.00,
    pricePerCredit: 1.40,
    enoughForLeads: 10 // approximate
  },
  professional: {
    credits: 560,
    price: 700.00,
    originalPrice: 875.00,
    pricePerCredit: 1.25,
    enoughForLeads: 20
  },
  business: {
    credits: 1120,
    price: 1200.00,
    originalPrice: 1500.00,
    pricePerCredit: 1.07,
    enoughForLeads: 40
  }
};

/**
 * Calculate lead cost based on various factors (same as Bark.com)
 */
const calculateLeadCost = (request, provider) => {
  let baseCost = 5;
  let cost = baseCost;

  // Adjust based on budget
  if (request.budget?.amount) {
    if (request.budget.amount >= 2000) cost += 8;
    else if (request.budget.amount >= 1000) cost += 5;
    else if (request.budget.amount >= 500) cost += 3;
    else if (request.budget.amount >= 200) cost += 2;
    else if (request.budget.amount >= 100) cost += 1;
  }

  // Adjust based on urgency
  switch (request.timeline?.urgency) {
    case 'urgent':
      cost += 4;
      break;
    case 'high':
      cost += 2;
      break;
    case 'medium':
      cost += 1;
      break;
    default:
      break;
  }

  // Adjust based on category complexity
  const complexCategories = ['legal', 'financial', 'medical', 'engineering'];
  if (complexCategories.includes(request.category?.slug)) {
    cost += 3;
  }

  // Location premium for major cities
  const premiumCities = ['london', 'manchester', 'birmingham', 'leeds', 'glasgow'];
  if (premiumCities.includes(request.location?.city?.toLowerCase())) {
    cost += 2;
  }

  // Discount for new providers (first 5 leads)
  if (provider.stats?.leadsContacted < 5) {
    cost = Math.max(1, Math.floor(cost * 0.7));
  }

  // Promotional leads are cheaper
  if (request.promotionalLead) {
    cost = Math.max(1, Math.floor(cost * 0.5));
  }

  // Ensure minimum and maximum bounds
  return Math.max(1, Math.min(cost, 20));
};

/**
 * Calculate match score for lead recommendations
 */
const calculateMatchScore = (request, provider) => {
  let score = 0;

  // Category match (40 points max)
  if (provider.categories?.some(cat => cat._id.equals(request.category))) {
    score += 40;
  }

  // Location proximity (25 points max)
  if (request.location?.coordinates && provider.location?.coordinates) {
    const distance = calculateDistance(
      request.location.coordinates,
      provider.location.coordinates
    );
    if (distance <= 10) score += 25;
    else if (distance <= 25) score += 20;
    else if (distance <= 50) score += 15;
    else if (distance <= 100) score += 10;
  } else if (provider.isNationwide) {
    score += 15; // Partial points for nationwide coverage
  }

  // Budget compatibility (20 points max)
  if (request.budget?.amount && provider.hourlyRate?.min) {
    const budgetPerHour = request.budget.amount / (request.timeline?.estimatedHours || 10);
    if (budgetPerHour >= provider.hourlyRate.min) {
      score += 20;
    } else if (budgetPerHour >= provider.hourlyRate.min * 0.8) {
      score += 15;
    }
  } else {
    score += 10; // Default when budget not specified
  }

  // Provider quality (15 points max)
  if (provider.rating?.average >= 4.5 && provider.rating.count >= 10) {
    score += 15;
  } else if (provider.rating?.average >= 4.0) {
    score += 10;
  } else if (provider.rating?.average >= 3.5) {
    score += 5;
  }

  // Experience bonus (10 points max)
  if (provider.experience >= 10) score += 10;
  else if (provider.experience >= 5) score += 7;
  else if (provider.experience >= 2) score += 5;

  // Verification bonus (10 points max)
  if (provider.isVerified) score += 5;
  if (provider.backgroundCheckVerified) score += 3;
  if (provider.emailVerified) score += 2;

  // Response time bonus (5 points max)
  if (provider.responseTime?.average <= 2) score += 5;
  else if (provider.responseTime?.average <= 6) score += 3;
  else if (provider.responseTime?.average <= 24) score += 1;

  return Math.min(100, Math.max(0, score));
};

/**
 * Calculate distance between two coordinates
 */
const calculateDistance = (coords1, coords2) => {
  const earthRadius = 6371; // km
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;
  
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return earthRadius * c;
};

/**
 * Process auto top-up for a user
 */
const processAutoTopUp = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user || !user.shouldAutoTopUp()) {
      return { success: false, reason: 'Auto top-up not needed' };
    }

    const autoTopUpSettings = user.preferences.autoTopUp;
    const packageData = PACKAGE_PRICING[autoTopUpSettings.packageType];

    if (!packageData) {
      logger.error(`Invalid package type for auto top-up: ${autoTopUpSettings.packageType}`);
      return { success: false, reason: 'Invalid package type' };
    }

    // Create payment intent for auto top-up
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(packageData.price * 100), // Convert to pence
      currency: 'gbp',
      customer: user.stripeCustomerId,
      payment_method: autoTopUpSettings.paymentMethodId,
      confirmation_method: 'automatic',
      confirm: true,
      off_session: true, // This indicates the payment is happening without user presence
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
      await user.addCredits(packageData.credits, {
        type: 'purchase',
        cost: packageData.price,
        currency: 'gbp',
        stripePaymentIntentId: paymentIntent.id,
        stripePaymentMethodId: autoTopUpSettings.paymentMethodId,
        packageType: autoTopUpSettings.packageType,
        metadata: {
          autoTopUp: true,
          triggered: true
        }
      });

      logger.info(`Auto top-up successful for user ${userId}: ${packageData.credits} credits`);
      return {
        success: true,
        creditsPurchased: packageData.credits,
        amountCharged: packageData.price,
        newBalance: user.credits + packageData.credits
      };
    } else {
      logger.error(`Auto top-up payment failed for user ${userId}: ${paymentIntent.status}`);
      return { success: false, reason: 'Payment failed', status: paymentIntent.status };
    }

  } catch (error) {
    logger.error('Auto top-up processing error:', error);

    // If the payment fails due to authentication required, disable auto top-up
    if (error.code === 'authentication_required') {
      try {
        await User.findByIdAndUpdate(userId, {
          'preferences.autoTopUp.enabled': false
        });
        logger.info(`Disabled auto top-up for user ${userId} due to authentication required`);
      } catch (updateError) {
        logger.error('Failed to disable auto top-up:', updateError);
      }
    }

    return { 
      success: false, 
      reason: error.message,
      shouldDisableAutoTopUp: error.code === 'authentication_required'
    };
  }
};

/**
 * Background service to check and process auto top-ups
 */
const checkAndProcessAutoTopUps = async () => {
  try {
    const usersNeedingTopUp = await User.findUsersNeedingAutoTopUp();
    
    if (usersNeedingTopUp.length === 0) {
      return { processed: 0, message: 'No users need auto top-up' };
    }

    logger.info(`Found ${usersNeedingTopUp.length} users needing auto top-up`);

    const results = await Promise.allSettled(
      usersNeedingTopUp.map(user => processAutoTopUp(user._id))
    );

    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - successful;

    logger.info(`Auto top-up batch completed: ${successful} successful, ${failed} failed`);

    return {
      processed: results.length,
      successful,
      failed,
      message: `Processed ${results.length} auto top-ups`
    };

  } catch (error) {
    logger.error('Batch auto top-up processing error:', error);
    throw error;
  }
};

/**
 * Validate Stripe webhook signature
 */
const validateWebhookSignature = (payload, signature, secret) => {
  try {
    return stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    logger.error('Webhook signature validation failed:', error);
    throw new Error('Invalid webhook signature');
  }
};

/**
 * Handle successful payment webhook
 */
const handlePaymentSuccess = async (paymentIntent) => {
  try {
    const transaction = await CreditTransaction.findOne({
      stripePaymentIntentId: paymentIntent.id
    });

    if (transaction) {
      transaction.status = 'completed';
      transaction.completedAt = new Date();
      await transaction.save();

      logger.info(`Payment completed: ${paymentIntent.id} for ${paymentIntent.metadata.credits} credits`);
    }

    // If this was an auto top-up, log it
    if (paymentIntent.metadata.purpose === 'auto_topup') {
      logger.info(`Auto top-up completed for user ${paymentIntent.metadata.userId}: ${paymentIntent.metadata.credits} credits`);
    }

  } catch (error) {
    logger.error('Error handling payment success webhook:', error);
  }
};

/**
 * Handle failed payment webhook
 */
const handlePaymentFailure = async (paymentIntent) => {
  try {
    const transaction = await CreditTransaction.findOne({
      stripePaymentIntentId: paymentIntent.id
    });

    if (transaction) {
      transaction.status = 'failed';
      transaction.failureReason = paymentIntent.last_payment_error?.message;
      await transaction.save();
    }

    // If this was an auto top-up that failed, disable it
    if (paymentIntent.metadata.purpose === 'auto_topup') {
      await User.findByIdAndUpdate(paymentIntent.metadata.userId, {
        'preferences.autoTopUp.enabled': false
      });
      logger.warn(`Disabled auto top-up for user ${paymentIntent.metadata.userId} due to payment failure`);
    }

    logger.error(`Payment failed: ${paymentIntent.id} - ${paymentIntent.last_payment_error?.message}`);

  } catch (error) {
    logger.error('Error handling payment failure webhook:', error);
  }
};

/**
 * Get package pricing
 */
const getPackagePricing = (packageType = null) => {
  if (packageType) {
    return PACKAGE_PRICING[packageType] || null;
  }
  return PACKAGE_PRICING;
};

/**
 * Format currency amount
 */
const formatCurrency = (amount, currency = 'GBP') => {
  const formatter = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2
  });
  return formatter.format(amount);
};

module.exports = {
  calculateLeadCost,
  calculateMatchScore,
  calculateDistance,
  processAutoTopUp,
  checkAndProcessAutoTopUps,
  validateWebhookSignature,
  handlePaymentSuccess,
  handlePaymentFailure,
  getPackagePricing,
  formatCurrency,
  PACKAGE_PRICING
};