const mongoose = require("mongoose");

// Message schema as a subdocument
const messageSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["user", "bot", "system"],
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  isPredefined: {
    type: Boolean,
    default: false,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

// Chat session schema
const chatSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    messages: [messageSchema],
    userId: {
      type: String,
      default: "anonymous",
    },
    userAgent: String,
    metadata: {
      type: Map,
      of: String,
    },
    feedback: {
      rating: Number,
      comment: String,
      timestamp: Date,
    },
    clientName: {
      type: String,
      default: "Anonymous",
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt fields
  }
);

module.exports = mongoose.model("ChatSession", chatSessionSchema);
