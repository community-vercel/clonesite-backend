const logger = require('../utils/loggerutility');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  logger.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userId: req.user ? req.user.id : null
  });

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { message, statusCode: 404 };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    let message = 'Duplicate field value entered';
    
    // Extract field name from error
    const field = Object.keys(err.keyValue)[0];
    if (field) {
      message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`;
    }
    
    error = { message, statusCode: 400 };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = { message, statusCode: 400 };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = { message, statusCode: 401 };
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = { message, statusCode: 401 };
  }

  // Multer errors (handled in upload middleware, but just in case)
  if (err.code === 'LIMIT_FILE_SIZE') {
    const message = 'File size too large';
    error = { message, statusCode: 400 };
  }

  // MongoDB connection errors
  if (err.name === 'MongoNetworkError') {
    const message = 'Database connection failed';
    error = { message, statusCode: 500 };
  }

  // Rate limit errors
  if (err.status === 429) {
    const message = 'Too many requests, please try again later';
    error = { message, statusCode: 429 };
  }

  // Stripe errors
  if (err.type === 'StripeCardError') {
    const message = err.message || 'Payment failed';
    error = { message, statusCode: 400 };
  }

  if (err.type === 'StripeRateLimitError') {
    const message = 'Too many requests made to the API too quickly';
    error = { message, statusCode: 429 };
  }

  if (err.type === 'StripeInvalidRequestError') {
    const message = 'Invalid parameters were supplied';
    error = { message, statusCode: 400 };
  }

  if (err.type === 'StripeAPIError') {
    const message = 'An error occurred with our API';
    error = { message, statusCode: 500 };
  }

  if (err.type === 'StripeConnectionError') {
    const message = 'A network error occurred';
    error = { message, statusCode: 500 };
  }

  if (err.type === 'StripeAuthenticationError') {
    const message = 'Authentication with payment provider failed';
    error = { message, statusCode: 401 };
  }

  // Default to 500 server error
  const statusCode = error.statusCode || 500;
  const message = error.message || 'Internal Server Error';

  // Send error response
  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && {
      error: err.message,
      stack: err.stack,
      details: error
    })
  });
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  logger.error('Unhandled Promise Rejection:', {
    message: err.message,
    stack: err.stack
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', {
    message: err.message,
    stack: err.stack
  });
  
  // Close server & exit process
  process.exit(1);
});

module.exports = errorHandler;