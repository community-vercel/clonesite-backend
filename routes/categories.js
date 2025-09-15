const express = require('express');
const Category=require('../models/Category')

const logger = require('../utils/loggerutility');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const categories = await Category.find().select('name _id slug icon');
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
router.get('/:slug/questions', async (req, res) => {
  try {
    const category = await Category.findOne({ slug: req.params.slug }).select('name slug customFields');
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const subCategories = await Category.find({ parent: category._id, isActive: true })
      .select('name slug customFields');

    res.json({
      success: true,
      data: {
        category,
        subCategories
      }
    });
  } catch (error) {
    logger.error('Get category questions error:', error);
    res.status(500).json({ success: false, message: 'Failed to get category questions' });
  }
});

module.exports = router;
