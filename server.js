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

// Add a utility function to track recently processed messages
const recentMessages = new Map(); // messageId -> timestamp
const MESSAGE_TTL = 10000; // 10 seconds

// Clean up old messages periodically
setInterval(() => {
  const now = Date.now();
  for (const [messageId, timestamp] of recentMessages.entries()) {
    if (now - timestamp > MESSAGE_TTL) {
      recentMessages.delete(messageId);
    }
  }
}, 30000); // Clean every 30 seconds

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
    const operatorName = operatorData.name || 'Operator';
    console.log(`Operator connected: ${operatorId} (${operatorName})`);
    
    socket.join('operators');
    activeOperators.add(operatorId);
    socket.operatorId = operatorId;
    socket.operatorName = operatorName;
    
    // Inform the operator about current active clients with unique IDs only
    const uniqueClients = Array.from(activeClients.entries()).map(([id, client]) => ({
      id,
      name: client.name || 'Guest',
      hasOperator: !!client.operatorId,
      status: client.status || 'connected'
    }));
    
    console.log('Sending unique clients list to operator:', uniqueClients.map(c => c.id));
    socket.emit('clients:list', uniqueClients);
    
    // Broadcast to all clients that an operator is available
    socket.broadcast.emit('operator:status', { available: true });
  });
  
  // Client connects to the system
  socket.on('client:connect', (clientData) => {
    const clientId = clientData.id || socket.id;
    const clientName = clientData.name || 'Guest';
    console.log(`Client connected: ${clientId} (${clientName})`);
    
    // Add logging to debug duplicate clients
    console.log('Current active clients before update:', Array.from(activeClients.keys()));
    
    socket.join('clients');
    socket.clientId = clientId;
    socket.clientName = clientName;
    
    // Check if this client already exists and update socket ID
    if (activeClients.has(clientId)) {
      const existingClient = activeClients.get(clientId);
      console.log(`Client ${clientId} reconnected, updating socket ID from ${existingClient.socket} to ${socket.id}`);
      
      // Update the socket ID but preserve operator assignment and name
      activeClients.set(clientId, { 
        socket: socket.id,
        operatorId: existingClient.operatorId,
        name: clientName || existingClient.name,
        status: 'connected',
        reconnectedAt: new Date().toISOString()
      });
      
      // Notify operators about reconnection with preserved state
      io.to('operators').emit('client:reconnected', { 
        id: clientId, 
        name: clientName,
        hasOperator: !!existingClient.operatorId,
        status: 'connected'
      });
      
      // If client had an operator, re-establish the connection
      if (existingClient.operatorId) {
        console.log(`Restoring operator ${existingClient.operatorId} for client ${clientId}`);
        io.to(socket.id).emit('chat:accepted', { 
          operatorId: existingClient.operatorId,
          restored: true // Add flag to indicate this is a restored connection
        });
        
        // Important: Also notify operators about this client being reconnected
        io.to('operators').emit('client:updated', {
          id: clientId,
          name: clientName,
          hasOperator: true,
          status: 'connected',
          reconnected: true
        });
      }
      
      // Enhanced debugging log
      console.log(`Client ${clientId} reconnected. Updated active clients:`, Array.from(activeClients.keys()));
    } else {
      // Register new client
      activeClients.set(clientId, { 
        socket: socket.id,
        operatorId: null,
        name: clientName,
        status: 'connected',
        connectedAt: new Date().toISOString()
      });
      
      // Notify operators about the new client, ensuring unique ID
      io.to('operators').emit('client:new', { 
        id: clientId,
        name: clientName,
        hasOperator: false,
        status: 'connected'
      });
      
      console.log(`New client ${clientId} added. Updated active clients:`, Array.from(activeClients.keys()));
    }
    
    // Let the client know if operators are available
    socket.emit('operator:status', { available: activeOperators.size > 0 });
  });
  
  // Replace the problematic code removing the client:reconnect handler
  // PROBLEM: socket.off('client:reconnect') is trying to remove an undefined listener
  
  // Instead of this:
  // socket.off('client:reconnect'); // Remove any existing handler

  // Do this - remove ALL listeners for this event, which is safer:
  socket.removeAllListeners('client:reconnect');
  
  // For backward compatibility, add a simple redirection for old client:reconnect usage
  socket.on('client:reconnect', (clientData) => {
    console.log('Legacy client:reconnect received, redirecting to client:connect');
    // Use the proper handling method - emit to the client:connect handler on this socket
    socket.emit('client:connect', clientData);
  });

  // Client leaves chat explicitly
  socket.on('client:leave', ({ clientId }) => {
    console.log(`Client ${clientId} explicitly left the chat`);
    
    if (activeClients.has(clientId)) {
      const client = activeClients.get(clientId);
      if (client.socket === socket.id) {
        activeClients.delete(clientId);
        io.to('operators').emit('client:left', { id: clientId });
      }
    }
  });
  
  // Operator accepts a client chat
  socket.on('operator:accept', ({ clientId }) => {
    if (!socket.operatorId) return;
    
    console.log(`Operator ${socket.operatorId} accepted client ${clientId}`);
    
    const client = activeClients.get(clientId);
    if (client) {
      client.operatorId = socket.operatorId;
      activeClients.set(clientId, client);
      
      // Confirm to the operator that the client is accepted
      socket.emit('client:accepted', { 
        id: clientId,
        status: 'accepted' 
      });
      
      // Notify the client they've been accepted
      io.to(client.socket).emit('chat:accepted', { operatorId: socket.operatorId });
      
      // Update other operators that this client is now taken
      socket.broadcast.to('operators').emit('client:updated', {
        id: clientId,
        hasOperator: true
      });
    } else {
      // If client not found, send error to operator
      socket.emit('error', { message: 'Client not found or no longer connected' });
    }
  });
  
  // Message handling with deduplication
  socket.on('message:send', ({ text, to, messageId = Date.now(), type = 'text', name }) => {
    console.log(`Message from ${socket.id} to ${to}: ${text}`);
    
    // Check if we've seen this message recently
    if (messageId && recentMessages.has(messageId)) {
      console.log(`Ignoring duplicate message: ${messageId}`);
      return;
    }
    
    // Track this message to prevent duplicates
    if (messageId) {
      recentMessages.set(messageId, Date.now());
    }
    
    // From operator to client
    if (socket.operatorId && to) {
      const client = activeClients.get(to);
      
      // Client not found check
      if (!client) {
        console.log(`Client ${to} not found`);
        socket.emit('error', { 
          message: 'Client not found or no longer connected',
          clientId: to
        });
        return;
      }
      
      // IMPROVED CHAT ENDED CHECK - Log more details for debugging
      console.log(`Checking if chat ended for client ${to}: chatEnded=${client.chatEnded}, endedBy=${client.endedBy || 'unknown'}`);
      
      // Check for chatEnded explicitly with strict equality
      if (client.chatEnded === true) {
        console.log(`BLOCKED: Message to ended chat with client ${to}`);
        
        // Send detailed error and ensure chat:ended event is sent again
        socket.emit('error', { 
          message: 'Cannot send message: Chat has ended',
          clientId: to,
          chatEndedAt: client.endedAt || new Date().toISOString()
        });
        
        // Re-emit chat:ended event to force operator client state to update
        socket.emit('chat:ended', {
          clientId: to,
          endedBy: client.endedBy || 'client',
          message: 'This chat has already ended',
          timestamp: client.endedAt || new Date().toISOString()
        });
        return;
      }

      if (client && client.socket) {
        console.log(`Sending message from operator ${socket.operatorId} to client ${to}`);
        
        // Ensure we set the operatorId in the client data to maintain the connection
        client.operatorId = socket.operatorId;
        activeClients.set(to, client);
        
        io.to(client.socket).emit('message:received', {
          text,
          from: socket.operatorId,
          name: name || socket.operatorName || 'ოპერატორი',
          type,
          timestamp: new Date().toISOString()
        });
      } else {
        // Client not found or disconnected
        socket.emit('error', { 
          message: 'Client disconnected or not found',
          clientId: to
        });
      }
    }
    // From client to operator
    else if (socket.clientId) {
      const client = activeClients.get(socket.clientId);
      if (client && client.operatorId) {
        console.log(`Sending message from client ${socket.clientId} to operators`);
        
        // Ensure the client doesn't lose its operator assignment
        io.to('operators').emit('message:received', {
          text,
          from: socket.clientId,
          name: name || socket.clientName || client.name || 'გესტი',
          type,
          timestamp: new Date().toISOString()
        });
      } else {
        // No operator assigned
        socket.emit('error', { message: 'No operator assigned to this chat yet' });
      }
    }
  });
  
  // Update the chat:end event handling to be more robust
  socket.on('chat:end', ({ clientId, operatorId, endedBy }) => {
    console.log(`Chat ended - clientId: ${clientId}, operatorId: ${operatorId}, endedBy: ${endedBy}`);
    
    // Validate input parameters
    if (!clientId) {
      console.error("Missing clientId in chat:end event");
      return;
    }
    
    const client = activeClients.get(clientId);
    if (!client) {
      console.error(`Client ${clientId} not found for chat:end event`);
      return;
    }
    
    // Get the existing operator ID if not provided
    const effectiveOperatorId = operatorId || client.operatorId;
    
    // Update client state regardless of who ended the chat
    activeClients.set(clientId, {
      ...client,
      operatorId: null, // Remove operator assignment
      chatEnded: true,  // Explicitly mark as ended
      endedBy: endedBy || 'unknown',
      endedAt: new Date().toISOString()
    });
    
    // Log chat ended state
    const updatedClient = activeClients.get(clientId);
    console.log(`Client ${clientId} chat marked as ended: chatEnded=${updatedClient.chatEnded}, endedBy=${updatedClient.endedBy}`);
    
    // Create a chat:ended event payload
    const endEventPayload = {
      clientId,
      operatorId: effectiveOperatorId,
      endedBy: endedBy || 'unknown',
      message: `Chat ended by ${endedBy || 'unknown'}`,
      timestamp: new Date().toISOString()
    };
    
    // Generate a new clientId for the client's next session
    const newClientId = `${clientId}_new_${Date.now()}`;
    console.log(`Generated new client ID for next session: ${newClientId}`);
    
    // Notify ALL operators to ensure everyone knows this chat has ended
    io.to('operators').emit('chat:ended', endEventPayload);
    
    // Update operators about client status
    io.to('operators').emit('client:updated', {
      id: clientId,
      hasOperator: false,
      status: 'available',
      chatEnded: true
    });
    
    // Notify client if they're still connected
    if (client.socket) {
      // First send the chat:ended event
      io.to(client.socket).emit('chat:ended', {
        ...endEventPayload,
        message: endedBy === 'operator' ? 'The operator has ended this chat session' : 'You ended the chat session'
      });
      
      // Then send the new client ID for their next session
      io.to(client.socket).emit('chat:assign_new_id', {
        oldId: clientId,
        newId: newClientId,
        timestamp: new Date().toISOString()
      });
    }
  });
  
  // Handle disconnections with improved persistence
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    
    // Operator disconnect
    if (socket.operatorId) {
      // Don't immediately remove the operator, give time for potential reconnect
      setTimeout(() => {
        if (!io.sockets.adapter.rooms.has(socket.id)) {
          activeOperators.delete(socket.operatorId);
          
          // Notify clients if no operators are left
          if (activeOperators.size === 0) {
            io.to('clients').emit('operator:status', { available: false });
          }
        }
      }, 5000); // 5 second grace period for reconnect
    }
    
    // Client disconnect with grace period
    if (socket.clientId) {
      console.log(`Client ${socket.clientId} socket disconnected, starting grace period`);
      const client = activeClients.get(socket.clientId);
      
      if (client && client.socket === socket.id) {
        // Don't delete, just mark as disconnected and notify operators
        activeClients.set(socket.clientId, {
          ...client,
          status: 'disconnected',
          disconnectedAt: new Date().toISOString()
        });
        
        // Notify operators about temporary disconnect
        io.to('operators').emit('client:updated', { 
          id: socket.clientId,
          status: 'disconnected',
          hasOperator: !!client.operatorId
        });
        
        // Set timeout to remove client if not reconnected
        setTimeout(() => {
          const currentClient = activeClients.get(socket.clientId);
          if (currentClient && currentClient.status === 'disconnected') {
            console.log(`Removing client ${socket.clientId} after grace period`);
            activeClients.delete(socket.clientId);
            io.to('operators').emit('client:left', { id: socket.clientId });
          }
        }, 30000); // 30 seconds grace period
      }
    }
  });

  // Unified reconnect:attempt handler
  socket.on('reconnect:attempt', ({ clientId, operatorId, name }) => {
    console.log(`Reconnection attempt - clientId: ${clientId}, operatorId: ${operatorId}`);
    
    if (clientId) {
      // Client reconnecting
      socket.clientId = clientId;
      socket.clientName = name;
      socket.join('clients');
      
      // Check if this client exists
      const existingClient = activeClients.get(clientId);
      if (existingClient) {
        // Store previous socket ID to detect if this is really a new connection
        const previousSocketId = existingClient.socket;
        
        // Only update if this is a new socket ID
        if (previousSocketId !== socket.id) {
          console.log(`Client ${clientId} reconnected with new socket ID: ${socket.id} (previous: ${previousSocketId})`);
          
          // Update client record with new socket ID
          activeClients.set(clientId, { 
            ...existingClient,
            socket: socket.id,
            name: name || existingClient.name,
            status: 'connected',
            reconnectedAt: new Date().toISOString()
          });
          
          // Notify operators about reconnection - only when socket truly changed
          io.to('operators').emit('client:reconnected', {
            id: clientId,
            name: name || existingClient.name,
            hasOperator: !!existingClient.operatorId,
            status: 'connected'
          });
          
          // If client had an operator, restore the connection
          if (existingClient.operatorId) {
            console.log(`Restoring operator ${existingClient.operatorId} for client ${clientId}`);
            
            // Send exactly once to just this client
            socket.emit('chat:accepted', { 
              operatorId: existingClient.operatorId,
              restored: true // Add flag to indicate this is a restored connection
            });
            
            // Notify operator about successful reconnection
            io.to('operators').emit('message:system', {
              clientId,
              text: 'Client has reconnected and can continue chatting',
              timestamp: new Date().toISOString()
            });
          }
        } else {
          console.log(`Client ${clientId} reconnected but socket ID is unchanged: ${socket.id}`);
        }
        
        // Always confirm successful reconnection to client
        socket.emit('reconnect:success', {
          operatorId: existingClient.operatorId,
          status: 'connected',
          socketId: socket.id
        });
      } else {
        // Client is completely new, register with client:connect instead
        console.log(`Client ${clientId} not found during reconnect, treating as new client`);
        socket.emit('use:client:connect');
      }
    } else if (operatorId) {
      // Operator reconnecting
      socket.operatorId = operatorId;
      socket.operatorName = name;
      socket.join('operators');
      activeOperators.add(operatorId);
      
      // Inform clients that an operator is available
      io.to('clients').emit('operator:status', { available: true });
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
