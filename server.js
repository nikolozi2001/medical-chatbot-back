const PORT = process.env.PORT || 8000;
const express = require("express");
const cors = require("cors");
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");

// Configure CORS for the entire application
app.use(cors({
  origin: "*", // In production, replace with specific origins
  credentials: true
}));

app.use(express.json());
require("dotenv").config();

// Configure Socket.IO with proper CORS settings
const io = new Server(server, {
  cors: {
    origin: "*", // In production, replace with specific origins
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["my-custom-header"]
  },
  transports: ['websocket', 'polling'], // Explicitly define transports
  pingTimeout: 30000,
  pingInterval: 25000
});

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEN_AI_KEY);

// Track active operators and clients
const activeOperators = new Set();
const activeClients = new Map(); // clientId -> {socket, operatorId}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New socket connection:', socket.id);
  
  // Heartbeat to keep connection alive
  socket.on('ping', () => {
    socket.emit('pong');
  });
  
  // Test event to verify connection
  socket.emit('connected', { message: 'You are connected to the server!' });
  
  // Operator connects to the system
  socket.on('operator:connect', (operatorData) => {
    const operatorId = operatorData.id || socket.id;
    console.log('Operator connected:', operatorId);
    
    socket.join('operators');
    activeOperators.add(operatorId);
    socket.operatorId = operatorId;
    
    // Inform the operator about current active clients
    socket.emit('clients:list', Array.from(activeClients.keys()).map(clientId => ({
      id: clientId,
      hasOperator: !!activeClients.get(clientId).operatorId
    })));
    
    // Broadcast to all clients that an operator is available
    socket.broadcast.emit('operator:status', { available: true });
  });
  
  // Client connects to the system
  socket.on('client:connect', (clientData) => {
    const clientId = clientData.id || socket.id;
    console.log('Client connected:', clientId);
    
    socket.join('clients');
    socket.clientId = clientId;
    
    activeClients.set(clientId, { 
      socket: socket.id,
      operatorId: null 
    });
    
    // Notify operators about the new client
    io.to('operators').emit('client:new', { id: clientId });
    
    // Let the client know if operators are available
    socket.emit('operator:status', { available: activeOperators.size > 0 });
  });
  
  // Operator accepts a client chat
  socket.on('operator:accept', ({ clientId }) => {
    if (!socket.operatorId) return;
    
    console.log(`Operator ${socket.operatorId} accepted client ${clientId}`);
    
    const client = activeClients.get(clientId);
    if (client) {
      client.operatorId = socket.operatorId;
      activeClients.set(clientId, client);
      
      // Notify the client they've been accepted
      io.to(client.socket).emit('chat:accepted', { operatorId: socket.operatorId });
      
      // Update other operators that this client is now taken
      socket.broadcast.to('operators').emit('client:updated', {
        id: clientId,
        hasOperator: true
      });
    }
  });
  
  // Message handling
  socket.on('message:send', ({ text, to, type = 'text' }) => {
    console.log(`Message from ${socket.id} to ${to}: ${text}`);
    
    // From operator to client
    if (socket.operatorId && activeClients.has(to)) {
      const client = activeClients.get(to);
      io.to(client.socket).emit('message:received', {
        text,
        from: socket.operatorId,
        type,
        timestamp: new Date().toISOString()
      });
    }
    
    // From client to operator
    else if (socket.clientId) {
      const client = activeClients.get(socket.clientId);
      if (client && client.operatorId) {
        io.to('operators').emit('message:received', {
          text,
          from: socket.clientId,
          type,
          timestamp: new Date().toISOString()
        });
      }
    }
  });
  
  // Handle disconnections
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    
    // Operator disconnect
    if (socket.operatorId) {
      activeOperators.delete(socket.operatorId);
      
      // Notify clients if no operators are left
      if (activeOperators.size === 0) {
        io.to('clients').emit('operator:status', { available: false });
      }
    }
    
    // Client disconnect
    if (socket.clientId) {
      activeClients.delete(socket.clientId);
      io.to('operators').emit('client:left', { id: socket.clientId });
    }
  });
});

app.get("/", (req, res) => {
  res.send("Medical Chatbot API is running!");
});

app.post("/chat", async (req, res) => {
  try {
    console.log("Received /chat request with body:", req.body);

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const chat = model.startChat({
      history: req.body.history,
    });

    const msg = req.body.message;

    const result = await chat.sendMessage(msg);
    console.log("Result object:", result);

    const response = await result.response;
    console.log("Response object:", response);

    const text = response.candidates[0].content.parts.map(part => part.text).join(" ");
    console.log("Generated response text:", text);

    res.json({ text });
  } catch (error) {
    console.error("Error handling /chat request:", error);
    if (error.response) {
      console.error("Response data:", error.response.data);
      console.error("Response status:", error.response.status);
      console.error("Response headers:", error.response.headers);
    }
    res.status(500).send("Internal Server Error");
  }
});

// Test endpoint to verify server is running
app.get("/status", (req, res) => {
  res.json({ 
    status: "Server is running", 
    socketConnections: io.engine.clientsCount,
    uptime: process.uptime()
  });
});

// Important: Listen on 'server' instead of 'app'
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Socket.IO server is available at http://localhost:${PORT}`);
});
