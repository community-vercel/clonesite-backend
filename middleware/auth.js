const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/loggerutility');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Not authorized, user not found'
        });
      }
      if (!req.user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Account is deactivated'
        });
      }

      next();
    } catch (error) {
      logger.error('Auth middleware error:', error);
      
      let message = 'Not authorizedss, token failed';
      if (error.name === 'TokenExpiredError') {
        message = 'Not authorized, token expired';
      } else if (error.name === 'JsonWebTokenError') {
        message = 'Not authorized, invalid token';
      }

      return res.status(401).json({
        success: false,
        message
      });
    }
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token provided'
    });
  }
};

// Grant access to specific roles
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.userType)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.userType} is not authorized to access this route`
      });
    }
    next();
  };
};

const optionalAuth = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    } catch (error) {
      req.user = null;
    }
  }

  next();
};

const requireVerification = (req, res, next) => {
  if (!req.user.emailVerified) {
    return res.status(403).json({
      success: false,
      message: 'Please verify your email address to access this resource'
    });
  }
  next();
};

const requireServiceProvider = (req, res, next) => {
  if (req.user.userType !== 'service_provider' && req.user.userType !== 'both') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Service provider account required.'
    });
  }
  next();
};

const requireCustomer = (req, res, next) => {
  if (req.user.userType !== 'customer' && req.user.userType !== 'both') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Customer account required.'
    });
  }
  next();
};

const requireOwnership = (Model, paramName = 'id', foreignKey = 'user') => {
  return async (req, res, next) => {
    try {
      const resource = await Model.findById(req.params[paramName]);
      
      if (!resource) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found'
        });
      }

      // Check ownership
      if (resource[foreignKey].toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to access this resource'
        });
      }

      req.resource = resource;
      next();
    } catch (error) {
      logger.error('Ownership check error:', error);
      res.status(500).json({
        success: false,
        message: 'Authorization check failed'
      });
    }
  };
};

const requireAdmin = (req, res, next) => {
  if (req.user.userType !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }
  next();
};

module.exports = {
  protect,
  authorize,
  optionalAuth,
  requireVerification,
  requireServiceProvider,
  requireCustomer,
  requireOwnership,
  requireAdmin
};