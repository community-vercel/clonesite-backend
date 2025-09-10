const nodemailer = require('nodemailer');
const logger = require('./loggerutility');

// Create transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_PORT == 465, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

// Email templates
const emailTemplates = {
  emailVerification: {
    subject: 'Verify Your Email Address',
    html: (data) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Welcome to Bark Clone!</h2>
        <p>Hi ${data.name},</p>
        <p>Thank you for signing up! Please verify your email address by clicking the button below:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.verificationUrl}" 
             style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Verify Email Address
          </a>
        </div>
        <p>If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${data.verificationUrl}</p>
        <p>This link will expire in 24 hours.</p>
        <hr style="margin: 30px 0;">
        <p style="color: #888; font-size: 12px;">
          If you didn't create an account, please ignore this email.
        </p>
      </div>
    `
  },

  passwordReset: {
    subject: 'Reset Your Password',
    html: (data) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Password Reset Request</h2>
        <p>Hi ${data.name},</p>
        <p>You requested to reset your password. Click the button below to reset it:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.resetUrl}" 
             style="background-color: #dc3545; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p>If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #666;">${data.resetUrl}</p>
        <p>This link will expire in 10 minutes.</p>
        <hr style="margin: 30px 0;">
        <p style="color: #888; font-size: 12px;">
          If you didn't request this, please ignore this email. Your password won't be changed.
        </p>
      </div>
    `
  },

  newRequest: {
    subject: 'New Service Request in Your Area',
    html: (data) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">New Service Request Available</h2>
        <p>Hi ${data.providerName},</p>
        <p>A new ${data.category} request has been posted in your service area:</p>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #007bff;">${data.requestTitle}</h3>
          <p><strong>Category:</strong> ${data.category}</p>
          <p><strong>Location:</strong> ${data.location}</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.requestUrl}" 
             style="background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            View Request & Submit Quote
          </a>
        </div>
        <p>Don't miss out on this opportunity to grow your business!</p>
        <hr style="margin: 30px 0;">
        <p style="color: #888; font-size: 12px;">
          You're receiving this because you're a registered service provider in this category.
        </p>
      </div>
    `
  },

  quoteReceived: {
    subject: 'New Quote for Your Service Request',
    html: (data) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">You've Received a New Quote!</h2>
        <p>Hi ${data.customerName},</p>
        <p>${data.providerName} has submitted a quote for your request:</p>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0; color: #007bff;">${data.requestTitle}</h3>
          <p><strong>Quote Amount:</strong> ${data.currency === 'USD' ? '$' : data.currency}${data.quoteAmount}</p>
          <p><strong>Provider:</strong> ${data.providerName}</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.requestUrl}" 
             style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            View Quote Details
          </a>
        </div>
        <p>Review the quote details and provider profile before making your decision.</p>
      </div>
    `
  },

  projectUpdate: {
    subject: 'Project Update',
    html: (data) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Project Update</h2>
        <p>Hi ${data.recipientName},</p>
        <p>There's an update on your project: <strong>${data.projectTitle}</strong></p>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Update from ${data.senderName}:</h3>
          <p>${data.updateMessage}</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.projectUrl}" 
             style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
            View Project
          </a>
        </div>
      </div>
    `
  }
};

// Send email function
const sendEmail = async (options) => {
  try {
    const transporter = createTransporter();
    
    // Get template
    const template = emailTemplates[options.template];
    if (!template) {
      throw new Error(`Email template '${options.template}' not found`);
    }

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME || 'Bark Clone'}" <${process.env.EMAIL_USER}>`,
      to: options.email,
      subject: options.subject || template.subject,
      html: template.html(options.data || {})
    };

    const result = await transporter.sendMail(mailOptions);
    
    logger.info('Email sent successfully:', {
      to: options.email,
      subject: mailOptions.subject,
      messageId: result.messageId
    });

    return result;

  } catch (error) {
    logger.error('Email send failed:', {
      error: error.message,
      to: options.email,
      template: options.template
    });
    throw error;
  }
};

// Verify email configuration
const verifyEmailConfig = async () => {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    logger.info('Email configuration verified successfully');
    return true;
  } catch (error) {
    logger.error('Email configuration verification failed:', error.message);
    return false;
  }
};

// Send bulk emails (for notifications, newsletters, etc.)
const sendBulkEmails = async (emails) => {
  const results = {
    successful: [],
    failed: []
  };

  for (const emailData of emails) {
    try {
      await sendEmail(emailData);
      results.successful.push(emailData.email);
    } catch (error) {
      results.failed.push({
        email: emailData.email,
        error: error.message
      });
    }
  }

  logger.info('Bulk email results:', {
    total: emails.length,
    successful: results.successful.length,
    failed: results.failed.length
  });

  return results;
};

module.exports = {
  sendEmail,
  verifyEmailConfig,
  sendBulkEmails
};