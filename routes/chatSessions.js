const express = require('express');
const router = express.Router();
const ChatSession = require('../models/chatSession');

// Get all chat sessions
router.get('/', async (req, res) => {
  try {
    const sessions = await ChatSession.find()
      .sort({ date: -1 }) // Newest first
      .select('-__v');    // Exclude version field
    
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get a specific chat session
router.get('/:id', async (req, res) => {
  try {
    const session = await ChatSession.findOne({ sessionId: req.params.id });
    if (!session) {
      return res.status(404).json({ message: 'Chat session not found' });
    }
    res.json(session);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create a new chat session
router.post('/', async (req, res) => {
  const session = new ChatSession({
    sessionId: req.body.sessionId || `session_${Date.now()}`,
    date: req.body.date || new Date(),
    messages: req.body.messages || [],
    userId: req.body.userId || 'anonymous',
    userAgent: req.headers['user-agent'],
    metadata: req.body.metadata || {}
  });

  try {
    const newSession = await session.save();
    res.status(201).json(newSession);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Add a message to an existing chat session
router.post('/:id/messages', async (req, res) => {
  try {
    const session = await ChatSession.findOne({ sessionId: req.params.id });
    if (!session) {
      return res.status(404).json({ message: 'Chat session not found' });
    }
    
    session.messages.push({
      type: req.body.type,
      message: req.body.message,
      isPredefined: req.body.isPredefined || false,
      timestamp: req.body.timestamp || new Date()
    });
    
    const updatedSession = await session.save();
    res.json(updatedSession);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Add feedback to a chat session
router.post('/:id/feedback', async (req, res) => {
  try {
    const session = await ChatSession.findOne({ sessionId: req.params.id });
    if (!session) {
      return res.status(404).json({ message: 'Chat session not found' });
    }
    
    session.feedback = {
      rating: req.body.rating,
      comment: req.body.comment,
      timestamp: req.body.timestamp || new Date()
    };
    
    const updatedSession = await session.save();
    res.json(updatedSession);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete a chat session
router.delete('/:id', async (req, res) => {
  try {
    const session = await ChatSession.findOneAndDelete({ sessionId: req.params.id });
    if (!session) {
      return res.status(404).json({ message: 'Chat session not found' });
    }
    res.json({ message: 'Chat session deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
