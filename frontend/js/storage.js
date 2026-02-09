/**
 * ════════════════════════════════════════════════════════════════
 * STORAGE MANAGER
 * ════════════════════════════════════════════════════════════════
 * 
 * Handles all localStorage operations for persisting:
 * - Chat messages
 * - User settings
 * - Theme preference
 * 
 * Features:
 * - Automatic JSON serialization/deserialization
 * - Storage quota handling
 * - Cross-tab synchronization
 * - Data validation
 * - Error handling with fallbacks
 * 
 * ════════════════════════════════════════════════════════════════
 */


// ════════════════════════════════════════════════════════════════
// STORAGE KEYS
// ════════════════════════════════════════════════════════════════

const STORAGE_KEYS = {
    MESSAGES: 'kanyaraasi_messages',
    SETTINGS: 'kanyaraasi_settings',
    THEME: 'kanyaraasi_theme',
    LAST_ACTIVE: 'kanyaraasi_last_active'
};

// Default settings
const DEFAULT_SETTINGS = {
    apiUrl: 'http://localhost:8000',
    numSources: 5,
    autoScroll: true,
    soundEnabled: false
};


// ════════════════════════════════════════════════════════════════
// CORE STORAGE FUNCTIONS
// ════════════════════════════════════════════════════════════════

/**
 * Check if localStorage is available
 * @returns {boolean}
 */
function isStorageAvailable() {
    try {
        const testKey = '__storage_test__';
        localStorage.setItem(testKey, testKey);
        localStorage.removeItem(testKey);
        return true;
    } catch (e) {
        console.warn('localStorage is not available:', e);
        return false;
    }
}

/**
 * Safely get item from localStorage with JSON parsing
 * @param {string} key - Storage key
 * @param {*} defaultValue - Default value if key doesn't exist or parse fails
 * @returns {*}
 */
function getItem(key, defaultValue = null) {
    if (!isStorageAvailable()) {
        return defaultValue;
    }

    try {
        const item = localStorage.getItem(key);

        if (item === null) {
            return defaultValue;
        }

        return JSON.parse(item);
    } catch (error) {
        console.error(`Error reading from localStorage [${key}]:`, error);
        return defaultValue;
    }
}

/**
 * Safely set item in localStorage with JSON serialization
 * @param {string} key - Storage key
 * @param {*} value - Value to store (will be JSON stringified)
 * @returns {boolean} - Success status
 */
function setItem(key, value) {
    if (!isStorageAvailable()) {
        return false;
    }

    try {
        const serialized = JSON.stringify(value);
        localStorage.setItem(key, serialized);
        return true;
    } catch (error) {
        // Handle quota exceeded error
        if (error.name === 'QuotaExceededError' ||
            error.code === 22 ||
            error.code === 1014) {
            console.warn('localStorage quota exceeded. Attempting cleanup...');
            handleStorageQuotaExceeded(key);

            // Retry after cleanup
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (retryError) {
                console.error('Storage still full after cleanup:', retryError);
                return false;
            }
        }

        console.error(`Error writing to localStorage [${key}]:`, error);
        return false;
    }
}

/**
 * Remove item from localStorage
 * @param {string} key - Storage key
 * @returns {boolean} - Success status
 */
function removeItem(key) {
    if (!isStorageAvailable()) {
        return false;
    }

    try {
        localStorage.removeItem(key);
        return true;
    } catch (error) {
        console.error(`Error removing from localStorage [${key}]:`, error);
        return false;
    }
}

/**
 * Handle storage quota exceeded by removing old messages
 * @param {string} currentKey - Key that triggered the quota error
 */
function handleStorageQuotaExceeded(currentKey) {
    // If we're trying to save messages, remove oldest 20%
    if (currentKey === STORAGE_KEYS.MESSAGES) {
        const messages = getItem(STORAGE_KEYS.MESSAGES, []);
        if (messages.length > 0) {
            const removeCount = Math.ceil(messages.length * 0.2);
            const trimmedMessages = messages.slice(removeCount);
            localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(trimmedMessages));
            console.log(`Removed ${removeCount} old messages to free space`);
        }
    }
}


// ════════════════════════════════════════════════════════════════
// MESSAGE STORAGE
// ════════════════════════════════════════════════════════════════

/**
 * Get all stored messages
 * @returns {Array} - Array of message objects
 */
function getMessages() {
    return getItem(STORAGE_KEYS.MESSAGES, []);
}

/**
 * Save all messages (replaces existing)
 * @param {Array} messages - Array of message objects
 * @returns {boolean} - Success status
 */
function saveMessages(messages) {
    // Validate messages array
    if (!Array.isArray(messages)) {
        console.error('saveMessages: messages must be an array');
        return false;
    }

    // Limit to last 500 messages to prevent storage overflow
    const maxMessages = 500;
    const trimmedMessages = messages.slice(-maxMessages);

    return setItem(STORAGE_KEYS.MESSAGES, trimmedMessages);
}

/**
 * Add a single message to storage
 * @param {Object} message - Message object with role, content, timestamp
 * @returns {boolean} - Success status
 */
function addMessage(message) {
    // Validate message object
    if (!message || typeof message !== 'object') {
        console.error('addMessage: invalid message object');
        return false;
    }

    // Ensure required fields
    const validatedMessage = {
        id: message.id || Utils.generateId('msg'),
        role: message.role || 'user',
        content: message.content || '',
        timestamp: message.timestamp || Date.now(),
        sources: message.sources || []
    };

    const messages = getMessages();
    messages.push(validatedMessage);

    return saveMessages(messages);
}

/**
 * Clear all messages
 * @returns {boolean} - Success status
 */
function clearMessages() {
    return removeItem(STORAGE_KEYS.MESSAGES);
}

/**
 * Get message count
 * @returns {number}
 */
function getMessageCount() {
    return getMessages().length;
}


// ════════════════════════════════════════════════════════════════
// SETTINGS STORAGE
// ════════════════════════════════════════════════════════════════

/**
 * Get user settings with defaults
 * @returns {Object} - Settings object
 */
function getSettings() {
    const stored = getItem(STORAGE_KEYS.SETTINGS, {});
    // Merge with defaults to ensure all keys exist
    return { ...DEFAULT_SETTINGS, ...stored };
}

/**
 * Save user settings
 * @param {Object} settings - Settings object (partial or full)
 * @returns {boolean} - Success status
 */
function saveSettings(settings) {
    // Merge with existing settings
    const current = getSettings();
    const updated = { ...current, ...settings };

    // Validate specific settings
    if (updated.numSources < 1) updated.numSources = 1;
    if (updated.numSources > 10) updated.numSources = 10;

    if (updated.apiUrl && !Utils.isValidURL(updated.apiUrl)) {
        console.warn('Invalid API URL provided, keeping previous value');
        updated.apiUrl = current.apiUrl;
    }

    return setItem(STORAGE_KEYS.SETTINGS, updated);
}

/**
 * Get a specific setting
 * @param {string} key - Setting key
 * @returns {*} - Setting value
 */
function getSetting(key) {
    const settings = getSettings();
    return settings[key] !== undefined ? settings[key] : DEFAULT_SETTINGS[key];
}

/**
 * Reset settings to defaults
 * @returns {boolean} - Success status
 */
function resetSettings() {
    return setItem(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
}


// ════════════════════════════════════════════════════════════════
// THEME STORAGE
// ════════════════════════════════════════════════════════════════

/**
 * Get stored theme preference
 * @returns {string} - 'dark' or 'light'
 */
function getTheme() {
    const stored = getItem(STORAGE_KEYS.THEME, null);

    if (stored === 'dark' || stored === 'light') {
        return stored;
    }

    // Default to system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light';
    }

    return 'dark';
}

/**
 * Save theme preference
 * @param {string} theme - 'dark' or 'light'
 * @returns {boolean} - Success status
 */
function saveTheme(theme) {
    if (theme !== 'dark' && theme !== 'light') {
        console.error('saveTheme: theme must be "dark" or "light"');
        return false;
    }

    return setItem(STORAGE_KEYS.THEME, theme);
}

/**
 * Toggle theme between dark and light
 * @returns {string} - New theme
 */
function toggleTheme() {
    const current = getTheme();
    const newTheme = current === 'dark' ? 'light' : 'dark';
    saveTheme(newTheme);
    return newTheme;
}


// ════════════════════════════════════════════════════════════════
// CROSS-TAB SYNCHRONIZATION
// ════════════════════════════════════════════════════════════════

/**
 * Set up storage event listener for cross-tab sync
 * @param {Function} onMessagesChange - Callback when messages change in another tab
 * @param {Function} onThemeChange - Callback when theme changes in another tab
 */
function setupStorageSync(onMessagesChange, onThemeChange) {
    window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEYS.MESSAGES && onMessagesChange) {
            const newMessages = event.newValue ? JSON.parse(event.newValue) : [];
            onMessagesChange(newMessages);
        }

        if (event.key === STORAGE_KEYS.THEME && onThemeChange) {
            const newTheme = event.newValue ? JSON.parse(event.newValue) : 'dark';
            onThemeChange(newTheme);
        }
    });
}


// ════════════════════════════════════════════════════════════════
// SESSION TRACKING
// ════════════════════════════════════════════════════════════════

/**
 * Update last active timestamp
 */
function updateLastActive() {
    setItem(STORAGE_KEYS.LAST_ACTIVE, Date.now());
}

/**
 * Get last active timestamp
 * @returns {number|null}
 */
function getLastActive() {
    return getItem(STORAGE_KEYS.LAST_ACTIVE, null);
}

/**
 * Check if this is a new session (more than 30 min since last active)
 * @returns {boolean}
 */
function isNewSession() {
    const lastActive = getLastActive();
    if (!lastActive) return true;

    const thirtyMinutes = 30 * 60 * 1000;
    return Date.now() - lastActive > thirtyMinutes;
}


// ════════════════════════════════════════════════════════════════
// STORAGE INFO
// ════════════════════════════════════════════════════════════════

/**
 * Get storage usage statistics
 * @returns {Object} - { used, total, percentage }
 */
function getStorageStats() {
    if (!isStorageAvailable()) {
        return { used: 0, total: 0, percentage: 0 };
    }

    let used = 0;

    // Calculate used storage
    for (const key of Object.values(STORAGE_KEYS)) {
        const item = localStorage.getItem(key);
        if (item) {
            used += item.length * 2; // UTF-16 = 2 bytes per char
        }
    }

    // Most browsers have 5MB limit
    const total = 5 * 1024 * 1024;
    const percentage = Math.round((used / total) * 100);

    return {
        used,
        total,
        percentage,
        usedFormatted: formatBytes(used),
        totalFormatted: formatBytes(total)
    };
}

/**
 * Format bytes to human readable string
 * @param {number} bytes 
 * @returns {string}
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}


// ════════════════════════════════════════════════════════════════
// EXPORT FOR USE IN OTHER MODULES
// ════════════════════════════════════════════════════════════════

window.Storage = {
    // Core
    isStorageAvailable,
    getItem,
    setItem,
    removeItem,

    // Messages
    getMessages,
    saveMessages,
    addMessage,
    clearMessages,
    getMessageCount,

    // Settings
    getSettings,
    saveSettings,
    getSetting,
    resetSettings,
    DEFAULT_SETTINGS,

    // Theme
    getTheme,
    saveTheme,
    toggleTheme,

    // Sync
    setupStorageSync,

    // Session
    updateLastActive,
    getLastActive,
    isNewSession,

    // Stats
    getStorageStats
};
