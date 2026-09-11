import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { GameState, createInitialState, TECH_TREE, LAB_UPGRADES, GAME_CONFIG } from '../shared/gameState.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Express app and HTTP server
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// In production, serve static files from the dist directory
const isProduction = process.env.NODE_ENV === 'production';
const staticPath = isProduction ? path.join(__dirname, '../../dist') : path.join(__dirname, '../../public');

app.use(express.json());
app.use(express.static(staticPath));

// API routes for game state
const gameSessions = new Map(); // sessionId -> GameState

// Create a new game session
app.post('/api/sessions', (req, res) => {
    try {
        const sessionId = uuidv4();
        const gameState = new GameState(createInitialState());
        
        gameSessions.set(sessionId, gameState);
        
        // Set up cleanup on disconnect
        const state = gameState.getState();
        
        res.json({
            success: true,
            sessionId,
            gameState: state
        });
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get game state for a session
app.get('/api/sessions/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const gameState = gameSessions.get(sessionId);
        
        if (!gameState) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }
        
        const state = gameState.getState();
        res.json({ success: true, gameState: state });
    } catch (error) {
        console.error('Error getting session:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update game state (for actions)
app.post('/api/sessions/:sessionId/actions', (req, res) => {
    try {
        const { sessionId } = req.params;
        const { action, data } = req.body;
        
        const gameState = gameSessions.get(sessionId);
        if (!gameState) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }
        
        let result;
        switch (action) {
            case 'acceptSample':
                result = gameState.acceptSample();
                break;
            case 'startSampleAnalysis':
                result = gameState.startSampleAnalysis(data.sampleId);
                break;
            case 'completeSampleAnalysis':
                result = gameState.completeSampleAnalysis(data.sampleId);
                break;
            case 'startResearch':
                result = gameState.startResearch(data.techId);
                break;
            case 'upgradeLaboratory':
                result = gameState.upgradeLaboratory(data.upgradeType);
                break;
            case 'removeSample':
                result = gameState.removeSample(data.sampleId);
                break;
            case 'tick':
                result = gameState.tick(data.timeElapsed);
                break;
            default:
                return res.status(400).json({ success: false, error: 'Unknown action' });
        }
        
        res.json({ success: true, gameState: gameState.getState() });
    } catch (error) {
        console.error('Error performing action:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    let currentSessionId = null;
    
    // Create or join a session
    socket.on('joinSession', (sessionId) => {
        if (!sessionId) {
            // Create new session
            currentSessionId = uuidv4();
            const gameState = new GameState(createInitialState());
            gameSessions.set(currentSessionId, gameState);
            
            socket.join(currentSessionId);
            socket.emit('sessionJoined', {
                sessionId: currentSessionId,
                gameState: gameState.getState()
            });
            
            console.log(`Created new session: ${currentSessionId}`);
        } else {
            // Join existing session
            const gameState = gameSessions.get(sessionId);
            if (!gameState) {
                socket.emit('error', { message: 'Session not found' });
                return;
            }
            
            currentSessionId = sessionId;
            socket.join(sessionId);
            socket.emit('sessionJoined', {
                sessionId,
                gameState: gameState.getState()
            });
            
            console.log(`Client ${socket.id} joined session: ${sessionId}`);
        }
    });
    
    // Game actions via socket
    socket.on('gameAction', ({ action, data }) => {
        if (!currentSessionId) {
            socket.emit('error', { message: 'Not in a session' });
            return;
        }
        
        const gameState = gameSessions.get(currentSessionId);
        if (!gameState) {
            socket.emit('error', { message: 'Session not found' });
            return;
        }
        
        try {
            let result;
            switch (action) {
                case 'acceptSample':
                    result = gameState.acceptSample();
                    break;
                case 'startSampleAnalysis':
                    result = gameState.startSampleAnalysis(data.sampleId);
                    break;
                case 'completeSampleAnalysis':
                    result = gameState.completeSampleAnalysis(data.sampleId);
                    break;
                case 'startResearch':
                    result = gameState.startResearch(data.techId);
                    break;
                case 'upgradeLaboratory':
                    result = gameState.upgradeLaboratory(data.upgradeType);
                    break;
                case 'removeSample':
                    result = gameState.removeSample(data.sampleId);
                    break;
                case 'tick':
                    result = gameState.tick(data.timeElapsed);
                    break;
                default:
                    socket.emit('error', { message: 'Unknown action' });
                    return;
            }
            
            // Broadcast to all clients in this session
            io.to(currentSessionId).emit('gameStateUpdate', gameState.getState());
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        if (currentSessionId) {
            socket.leave(currentSessionId);
            currentSessionId = null;
        }
    });
});

// Serve the main page for all other routes
app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, '../../index.html');
    res.sendFile(indexPath);
});

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Laboratory Management Game server running on port ${PORT}`);
    console.log(`Game is accessible at http://localhost:${PORT}`);
});

// Cleanup on exit
process.on('SIGTERM', () => {
    console.log('Server shutting down...');
    io.close();
    httpServer.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

export { app, httpServer, io, gameSessions };