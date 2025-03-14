const express = require('express');
const router = express.Router();
const Operator = require('../models/operator');
const jwt = require('jsonwebtoken');

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

module.exports = router;
