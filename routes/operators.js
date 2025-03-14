const express = require('express');
const router = express.Router();
const Operator = require('../models/operator');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

// Environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// Middleware to validate operator input
const validateOperatorInput = (req, res, next) => {
  const { username, email, password } = req.body;
  
  // Simple validation
  if (!username || !email || !password) {
    return res.status(400).json({ message: 'Please enter all fields' });
  }
  
  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: 'Please enter a valid email' });
  }
  
  // Password length validation
  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters' });
  }
  
  next();
};

// Password reset token storage (In production, use a database)
const passwordResetTokens = new Map();

// Create a transporter for sending emails
const transporter = nodemailer.createTransport({
  // Configure your email service
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Create a test account using Ethereal for development
const createTestAccount = async () => {
  const testAccount = await nodemailer.createTestAccount();
  
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass
    }
  });
};

// Register a new operator
router.post('/register', validateOperatorInput, async (req, res) => {
  try {
    const { username, email, password, displayName } = req.body;
    
    // Check for existing operator
    const existingOperator = await Operator.findOne({ 
      $or: [{ email }, { username }] 
    });
    
    if (existingOperator) {
      return res.status(400).json({ 
        message: 'An account with that email or username already exists' 
      });
    }
    
    // Create new operator
    const newOperator = new Operator({
      username,
      email,
      password,
      displayName: displayName || username
    });
    
    await newOperator.save();
    
    // Create JWT token (without password)
    const operatorData = {
      id: newOperator._id,
      username: newOperator.username,
      email: newOperator.email,
      displayName: newOperator.displayName,
      role: newOperator.role
    };
    
    const token = jwt.sign(
      operatorData,
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    
    res.status(201).json({
      message: 'Operator registered successfully',
      token,
      operator: operatorData
    });
  } catch (error) {
    console.error('Error registering operator:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// Login an operator
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Add debug logging
    console.log('Login attempt for:', username);
    
    // Find operator by username or email
    const operator = await Operator.findOne({ 
      $or: [
        { username },
        { email: username } // Allow login with email as username
      ]
    });
    
    if (!operator) {
      console.log('No operator found with username/email:', username);
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    // Check if password matches
    const isMatch = await operator.comparePassword(password);
    if (!isMatch) {
      console.log('Password does not match for:', username);
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    // Check if operator is active
    if (!operator.isActive) {
      return res.status(403).json({ message: 'Your account is inactive. Please contact admin.' });
    }
    
    // Create JWT token
    const payload = {
      id: operator._id,
      username: operator.username,
      email: operator.email,
      displayName: operator.displayName,
      role: operator.role
    };
    
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    
    // Return token WITHOUT 'Bearer ' prefix - frontend will handle that if needed
    res.json({
      message: 'Login successful',
      token: token,
      operator: payload
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Request password reset - updated to use MongoDB
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    // Find operator by email
    const operator = await Operator.findOne({ email });
    if (!operator) {
      // Security: Don't reveal whether the email exists or not
      return res.status(200).json({ message: 'If your email is in our system, you will receive a password reset link' });
    }
    
    // Generate reset token
    const token = crypto.randomBytes(20).toString('hex');
    const expiresAt = Date.now() + 3600000; // 1 hour
    
    // Store token in the operator document
    operator.resetPasswordToken = token;
    operator.resetPasswordExpires = expiresAt;
    await operator.save();
    
    // Create reset URL
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/operator/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    
    // Send email
    const mailOptions = {
      to: email,
      from: process.env.EMAIL_FROM || 'noreply@medicalchatbot.com',
      subject: 'Password Reset Request',
      text: `You are receiving this email because you (or someone else) requested a password reset.\n\n
             Please click on the following link to reset your password:\n\n
             ${resetUrl}\n\n
             If you did not request this, please ignore this email and your password will remain unchanged.\n`
    };
    
    // Create transporter with environment variables
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
    
    await transporter.sendMail(mailOptions);
    
    res.status(200).json({ message: 'Password reset email sent' });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ message: 'Error processing your request' });
  }
});

// Validate reset token - updated to use MongoDB
router.get('/validate-reset-token', async (req, res) => {
  const { token, email } = req.query;
  
  if (!token || !email) {
    return res.status(400).json({ message: 'Invalid request' });
  }
  
  try {
    // Find operator by email and token
    const operator = await Operator.findOne({
      email,
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() } // Check if token is still valid
    });
    
    if (!operator) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }
    
    res.status(200).json({ message: 'Token is valid' });
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ message: 'Error validating token' });
  }
});

// Reset password - updated to use MongoDB
router.post('/reset-password', async (req, res) => {
  try {
    const { token, email, password } = req.body;
    
    if (!token || !email || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    
    // Find operator by email and token
    const operator = await Operator.findOne({
      email,
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() } // Check if token is still valid
    });
    
    if (!operator) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }
    
    // Update password
    operator.password = password; // The schema pre-save hook will hash the password
    
    // Clear reset token fields
    operator.resetPasswordToken = undefined;
    operator.resetPasswordExpires = undefined;
    
    await operator.save();
    
    // Create transporter with environment variables
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
    
    // Send confirmation email
    const mailOptions = {
      to: email,
      from: process.env.EMAIL_FROM || 'noreply@medicalchatbot.com',
      subject: 'Your password has been changed',
      text: `Hello,\n\n
             This is a confirmation that the password for your account ${email} has just been changed.\n`
    };
    
    await transporter.sendMail(mailOptions);
    
    res.status(200).json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ message: 'Error resetting password' });
  }
});

module.exports = router;
