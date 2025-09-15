import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

import User from './models/User.js';
import Service from './models/Service.js';
import Category from './models/Category.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
await mongoose.connect('mongodb+srv://support_db_user:ebb1e2INtiCJZhgr@servicecluster.ywmc0mm.mongodb.net/?retryWrites=true&w=majority&appName=Servicecluster'); // e.g., mongodb://127.0.0.1:27017/bark-clone

// Sample locations in the US for realistic coordinates
const locations = [
  // US Cities
  { city: 'New York', coordinates: [-74.0060, 40.7128], zipCode: '10001' },
  { city: 'Los Angeles', coordinates: [-118.2437, 34.0522], zipCode: '90001' },
  { city: 'Chicago', coordinates: [-87.6298, 41.8781], zipCode: '60601' },
  { city: 'Houston', coordinates: [-95.3698, 29.7604], zipCode: '77002' },
  { city: 'Miami', coordinates: [-80.1918, 25.7617], zipCode: '33101' },

  // UK Cities
  { city: 'London', coordinates: [-0.1276, 51.5072], zipCode: 'SW1A 1AA' },
  { city: 'Manchester', coordinates: [-2.2426, 53.4808], zipCode: 'M1 1AE' },
  { city: 'Birmingham', coordinates: [-1.8986, 52.4895], zipCode: 'B1 1AA' },
  { city: 'Glasgow', coordinates: [-4.2518, 55.8642], zipCode: 'G1 1AA' },

  // Pakistan Cities
  { city: 'Islamabad', coordinates: [73.0551, 33.6844], zipCode: '44000' },
  { city: 'Lahore', coordinates: [74.3587, 31.5204], zipCode: '54000' },
  { city: 'Karachi', coordinates: [67.0099, 24.8615], zipCode: '74000' }
];

// Categories from the provided data
const categories = [
  { name: 'House Cleaning', _id: '68c0775b703783641b907a2b', slug: 'house-cleaning' },
  { name: 'Life Coaching', _id: '68c0775b703783641b907a31', slug: 'life-coaching' },
  { name: 'Bookkeeping Services', _id: '68c0775b703783641b907a32', slug: 'bookkeeping-services' },
  { name: 'General Builders', _id: '68c0775b703783641b907a2c', slug: 'general-builders' },
  { name: 'Web Design', _id: '68c0775b703783641b907a2d', slug: 'web-design' },
  { name: 'General Photography', _id: '68c0775b703783641b907a2e', slug: 'general-photography' },
  { name: 'Web Development', _id: '68c0775b703783641b907a2f', slug: 'web-development' },
  { name: 'Social Media Marketing', _id: '68c0775b703783641b907a34', slug: 'social-media-marketing' },
  { name: 'Gardening', _id: '68c0775b703783641b907a30', slug: 'gardening' },
  { name: 'Graphic Design', _id: '68c0775b703783641b907a35', slug: 'graphic-design' },
  { name: 'Office Cleaning', _id: '68c0775b703783641b907a33', slug: 'office-cleaning' },
  { name: 'Personal Trainers', _id: '68c0775b703783641b907a36', slug: 'personal-trainers' },
];

// Sample service data template with real images and videos
const serviceTemplates = {
  'House Cleaning': {
    title: 'Professional House Cleaning',
    description: 'Deep cleaning services for homes, including dusting, vacuuming, and sanitizing.',
    shortDescription: 'Spotless home cleaning by experts.',
    pricing: { type: 'hourly', amount: { min: 30, max: 50 }, currency: 'USD', unit: 'per hour' },
    features: ['Deep cleaning', 'Eco-friendly products', 'Flexible scheduling'],
    whatsIncluded: ['Kitchen cleaning', 'Bathroom sanitizing', 'Floor mopping'],
    requirements: ['Access to water and electricity', 'No pets in work areas'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1588197079701-0d049f8f6bd3?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80',
        caption: 'House Cleaning service',
        isPrimary: true,
      },
    ],
    videos: [  // Optional: Add if your schema supports videos
      {
        url: 'https://player.vimeo.com/external/407574195.sd.mp4?s=token&download_token=example',  // Direct MP4 from Pexels/Coverr (replace with actual download if needed)
        caption: 'House cleaning process demo',
      },
    ],
  },
  'Life Coaching': {
    title: 'Personal Life Coaching',
    description: 'One-on-one coaching to help you achieve personal and professional goals.',
    shortDescription: 'Transform your life with expert coaching.',
    pricing: { type: 'per_project', amount: { min: 100, max: 300 }, currency: 'USD' },
    features: ['Goal setting', 'Mindset coaching', 'Weekly sessions'],
    whatsIncluded: ['1-hour sessions', 'Personalized plan', 'Email support'],
    requirements: ['Commitment to weekly sessions'],
    images: [
      {
        url: 'https://images.pexels.com/photos/3184291/pexels-photo-3184291.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
        caption: 'Life Coaching session',
        isPrimary: true,
      },
    ],
    videos: [
      {
        url: 'https://videos.pexels.com/video-files/854158/854158-hd_1280_720_30fps.mp4',  // Example Pexels direct link
        caption: 'Life coaching consultation',
      },
    ],
  },
  'Bookkeeping Services': {
    title: 'Professional Bookkeeping',
    description: 'Accurate financial record-keeping for small businesses.',
    shortDescription: 'Keep your finances in order.',
    pricing: { type: 'fixed', amount: { min: 200, max: 500 }, currency: 'USD' },
    features: ['Monthly reports', 'Tax preparation', 'QuickBooks integration'],
    whatsIncluded: ['Ledger maintenance', 'Financial statements', 'Reconciliations'],
    requirements: ['Access to financial records'],
    images: [
      {
        url: 'https://images.pexels.com/photos/669615/pexels-photo-669615.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
        caption: 'Bookkeeping services',
        isPrimary: true,
      },
    ],
    videos: [
      {
        url: 'https://videos.pexels.com/video-files/3194398/3194398-hd_1280_720_30fps.mp4',
        caption: 'Bookkeeping workflow',
      },
    ],
  },
  'General Builders': {
    title: 'Home Renovation and Building',
    description: 'Full-service building and renovation for residential properties.',
    shortDescription: 'Quality home renovations.',
    pricing: { type: 'per_project', amount: { min: 1000, max: 5000 }, currency: 'USD' },
    features: ['Custom designs', 'Quality materials', 'Licensed contractors'],
    whatsIncluded: ['Construction', 'Project management', 'Permits'],
    requirements: ['Approved blueprints', 'Site access'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80',
        caption: 'General Builders construction',
        isPrimary: true,
      },
    ],
    videos: [
      {
        url: 'https://videos.pexels.com/video-files/854022/854022-hd_1280_720_30fps.mp4',
        caption: 'Construction site timelapse',
      },
    ],
  },
  'Web Design': {
    title: 'Responsive Web Design',
    description: 'Creative and responsive website designs for businesses.',
    shortDescription: 'Stunning websites for your brand.',
    pricing: { type: 'per_project', amount: { min: 500, max: 2000 }, currency: 'USD' },
    features: ['Responsive design', 'SEO optimization', 'Custom graphics'],
    whatsIncluded: ['Homepage design', 'Up to 5 pages', 'CMS integration'],
    requirements: ['Content provided by client'],
    images: [
      {
        url: 'https://images.pexels.com/photos/3183150/pexels-photo-3183150.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
        caption: 'Web Design process',
        isPrimary: true,
      },
    ],
    videos: [
      {
        url: 'https://videos.pexels.com/video-files/3192200/3192200-hd_1280_720_30fps.mp4',
        caption: 'Web design animation',
      },
    ],
  },
  'General Photography': {
    title: 'Event Photography',
    description: 'Professional photography for events, portraits, and more.',
    shortDescription: 'Capture your moments beautifully.',
    pricing: { type: 'per_project', amount: { min: 200, max: 800 }, currency: 'USD' },
    features: ['High-resolution images', 'Photo editing', 'Online gallery'],
    whatsIncluded: ['2-hour session', '50 edited photos', 'Digital delivery'],
    requirements: ['Event details and schedule'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80',
        caption: 'General Photography session',
        isPrimary: true,
      },
    ],
    videos: [
      {
        url: 'https://videos.pexels.com/video-files/3195589/3195589-hd_1280_720_30fps.mp4',
        caption: 'Photography shoot demo',
      },
    ],
  },
  'Web Development': {
    title: 'Full-Stack Web Development',
    description: 'Custom web applications and dynamic websites.',
    shortDescription: 'Scalable web solutions.',
    pricing: { type: 'per_project', amount: { min: 1000, max: 3000 }, currency: 'USD' },
    features: ['Custom coding', 'Database integration', 'API development'],
    whatsIncluded: ['Frontend & backend', 'Testing', 'Deployment'],
    requirements: ['Project specifications'],
    images: [
      {
        url: 'https://images.pexels.com/photos/1181244/pexels-photo-1181244.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
        caption: 'Web Development coding',
        isPrimary: true,
      },
    ],
    videos: [
      {
        url: 'https://videos.pexels.com/video-files/854175/854175-hd_1280_720_30fps.mp4',
        caption: 'Coding development process',
      },
    ],
  },
  'Social Media Marketing': {
    title: 'Social Media Growth Strategy',
    description: 'Boost your brand with targeted social media campaigns.',
    shortDescription: 'Grow your online presence.',
    pricing: { type: 'fixed', amount: { min: 300, max: 1000 }, currency: 'USD' },
    features: ['Content creation', 'Ad management', 'Analytics reports'],
    whatsIncluded: ['5 posts/week', 'Monthly report', 'Campaign setup'],
    requirements: ['Access to social media accounts'],
    images: [
      {
        url: 'https://images.pexels.com/photos/3183152/pexels-photo-3183152.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
        caption: 'Social Media Marketing',
        isPrimary: true,
      },
    ],
    videos: [
      {
        url: 'https://videos.pexels.com/video-files/3192210/3192210-hd_1280_720_30fps.mp4',
        caption: 'Social media strategy demo',
      },
    ],
  },
  'Gardening': {
    title: 'Garden Design and Maintenance',
    description: 'Transform your outdoor space with professional landscaping.',
    shortDescription: 'Beautiful gardens, expertly maintained.',
    pricing: { type: 'per_project', amount: { min: 500, max: 2000 }, currency: 'USD' },
    features: ['Landscape design', 'Planting', 'Regular maintenance'],
    whatsIncluded: ['Garden planning', 'Plant selection', 'Installation'],
    requirements: ['Access to garden area'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80',
        caption: 'Gardening landscaping',
        isPrimary: true,
      },
    ],
    videos: [
      {
        url: 'https://videos.pexels.com/video-files/854139/854139-hd_1280_720_30fps.mp4',
        caption: 'Gardening maintenance clip',
      },
    ],
  },
  'Graphic Design': {
    title: 'Custom Graphic Design',
    description: 'High-quality designs for logos, branding, and marketing materials.',
    shortDescription: 'Creative designs for your brand.',
    pricing: { type: 'per_project', amount: { min: 200, max: 1000 }, currency: 'USD' },
    features: ['Custom logos', 'Brand guidelines', 'Digital assets'],
    whatsIncluded: ['3 design concepts', '2 revisions', 'Final files'],
    requirements: ['Brand guidelines or preferences'],
    images: [
      {
        url: 'https://images.pexels.com/photos/3183186/pexels-photo-3183186.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
        caption: 'Graphic Design work',
        isPrimary: true,
      },
    ],
    videos: [
      {
        url: 'https://videos.pexels.com/video-files/3192205/3192205-hd_1280_720_30fps.mp4',
        caption: 'Graphic design process',
      },
    ],
  },
  'Office Cleaning': {
    title: 'Commercial Office Cleaning',
    description: 'Professional cleaning for offices and commercial spaces.',
    shortDescription: 'Clean and professional workspaces.',
    pricing: { type: 'hourly', amount: { min: 35, max: 60 }, currency: 'USD', unit: 'per hour' },
    features: ['Deep cleaning', 'Sanitization', 'Flexible scheduling'],
    whatsIncluded: ['Desk cleaning', 'Floor care', 'Restroom cleaning'],
    requirements: ['Access to office space'],
    images: [
      {
        url: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80',
        caption: 'Office Cleaning service',
        isPrimary: true,
      },
    ],
    videos: [
      {
        url: 'https://videos.pexels.com/video-files/854158/854158-hd_1280_720_30fps.mp4',
        caption: 'Office cleaning demo',
      },
    ],
  },
  'Personal Trainers': {
    title: 'Personal Fitness Training',
    description: 'Customized fitness programs to achieve your health goals.',
    shortDescription: 'Get fit with personalized training.',
    pricing: { type: 'per_project', amount: { min: 50, max: 150 }, currency: 'USD' },
    features: ['Custom workouts', 'Nutrition advice', 'Progress tracking'],
    whatsIncluded: ['1-hour sessions', 'Weekly plans', 'Goal setting'],
    requirements: ['Medical clearance if needed'],
    images: [
      {
        url: 'https://images.pexels.com/photos/3026230/pexels-photo-3026230.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1',
        caption: 'Personal Trainers fitness',
        isPrimary: true,
      },
    ],
    videos: [
      {
        url: 'https://videos.pexels.com/video-files/3195584/3195584-hd_1280_720_30fps.mp4',
        caption: 'Workout training session',
      },
    ],
  },
};

// Default availability schedule
const defaultAvailability = {
  schedule: {
    monday: { available: true, hours: [{ start: '09:00', end: '17:00' }] },
    tuesday: { available: true, hours: [{ start: '09:00', end: '17:00' }] },
    wednesday: { available: true, hours: [{ start: '09:00', end: '17:00' }] },
    thursday: { available: true, hours: [{ start: '09:00', end: '17:00' }] },
    friday: { available: true, hours: [{ start: '09:00', end: '17:00' }] },
    saturday: { available: false, hours: [] },
    sunday: { available: false, hours: [] },
  },
  leadTime: 24,
  maxAdvanceBooking: 30,
};

// Seed function
const seedServices = async () => {
  try {
    // Clear existing services
    await Service.deleteMany({});
    console.log('Existing services cleared.');

    // Create service providers
    const providers = [];
    for (let i = 1; i <= 10; i++) {
      const location = locations[i % locations.length];
      const email = `provider${i}@example.com`;
      const existingUser = await User.findOne({ email });

      if (!existingUser) {
        const user = await User.create({
          firstName: `Provider${i}`,
          lastName: 'Smith',
          email,
          password: await bcrypt.hash('password123', 10),
          userType: 'service_provider',
          businessName: `Provider ${i} Services`,
          location: {
            type: 'Point',
            coordinates: location.coordinates,
            postcode: location.zipCode,
          },
          address: {
            city: location.city,
            zipCode: location.zipCode,
            country: 'USA',
          },
          categories: categories.map(cat => cat._id), // Assign all categories
          isVerified: true,
          isActive: true,
          rating: { average: 4.5, count: 10 },
        });
        providers.push(user);
        console.log(`Created provider: ${user.email}`);
      } else {
        providers.push(existingUser);
      }
    }

    // Create services for each category and provider
    const services = [];
    for (const category of categories) {
      for (const provider of providers) {
        const location = locations[providers.indexOf(provider) % locations.length];
        const template = serviceTemplates[category.name];
        const service = await Service.create({
          title: `${template.title} in ${location.city}`,
          description: template.description,
          shortDescription: template.shortDescription,
          provider: provider._id,
          category: category._id,
          pricing: template.pricing,
          serviceAreas: [
            {
              city: location.city,
              zipCodes: [location.zipCode],
              radius: 25,
            },
          ],
          location: {
            type: 'Point',
            coordinates: location.coordinates,
          },
          features: template.features,
          whatsIncluded: template.whatsIncluded,
          requirements: template.requirements,
          availability: defaultAvailability,
          images: template.images,  // Use real images from template
          // videos: template.videos,  // Uncomment if your schema has a videos field
          isActive: true,
          isPaused: false,
          isFeatured: Math.random() > 0.7, // Randomly feature some services
          rating: { average: 4.5, count: 10 },
          faqs: [
            { question: `What does ${category.name} include?`, answer: template.whatsIncluded.join(', '), order: 0 },
            { question: 'How to book?', answer: 'Contact us through the platform.', order: 1 },
          ],
        });
        services.push(service);
        console.log(`Created service: ${service.title} for ${provider.email}`);
      }
    }

    console.log(`Seeded ${services.length} services successfully.`);
  } catch (error) {
    console.error('Seeding error:', error);
  } finally {
    mongoose.connection.close();
    console.log('Database connection closed.');
  }
};

// Run the seed function
seedServices();