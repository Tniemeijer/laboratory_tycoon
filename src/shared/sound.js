/**
 * Sound manager for Laboratory Management Game
 * Uses Web Audio API for sound effects
 */

class SoundManager {
    constructor() {
        this.enabled = true;
        this.volume = 0.7;
        this.audioContext = null;
        this.sounds = {};
        
        // Sound definitions - frequencies and durations for procedurally generated sounds
        this.soundDefs = {
            sampleAccept: {
                type: 'tone',
                frequency: 800,
                duration: 0.1,
                envelope: { attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 }
            },
            sampleComplete: {
                type: 'tone',
                frequency: 1000,
                duration: 0.2,
                envelope: { attack: 0.01, decay: 0.1, sustain: 0.1, release: 0.2 }
            },
            sampleFail: {
                type: 'tone',
                frequency: 200,
                duration: 0.3,
                envelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.2 }
            },
            sampleSpoil: {
                type: 'tone',
                frequency: 150,
                duration: 0.4,
                envelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.3 }
            },
            researchStart: {
                type: 'tone',
                frequency: 600,
                duration: 0.15,
                envelope: { attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 }
            },
            researchComplete: {
                type: 'chord',
                frequencies: [523.25, 659.25, 783.99], // C5, E5, G5
                duration: 0.3,
                envelope: { attack: 0.01, decay: 0.2, sustain: 0.1, release: 0.2 }
            },
            upgrade: {
                type: 'chord',
                frequencies: [440, 550, 660], // A4, C#5, E5
                duration: 0.2,
                envelope: { attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 }
            },
            money: {
                type: 'tone',
                frequency: 1200,
                duration: 0.08,
                envelope: { attack: 0.01, decay: 0.05, sustain: 0, release: 0.05 }
            },
            error: {
                type: 'noise',
                duration: 0.2,
                envelope: { attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 }
            }
        };
        
        this.init();
    }
    
    init() {
        try {
            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (error) {
            console.warn('Web Audio API not available, sounds disabled');
            this.enabled = false;
        }
    }
    
    play(soundName, options = {}) {
        if (!this.enabled || !this.audioContext) return;
        
        const def = this.soundDefs[soundName];
        if (!def) {
            console.warn(`Sound '${soundName}' not found`);
            return;
        }
        
        const now = this.audioContext.currentTime;
        const volume = options.volume !== undefined ? options.volume : this.volume;
        
        let oscillator;
        let gainNode = this.audioContext.createGain();
        
        // Set up envelope
        const attack = def.envelope.attack || 0.01;
        const decay = def.envelope.decay || 0.1;
        const sustain = def.envelope.sustain !== undefined ? def.envelope.sustain : 0;
        const release = def.envelope.release || 0.1;
        const duration = def.duration || 0.1;
        
        // Set gain envelope
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(volume, now + attack);
        gainNode.gain.linearRampToValueAtTime(volume * sustain, now + attack + decay);
        gainNode.gain.linearRampToValueAtTime(0, now + attack + decay + duration + release);
        
        if (def.type === 'tone') {
            oscillator = this.audioContext.createOscillator();
            oscillator.type = options.waveform || 'sine';
            oscillator.frequency.setValueAtTime(def.frequency, now);
            
            // Add optional frequency modulation
            if (options.modulation) {
                const modOsc = this.audioContext.createOscillator();
                modOsc.type = 'sine';
                modOsc.frequency.setValueAtTime(options.modulation.speed || 5, now);
                
                const modGain = this.audioContext.createGain();
                modGain.gain.setValueAtTime(options.modulation.depth || 50, now);
                
                modOsc.connect(modGain);
                modGain.connect(oscillator.frequency);
                modOsc.start(now);
                modOsc.stop(now + attack + decay + duration + release);
            }
            
            oscillator.connect(gainNode);
            oscillator.start(now);
            oscillator.stop(now + attack + decay + duration + release);
            
        } else if (def.type === 'chord') {
            // Create multiple oscillators for chord
            def.frequencies.forEach(freq => {
                const osc = this.audioContext.createOscillator();
                osc.type = options.waveform || 'sine';
                osc.frequency.setValueAtTime(freq, now);
                osc.connect(gainNode);
                osc.start(now);
                osc.stop(now + attack + decay + duration + release);
            });
            
        } else if (def.type === 'noise') {
            // White noise
            const bufferSize = this.audioContext.sampleRate * duration;
            const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
            const data = buffer.getChannelData(0);
            
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            
            const noise = this.audioContext.createBufferSource();
            noise.buffer = buffer;
            noise.connect(gainNode);
            noise.start(now);
            noise.stop(now + attack + decay + duration + release);
        }
        
        gainNode.connect(this.audioContext.destination);
    }
    
    setEnabled(enabled) {
        this.enabled = enabled;
    }
    
    setVolume(volume) {
        this.volume = Math.min(1, Math.max(0, volume));
    }
    
    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }
    
    // Convenience methods for game events
    playSampleAccept() {
        this.play('sampleAccept', { waveform: 'sine' });
    }
    
    playSampleComplete() {
        this.play('sampleComplete', { waveform: 'sine' });
    }
    
    playSampleFail() {
        this.play('sampleFail', { waveform: 'sawtooth' });
    }
    
    playSampleSpoil() {
        this.play('sampleSpoil', { waveform: 'square' });
    }
    
    playResearchStart() {
        this.play('researchStart', { waveform: 'sine' });
    }
    
    playResearchComplete() {
        this.play('researchComplete', { waveform: 'sine' });
    }
    
    playUpgrade() {
        this.play('upgrade', { waveform: 'sine' });
    }
    
    playMoney() {
        this.play('money', { waveform: 'sine' });
    }
    
    playError() {
        this.play('error');
    }
    
    cleanup() {
        if (this.audioContext) {
            try {
                this.audioContext.close();
            } catch (error) {
                console.warn('Error closing audio context:', error);
            }
            this.audioContext = null;
        }
    }
}

// Singleton instance
const soundManager = new SoundManager();

export default soundManager;
export { SoundManager };