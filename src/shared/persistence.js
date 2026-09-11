/**
 * Game state persistence for Laboratory Management Game
 * Handles saving and loading game state to/from localStorage and server
 */

const SAVE_SLOTS = ['save1', 'save2', 'save3', 'autoSave'];

/**
 * Save game state to localStorage
 */
function saveGameState(gameState, slot = 'autoSave') {
    try {
        const saveData = {
            version: '1.0.0',
            timestamp: Date.now(),
            data: gameState
        };
        
        localStorage.setItem(`labGame_${slot}`, JSON.stringify(saveData));
        return true;
    } catch (error) {
        console.error('Error saving game state:', error);
        return false;
    }
}

/**
 * Load game state from localStorage
 */
function loadGameState(slot = 'autoSave') {
    try {
        const saveData = localStorage.getItem(`labGame_${slot}`);
        if (!saveData) return null;
        
        const parsed = JSON.parse(saveData);
        
        // Basic validation
        if (parsed.version !== '1.0.0') {
            console.warn('Save file version mismatch, may be incompatible');
        }
        
        return parsed.data;
    } catch (error) {
        console.error('Error loading game state:', error);
        return null;
    }
}

/**
 * Check if a save slot has data
 */
function hasSaveData(slot = 'autoSave') {
    try {
        return localStorage.getItem(`labGame_${slot}`) !== null;
    } catch (error) {
        return false;
    }
}

/**
 * Delete save data from a slot
 */
function deleteSaveData(slot = 'autoSave') {
    try {
        localStorage.removeItem(`labGame_${slot}`);
        return true;
    } catch (error) {
        console.error('Error deleting save data:', error);
        return false;
    }
}

/**
 * Get list of available save slots with metadata
 */
function getSaveSlots() {
    return SAVE_SLOTS.map(slot => {
        try {
            const saveData = localStorage.getItem(`labGame_${slot}`);
            if (saveData) {
                const parsed = JSON.parse(saveData);
                return {
                    slot,
                    hasData: true,
                    timestamp: parsed.timestamp,
                    version: parsed.version,
                    preview: getSavePreview(parsed.data)
                };
            }
        } catch (error) {
            // Ignore errors for individual slots
        }
        
        return {
            slot,
            hasData: false,
            timestamp: null,
            version: null,
            preview: null
        };
    });
}

/**
 * Generate a preview of save data for UI
 */
function getSavePreview(gameState) {
    if (!gameState) return null;
    
    return {
        day: gameState.day || 1,
        money: gameState.money || 0,
        reputation: Math.floor(gameState.reputation) || 0,
        samplesCount: gameState.samples ? gameState.samples.length : 0,
        researchedTechs: gameState.researchedTechs ? gameState.researchedTechs.length : 0
    };
}

/**
 * Auto-save game state
 */
function autoSaveGameState(gameState) {
    // Save to autoSave slot
    saveGameState(gameState, 'autoSave');
    
    // Also save to a backup slot with timestamp
    const backupSlot = `backup_${Date.now()}`;
    saveGameState(gameState, backupSlot);
    
    // Clean up old backups (keep only last 5)
    cleanupBackups();
}

/**
 * Clean up old backup save files
 */
function cleanupBackups() {
    try {
        const backupSlots = Object.keys(localStorage)
            .filter(key => key.startsWith('labGame_backup_'))
            .sort()
            .reverse(); // Newest first
        
        // Keep only the 5 most recent backups
        if (backupSlots.length > 5) {
            backupSlots.slice(5).forEach(slot => {
                localStorage.removeItem(slot);
            });
        }
    } catch (error) {
        console.error('Error cleaning up backups:', error);
    }
}

/**
 * Export game state as JSON file
 */
function exportGameState(gameState, filename = 'lab-game-save.json') {
    try {
        const saveData = {
            version: '1.0.0',
            timestamp: Date.now(),
            data: gameState
        };
        
        const dataStr = JSON.stringify(saveData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(dataBlob);
        downloadLink.download = filename;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        
        return true;
    } catch (error) {
        console.error('Error exporting game state:', error);
        return false;
    }
}

/**
 * Import game state from JSON file
 */
async function importGameState(callback) {
    try {
        // Create file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        
        input.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) {
                callback(null);
                return;
            }
            
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const saveData = JSON.parse(e.target.result);
                    
                    // Basic validation
                    if (saveData.version !== '1.0.0') {
                        console.warn('Save file version mismatch');
                    }
                    
                    callback(saveData.data);
                } catch (error) {
                    console.error('Error parsing save file:', error);
                    callback(null);
                }
            };
            
            reader.onerror = () => {
                callback(null);
            };
            
            reader.readAsText(file);
        });
        
        input.click();
    } catch (error) {
        console.error('Error importing game state:', error);
        callback(null);
    }
}

/**
 * Server-based persistence (for multiplayer/hosted games)
 */
class ServerPersistence {
    constructor(sessionId, socket = null) {
        this.sessionId = sessionId;
        this.socket = socket;
    }
    
    saveGameState(gameState) {
        if (!this.socket || !this.sessionId) {
            return Promise.reject(new Error('Not connected to server'));
        }
        
        return new Promise((resolve, reject) => {
            this.socket.emit('saveSession', {
                sessionId: this.sessionId,
                gameState
            }, (response) => {
                if (response.success) {
                    resolve(true);
                } else {
                    reject(new Error(response.error || 'Failed to save'));
                }
            });
        });
    }
    
    loadGameState() {
        if (!this.socket || !this.sessionId) {
            return Promise.reject(new Error('Not connected to server'));
        }
        
        return new Promise((resolve, reject) => {
            this.socket.emit('loadSession', {
                sessionId: this.sessionId
            }, (response) => {
                if (response.success) {
                    resolve(response.gameState);
                } else {
                    reject(new Error(response.error || 'Failed to load'));
                }
            });
        });
    }
}

export {
    saveGameState,
    loadGameState,
    hasSaveData,
    deleteSaveData,
    getSaveSlots,
    getSavePreview,
    autoSaveGameState,
    cleanupBackups,
    exportGameState,
    importGameState,
    ServerPersistence,
    SAVE_SLOTS
};