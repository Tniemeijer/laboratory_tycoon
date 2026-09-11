import { v4 as uuidv4 } from 'uuid';

// Sample types and their properties
const SAMPLE_TYPES = {
    BLOOD: {
        name: 'Blood Sample',
        baseValue: 100,
        baseDeadline: 3,
        description: 'Human blood for analysis',
        color: 0xff0000,
        storageRequirement: 'refrigerated'
    },
    TISSUE: {
        name: 'Tissue Sample',
        baseValue: 150,
        baseDeadline: 4,
        description: 'Biological tissue for study',
        color: 0xff6b6b,
        storageRequirement: 'refrigerated'
    },
    CHEMICAL: {
        name: 'Chemical Compound',
        baseValue: 200,
        baseDeadline: 5,
        description: 'Unknown chemical for identification',
        color: 0x00ff00,
        storageRequirement: 'stable'
    },
    VIRUS: {
        name: 'Virus Sample',
        baseValue: 300,
        baseDeadline: 2,
        description: 'Highly contagious virus',
        color: 0xffff00,
        storageRequirement: 'freezing'
    },
    DNA: {
        name: 'DNA Sample',
        baseValue: 250,
        baseDeadline: 6,
        description: 'Genetic material for sequencing',
        color: 0x00ffff,
        storageRequirement: 'refrigerated'
    },
    MINERAL: {
        name: 'Mineral Sample',
        baseValue: 80,
        baseDeadline: 7,
        description: 'Geological specimen',
        color: 0x808080,
        storageRequirement: 'stable'
    }
};

// Storage temperature levels
const STORAGE_TEMPS = {
    ROOM: { value: 20, maxPerishableDays: 1 },
    REFRIGERATED: { value: 5, maxPerishableDays: 3 },
    FREEZING: { value: -20, maxPerishableDays: 7 }
};

// Tech tree structure
const TECH_TREE = {
    BASIC_ANALYSIS: {
        id: 'BASIC_ANALYSIS',
        name: 'Basic Analysis',
        description: 'Allows analysis of basic samples',
        cost: 100,
        requirements: [],
        effects: {
            analysisSpeed: 1.0,
            canAnalyze: ['BLOOD', 'MINERAL']
        },
        tier: 1
    },
    ADVANCED_ANALYSIS: {
        id: 'ADVANCED_ANALYSIS',
        name: 'Advanced Analysis',
        description: 'Enables analysis of complex biological samples',
        cost: 300,
        requirements: ['BASIC_ANALYSIS'],
        effects: {
            analysisSpeed: 1.5,
            canAnalyze: ['TISSUE', 'DNA']
        },
        tier: 2
    },
    CHEMICAL_ANALYSIS: {
        id: 'CHEMICAL_ANALYSIS',
        name: 'Chemical Analysis',
        description: 'Allows identification of chemical compounds',
        cost: 250,
        requirements: ['BASIC_ANALYSIS'],
        effects: {
            analysisSpeed: 1.2,
            canAnalyze: ['CHEMICAL']
        },
        tier: 2
    },
    VIROLOGY: {
        id: 'VIROLOGY',
        name: 'Virology',
        description: 'Enables safe handling and analysis of viral samples',
        cost: 500,
        requirements: ['ADVANCED_ANALYSIS'],
        effects: {
            analysisSpeed: 2.0,
            canAnalyze: ['VIRUS'],
            canHandleDangerous: true
        },
        tier: 3
    },
    REFRIGERATION: {
        id: 'REFRIGERATION',
        name: 'Refrigeration System',
        description: 'Adds refrigerated storage capability',
        cost: 400,
        requirements: [],
        effects: {
            storageTemperature: 'REFRIGERATED',
            storageCapacity: 20
        },
        tier: 1
    },
    FREEZING: {
        id: 'FREEZING',
        name: 'Deep Freeze Storage',
        description: 'Adds freezing storage for long-term preservation',
        cost: 800,
        requirements: ['REFRIGERATION'],
        effects: {
            storageTemperature: 'FREEZING',
            storageCapacity: 10
        },
        tier: 2
    },
    AUTOMATION: {
        id: 'AUTOMATION',
        name: 'Automated Processing',
        description: 'Reduces analysis time by 30%',
        cost: 600,
        requirements: ['ADVANCED_ANALYSIS'],
        effects: {
            analysisSpeed: 0.7
        },
        tier: 3
    },
    QUALITY_CONTROL: {
        id: 'QUALITY_CONTROL',
        name: 'Quality Control',
        description: 'Increases sample value by 20%',
        cost: 400,
        requirements: ['BASIC_ANALYSIS'],
        effects: {
            valueMultiplier: 1.2
        },
        tier: 2
    }
};

// Laboratory upgrade tiers
const LAB_UPGRADES = {
    STORAGE: {
        id: 'STORAGE',
        name: 'Storage Expansion',
        baseCost: 200,
        costIncrement: 150,
        effect: (currentLevel) => ({
            storageCapacity: 10 * (currentLevel + 1)
        })
    },
    COOLING: {
        id: 'COOLING',
        name: 'Cooling System',
        baseCost: 300,
        costIncrement: 200,
        effect: (currentLevel) => ({
            temperatureStability: 5 * (currentLevel + 1)
        })
    },
    SCIENTIST: {
        id: 'SCIENTIST',
        name: 'Scientist Hiring',
        baseCost: 500,
        costIncrement: 400,
        effect: (currentLevel) => ({
            researchSpeed: 1 + (currentLevel * 0.5)
        })
    }
};

// Game configuration
const GAME_CONFIG = {
    initialMoney: 1000,
    initialReputation: 100,
    initialStorageCapacity: 10,
    initialStorageTemperature: 'ROOM',
    initialResearchSpeed: 1.0,
    initialAnalysisSpeed: 1.0,
    
    // Game timing
    dayDuration: 30000, // 30 seconds per day
    
    // Sample generation
    sampleBaseFrequency: 15000, // 15 seconds between samples
    sampleFrequencyReduction: 500, // Time reduction per reputation point
    minSampleFrequency: 5000, // Minimum 5 seconds
    
    // Sample value multipliers
    urgencyMultipliers: {
        HIGH: 2.0,
        MEDIUM: 1.5,
        LOW: 1.0
    },
    qualityMultipliers: {
        EXCELLENT: 1.5,
        GOOD: 1.2,
        AVERAGE: 1.0,
        POOR: 0.8
    },
    
    // Penalties
    deadlinePenalty: 0.1, // 10% reputation loss per missed deadline
    spoilagePenalty: 0.05, // 5% reputation loss per spoiled sample
    
    // Rewards
    successfulAnalysisReward: 10, // Reputation points per successful analysis
    techDiscoveryReward: 25 // Reputation points per tech discovery
};

// Helper functions
function generateSample(gameState) {
    const sampleTypes = Object.keys(SAMPLE_TYPES);
    const randomType = sampleTypes[Math.floor(Math.random() * sampleTypes.length)];
    const sampleTemplate = SAMPLE_TYPES[randomType];
    
    // Calculate deadline based on game difficulty (reputation)
    const reputationFactor = 1 + (gameState.reputation / 500);
    const deadline = Math.max(1, Math.floor(sampleTemplate.baseDeadline / reputationFactor));
    
    // Determine urgency based on deadline
    let urgency;
    if (deadline <= 2) urgency = 'HIGH';
    else if (deadline <= 4) urgency = 'MEDIUM';
    else urgency = 'LOW';
    
    // Determine quality randomly
    const qualityValues = ['EXCELLENT', 'GOOD', 'AVERAGE', 'POOR'];
    const quality = qualityValues[Math.floor(Math.random() * qualityValues.length)];
    
    // Calculate base value based on type, urgency, and quality
    const baseValue = sampleTemplate.baseValue * 
        GAME_CONFIG.urgencyMultipliers[urgency] * 
        GAME_CONFIG.qualityMultipliers[quality];
    
    const sample = {
        id: uuidv4(),
        type: randomType,
        name: sampleTemplate.name,
        description: sampleTemplate.description,
        color: sampleTemplate.color,
        storageRequirement: sampleTemplate.storageRequirement,
        deadline: gameState.day + deadline,
        urgency,
        quality,
        baseValue,
        createdAt: gameState.day,
        status: 'pending' // pending, in_progress, completed, failed, spoiled
    };
    
    return sample;
}

function canStoreSample(gameState, sample) {
    // Check if storage can accommodate this sample type
    const storageTemp = STORAGE_TEMPS[gameState.storageTemperature];
    const sampleTempRequirement = sample.storageRequirement;
    
    // Room temperature can store anything
    if (gameState.storageTemperature === 'ROOM') {
        return true;
    }
    
    // Refrigerated can store everything except freezing-required
    if (gameState.storageTemperature === 'REFRIGERATED') {
        return sampleTempRequirement !== 'freezing';
    }
    
    // Freezing can store everything
    if (gameState.storageTemperature === 'FREEZING') {
        return true;
    }
    
    return false;
}

function checkSampleSpoilage(gameState, sample) {
    // Samples that require refrigeration or freezing spoil faster at room temp
    if (gameState.storageTemperature === 'ROOM') {
        if (sample.storageRequirement === 'refrigerated') {
            return sample.createdAt + 2 < gameState.day;
        }
        if (sample.storageRequirement === 'freezing') {
            return sample.createdAt + 1 < gameState.day;
        }
    } else if (gameState.storageTemperature === 'REFRIGERATED') {
        if (sample.storageRequirement === 'freezing') {
            return sample.createdAt + 3 < gameState.day;
        }
    }
    
    // Natural spoilage based on type
    const storageTemp = STORAGE_TEMPS[gameState.storageTemperature];
    const maxDays = storageTemp.maxPerishableDays * (sample.storageRequirement === 'stable' ? 2 : 1);
    return sample.createdAt + maxDays < gameState.day;
}

function getAvailableResearch(gameState) {
    const available = [];
    const researched = new Set(gameState.researchedTechs);
    
    for (const [techId, tech] of Object.entries(TECH_TREE)) {
        // Check if all requirements are met
        const requirementsMet = tech.requirements.every(req => researched.has(req));
        
        if (requirementsMet && !researched.has(techId)) {
            available.push({ ...tech, id: techId });
        }
    }
    
    return available;
}

function getResearchCost(techId, gameState) {
    const tech = TECH_TREE[techId];
    // Cost might be reduced by certain techs or upgrades
    return tech.cost;
}

function applyTechEffects(techId, gameState) {
    const tech = TECH_TREE[techId];
    const effects = tech.effects;
    
    // Create a new state with applied effects
    const newState = { ...gameState };
    
    if (effects.analysisSpeed !== undefined) {
        newState.analysisSpeed = (gameState.analysisSpeed || 1.0) * effects.analysisSpeed;
    }
    
    if (effects.researchSpeed !== undefined) {
        newState.researchSpeed = (gameState.researchSpeed || 1.0) + effects.researchSpeed;
    }
    
    if (effects.storageTemperature !== undefined) {
        newState.storageTemperature = effects.storageTemperature;
    }
    
    if (effects.storageCapacity !== undefined) {
        newState.storageCapacity = (gameState.storageCapacity || 0) + effects.storageCapacity;
    }
    
    if (effects.valueMultiplier !== undefined) {
        newState.valueMultiplier = (gameState.valueMultiplier || 1.0) * effects.valueMultiplier;
    }
    
    return newState;
}

function calculateSampleValue(sample, gameState) {
    const valueMultiplier = gameState.valueMultiplier || 1.0;
    const urgencyMultiplier = GAME_CONFIG.urgencyMultipliers[sample.urgency] || 1.0;
    const qualityMultiplier = GAME_CONFIG.qualityMultipliers[sample.quality] || 1.0;
    
    return Math.floor(sample.baseValue * valueMultiplier * urgencyMultiplier * qualityMultiplier);
}

function advanceDay(gameState) {
    const newState = { ...gameState, day: gameState.day + 1 };
    
    // Check for spoiled samples
    const updatedSamples = newState.samples.map(sample => {
        if (sample.status === 'pending' || sample.status === 'in_progress') {
            if (checkSampleSpoilage(newState, sample)) {
                return { ...sample, status: 'spoiled' };
            }
        }
        return sample;
    });
    
    newState.samples = updatedSamples;
    
    // Check for missed deadlines
    const updatedSamplesWithDeadlines = newState.samples.map(sample => {
        if (sample.status === 'pending' || sample.status === 'in_progress') {
            if (sample.deadline <= newState.day) {
                return { ...sample, status: 'failed' };
            }
        }
        return sample;
    });
    
    newState.samples = updatedSamplesWithDeadlines;
    
    return newState;
}

// Initial game state
function createInitialState() {
    return {
        id: uuidv4(),
        day: 1,
        money: GAME_CONFIG.initialMoney,
        reputation: GAME_CONFIG.initialReputation,
        
        // Laboratory properties
        storageCapacity: GAME_CONFIG.initialStorageCapacity,
        storageTemperature: GAME_CONFIG.initialStorageTemperature,
        analysisSpeed: GAME_CONFIG.initialAnalysisSpeed,
        researchSpeed: GAME_CONFIG.initialResearchSpeed,
        valueMultiplier: 1.0,
        
        // Progress tracking
        samples: [],
        inventory: [],
        researchedTechs: ['BASIC_ANALYSIS'], // Start with basic analysis
        currentResearch: null,
        researchProgress: 0,
        
        // Upgrade levels
        upgradeLevels: {
            STORAGE: 0,
            COOLING: 0,
            SCIENTIST: 0
        },
        
        // Game settings
        isPaused: false,
        gameSpeed: 1.0
    };
}

// Game state management
class GameState {
    constructor(initialState = null) {
        this.state = initialState || createInitialState();
        this.subscribers = [];
    }
    
    getState() {
        return { ...this.state };
    }
    
    subscribe(callback) {
        this.subscribers.push(callback);
        return () => {
            this.subscribers = this.subscribers.filter(sub => sub !== callback);
        };
    }
    
    update(updateFn) {
        const newState = updateFn(this.state);
        this.state = newState;
        this.notifySubscribers();
        return newState;
    }
    
    notifySubscribers() {
        this.subscribers.forEach(callback => {
            try {
                callback(this.state);
            } catch (error) {
                console.error('Error in subscriber:', error);
            }
        });
    }
    
    // Action creators
    acceptSample() {
        return this.update(state => {
            if (state.samples.length >= state.storageCapacity) {
                return state; // No room for more samples
            }
            
            const sample = generateSample(state);
            const newSamples = [...state.samples, sample];
            
            return { ...state, samples: newSamples };
        });
    }
    
    startSampleAnalysis(sampleId) {
        return this.update(state => {
            const updatedSamples = state.samples.map(sample => {
                if (sample.id === sampleId && sample.status === 'pending') {
                    return { ...sample, status: 'in_progress', analysisStartDay: state.day };
                }
                return sample;
            });
            
            return { ...state, samples: updatedSamples };
        });
    }
    
    completeSampleAnalysis(sampleId) {
        return this.update(state => {
            const sampleIndex = state.samples.findIndex(s => s.id === sampleId);
            if (sampleIndex === -1) return state;
            
            const sample = state.samples[sampleIndex];
            if (sample.status !== 'in_progress') return state;
            
            // Calculate analysis time
            const analysisTime = 1; // Base time in days
            const effectiveSpeed = state.analysisSpeed || 1.0;
            const requiredDays = Math.ceil(analysisTime / effectiveSpeed);
            
            // Check if analysis is complete
            if ((state.day - (sample.analysisStartDay || state.day)) >= requiredDays) {
                const sampleValue = calculateSampleValue(sample, state);
                
                const updatedSamples = [...state.samples];
                updatedSamples[sampleIndex] = { ...sample, status: 'completed' };
                
                return {
                    ...state,
                    samples: updatedSamples,
                    money: state.money + sampleValue,
                    reputation: state.reputation + GAME_CONFIG.successfulAnalysisReward
                };
            }
            
            return state;
        });
    }
    
    startResearch(techId) {
        return this.update(state => {
            // Check if tech is available for research
            const availableResearch = getAvailableResearch(state);
            const tech = availableResearch.find(t => t.id === techId);
            
            if (!tech) return state;
            if (state.money < tech.cost) return state;
            if (state.currentResearch) return state; // Already researching
            
            return {
                ...state,
                money: state.money - tech.cost,
                currentResearch: techId,
                researchProgress: 0
            };
        });
    }
    
    advanceResearch() {
        return this.update(state => {
            if (!state.currentResearch) return state;
            
            const tech = TECH_TREE[state.currentResearch];
            const requiredProgress = 100;
            const progressIncrement = (state.researchSpeed || 1.0) * 10; // 10% per day per research speed
            
            let newProgress = state.researchProgress + progressIncrement;
            
            if (newProgress >= requiredProgress) {
                // Research complete
                const newResearchedTechs = [...state.researchedTechs, state.currentResearch];
                const newState = applyTechEffects(state.currentResearch, { ...state, researchedTechs: newResearchedTechs });
                
                return {
                    ...newState,
                    currentResearch: null,
                    researchProgress: 0,
                    researchedTechs: newResearchedTechs,
                    reputation: state.reputation + GAME_CONFIG.techDiscoveryReward
                };
            } else {
                return {
                    ...state,
                    researchProgress: Math.min(newProgress, requiredProgress)
                };
            }
        });
    }
    
    upgradeLaboratory(upgradeType) {
        return this.update(state => {
            const upgrade = LAB_UPGRADES[upgradeType];
            if (!upgrade) return state;
            
            const currentLevel = state.upgradeLevels[upgradeType] || 0;
            const cost = upgrade.baseCost + (currentLevel * upgrade.costIncrement);
            
            if (state.money < cost) return state;
            
            const newUpgradeLevels = {
                ...state.upgradeLevels,
                [upgradeType]: currentLevel + 1
            };
            
            const upgradeEffect = upgrade.effect(currentLevel);
            
            return {
                ...state,
                money: state.money - cost,
                upgradeLevels: newUpgradeLevels,
                ...upgradeEffect
            };
        });
    }
    
    removeSample(sampleId) {
        return this.update(state => {
            const sampleIndex = state.samples.findIndex(s => s.id === sampleId);
            if (sampleIndex === -1) return state;
            
            const sample = state.samples[sampleIndex];
            const updatedSamples = [...state.samples];
            updatedSamples.splice(sampleIndex, 1);
            
            // Apply reputation penalty if sample failed or spoiled
            let reputationChange = 0;
            if (sample.status === 'failed') {
                reputationChange = -Math.floor(GAME_CONFIG.deadlinePenalty * state.reputation);
            } else if (sample.status === 'spoiled') {
                reputationChange = -Math.floor(GAME_CONFIG.spoilagePenalty * state.reputation);
            }
            
            return {
                ...state,
                samples: updatedSamples,
                reputation: Math.max(0, state.reputation + reputationChange)
            };
        });
    }
    
    // Time advancement
    tick(timeElapsed) {
        return this.update(state => {
            // Simplified time advancement
            const daysPassed = Math.floor(timeElapsed / GAME_CONFIG.dayDuration);
            let newState = { ...state };
            
            for (let i = 0; i < daysPassed; i++) {
                newState = advanceDay(newState);
                newState = { ...newState, day: newState.day + 1 };
                
                // Auto-advance research
                if (newState.currentResearch) {
                    newState = this.applyResearchToState(newState);
                }
                
                // Auto-complete samples that have been analyzed long enough
                newState.samples = newState.samples.map(sample => {
                    if (sample.status === 'in_progress' && sample.analysisStartDay) {
                        const analysisTime = 1; // Base time in days
                        const effectiveSpeed = newState.analysisSpeed || 1.0;
                        const requiredDays = Math.ceil(analysisTime / effectiveSpeed);
                        
                        if ((newState.day - sample.analysisStartDay) >= requiredDays) {
                            return { ...sample, status: 'completed' };
                        }
                    }
                    return sample;
                });
            }
            
            return newState;
        });
    }
    
    applyResearchToState(state) {
        const tech = TECH_TREE[state.currentResearch];
        const requiredProgress = 100;
        const progressIncrement = (state.researchSpeed || 1.0) * 10;
        
        let newProgress = state.researchProgress + progressIncrement;
        
        if (newProgress >= requiredProgress) {
            const newResearchedTechs = [...state.researchedTechs, state.currentResearch];
            let newState = applyTechEffects(state.currentResearch, { ...state, researchedTechs: newResearchedTechs });
            
            return {
                ...newState,
                currentResearch: null,
                researchProgress: 0,
                researchedTechs: newResearchedTechs,
                reputation: state.reputation + GAME_CONFIG.techDiscoveryReward
            };
        } else {
            return {
                ...state,
                researchProgress: Math.min(newProgress, requiredProgress)
            };
        }
    }
}

export {
    GameState,
    SAMPLE_TYPES,
    TECH_TREE,
    LAB_UPGRADES,
    STORAGE_TEMPS,
    GAME_CONFIG,
    createInitialState,
    generateSample,
    canStoreSample,
    checkSampleSpoilage,
    getAvailableResearch,
    getResearchCost,
    applyTechEffects,
    calculateSampleValue,
    advanceDay
};