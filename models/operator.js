const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const operatorSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  displayName: {
    type: String,
    default: 'Operator'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  role: {
    type: String,
    enum: ['operator', 'admin'],
    default: 'operator'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  // Add these fields for password reset
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  
  // Add these fields for TOTP authentication
  totpSecret: String,
  isTotpEnabled: {
    type: Boolean,
    default: false
  }
});

// Pre-save hook to hash password
operatorSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
operatorSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    console.log('Comparing passwords for:', this.username);
    const isMatch = await bcrypt.compare(candidatePassword, this.password);
    console.log('Password match result:', isMatch);
    return isMatch;
  } catch (error) {
    console.error('Error comparing passwords:', error);
    return false;
  }
};

const Operator = mongoose.model('Operator', operatorSchema);
module.exports = Operator;
