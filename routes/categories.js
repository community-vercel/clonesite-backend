const express = require('express');
const Category=require('../models/Category')

const logger = require('../utils/loggerutility');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const categories = await Category.find().select('name _id');
    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    logger.error('Fetch categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
});
module.exports = router;
