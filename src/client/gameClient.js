import { io } from 'socket.io-client';

/**
 * Network client for isomorphic game operation
 * Handles connection to server and synchronization of game state
 */
class GameClient {
    constructor(serverUrl = null) {
        this.socket = null;
        this.connected = false;
        this.sessionId = null;
        this.callbacks = {
            onConnect: [],
            onDisconnect: [],
            onStateUpdate: [],
            onError: []
        };
        
        // Determine server URL
        if (!serverUrl) {
            // Try to detect server URL
            if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
                // Production - use current hostname
                serverUrl = window.location.origin;
            } else {
                // Development - try common ports
                serverUrl = window.location.origin;
            }
        }
        
        this.serverUrl = serverUrl;
    }
    
    connect(sessionId = null) {
        return new Promise((resolve, reject) => {
            // Already connected to this session
            if (this.connected && this.sessionId === sessionId) {
                resolve(this);
                return;
            }
            
            // Disconnect if already connected to a different session
            if (this.connected) {
                this.disconnect();
            }
            
            try {
                // Create socket connection
                this.socket = io(this.serverUrl, {
                    transports: ['websocket', 'polling'],
                    reconnection: true,
                    reconnectionAttempts: 5,
                    reconnectionDelay: 1000
                });
                
                // Set up event handlers
                this.socket.on('connect', () => {
                    this.connected = true;
                    this.notify('onConnect', this);
                    
                    // Join or create session
                    this.socket.emit('joinSession', sessionId);
                    
                    resolve(this);
                });
                
                this.socket.on('sessionJoined', (data) => {
                    this.sessionId = data.sessionId;
                    this.notify('onConnect', this);
                    resolve(this);
                });
                
                this.socket.on('gameStateUpdate', (gameState) => {
                    this.notify('onStateUpdate', gameState);
                });
                
                this.socket.on('error', (error) => {
                    this.notify('onError', error);
                });
                
                this.socket.on('disconnect', () => {
                    this.connected = false;
                    this.notify('onDisconnect', this);
                });
                
                this.socket.on('connect_error', (error) => {
                    this.notify('onError', error);
                    reject(error);
                });
                
            } catch (error) {
                this.notify('onError', error);
                reject(error);
            }
        });
    }
    
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.connected = false;
        this.sessionId = null;
    }
    
    sendAction(action, data = {}) {
        if (!this.connected || !this.socket) {
            return Promise.reject(new Error('Not connected to server'));
        }
        
        return new Promise((resolve, reject) => {
            try {
                this.socket.emit('gameAction', { action, data }, (response) => {
                    if (response && response.error) {
                        reject(new Error(response.error));
                    } else {
                        resolve(response);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Convenience methods for game actions
    acceptSample() {
        return this.sendAction('acceptSample');
    }
    
    startSampleAnalysis(sampleId) {
        return this.sendAction('startSampleAnalysis', { sampleId });
    }
    
    completeSampleAnalysis(sampleId) {
        return this.sendAction('completeSampleAnalysis', { sampleId });
    }
    
    startResearch(techId) {
        return this.sendAction('startResearch', { techId });
    }
    
    upgradeLaboratory(upgradeType) {
        return this.sendAction('upgradeLaboratory', { upgradeType });
    }
    
    removeSample(sampleId) {
        return this.sendAction('removeSample', { sampleId });
    }
    
    tick(timeElapsed) {
        return this.sendAction('tick', { timeElapsed });
    }
    
    on(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event].push(callback);
        }
        return this;
    }
    
    off(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event] = this.callbacks[event].filter(cb => cb !== callback);
        }
        return this;
    }
    
    notify(event, ...args) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(callback => {
                try {
                    callback(...args);
                } catch (error) {
                    console.error(`Error in ${event} callback:`, error);
                }
            });
        }
    }
    
    getSessionId() {
        return this.sessionId;
    }
    
    isConnected() {
        return this.connected;
    }
}

/**
 * Local game client - runs entirely in browser without server
 * Provides the same interface as GameClient for isomorphic operation
 */
class LocalGameClient {
    constructor(gameState) {
        this.gameState = gameState;
        this.callbacks = {
            onConnect: [],
            onDisconnect: [],
            onStateUpdate: [],
            onError: []
        };
        this.connected = true;
        this.sessionId = 'local-' + Date.now();
        
        // Set up subscription to game state
        this.unsubscribe = gameState.subscribe(state => {
            this.notify('onStateUpdate', state);
        });
        
        // Notify that we're connected
        this.notify('onConnect', this);
    }
    
    sendAction(action, data = {}) {
        return new Promise((resolve, reject) => {
            try {
                let result;
                switch (action) {
                    case 'acceptSample':
                        result = this.gameState.acceptSample();
                        break;
                    case 'startSampleAnalysis':
                        result = this.gameState.startSampleAnalysis(data.sampleId);
                        break;
                    case 'completeSampleAnalysis':
                        result = this.gameState.completeSampleAnalysis(data.sampleId);
                        break;
                    case 'startResearch':
                        result = this.gameState.startResearch(data.techId);
                        break;
                    case 'upgradeLaboratory':
                        result = this.gameState.upgradeLaboratory(data.upgradeType);
                        break;
                    case 'removeSample':
                        result = this.gameState.removeSample(data.sampleId);
                        break;
                    case 'tick':
                        result = this.gameState.tick(data.timeElapsed);
                        break;
                    default:
                        reject(new Error('Unknown action'));
                        return;
                }
                resolve(result);
            } catch (error) {
                this.notify('onError', error);
                reject(error);
            }
        });
    }
    
    // Convenience methods
    acceptSample() {
        return this.sendAction('acceptSample');
    }
    
    startSampleAnalysis(sampleId) {
        return this.sendAction('startSampleAnalysis', { sampleId });
    }
    
    completeSampleAnalysis(sampleId) {
        return this.sendAction('completeSampleAnalysis', { sampleId });
    }
    
    startResearch(techId) {
        return this.sendAction('startResearch', { techId });
    }
    
    upgradeLaboratory(upgradeType) {
        return this.sendAction('upgradeLaboratory', { upgradeType });
    }
    
    removeSample(sampleId) {
        return this.sendAction('removeSample', { sampleId });
    }
    
    tick(timeElapsed) {
        return this.sendAction('tick', { timeElapsed });
    }
    
    on(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event].push(callback);
        }
        return this;
    }
    
    off(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event] = this.callbacks[event].filter(cb => cb !== callback);
        }
        return this;
    }
    
    notify(event, ...args) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(callback => {
                try {
                    callback(...args);
                } catch (error) {
                    console.error(`Error in ${event} callback:`, error);
                }
            });
        }
    }
    
    disconnect() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        this.connected = false;
        this.notify('onDisconnect', this);
    }
    
    getSessionId() {
        return this.sessionId;
    }
    
    isConnected() {
        return this.connected;
    }
    
    cleanup() {
        this.disconnect();
    }
}

/**
 * Factory function to create appropriate client based on environment
 */
function createGameClient(gameState, serverUrl = null) {
    // Check if we should use server mode
    const useServer = serverUrl || 
        window.location.search.includes('multiplayer=true') ||
        window.location.search.includes('server=true');
    
    if (useServer) {
        console.log('Creating network game client');
        return new GameClient(serverUrl);
    } else {
        console.log('Creating local game client');
        return new LocalGameClient(gameState);
    }
}

export { GameClient, LocalGameClient, createGameClient };