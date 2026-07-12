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
    SESSIONS: 'kanyaraasi_sessions',       // { [id]: { id, title, createdAt, updatedAt } }
    MESSAGES: 'kanyaraasi_msgs_',          // prefix + sessionId => message[]
    ACTIVE_SESSION: 'kanyaraasi_active',   // currently open session id
    SETTINGS: 'kanyaraasi_settings',
    THEME: 'kanyaraasi_theme',
    LAST_ACTIVE: 'kanyaraasi_last_active'
};

const DEFAULT_SETTINGS = {
    apiUrl: '',
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
// SESSION MANAGEMENT
// ════════════════════════════════════════════════════════════════

function getSessions() {
    return getItem(STORAGE_KEYS.SESSIONS, {});
}

function saveSessions(sessions) {
    return setItem(STORAGE_KEYS.SESSIONS, sessions);
}

function getActiveSessionId() {
    return getItem(STORAGE_KEYS.ACTIVE_SESSION, null);
}

function setActiveSessionId(id) {
    return setItem(STORAGE_KEYS.ACTIVE_SESSION, id);
}

function createSession(title) {
    const id = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const session = { id, title: title || 'New chat', createdAt: Date.now(), updatedAt: Date.now() };
    const sessions = getSessions();
    sessions[id] = session;
    saveSessions(sessions);
    setActiveSessionId(id);
    return session;
}

function updateSessionTitle(sessionId, title) {
    const sessions = getSessions();
    if (sessions[sessionId]) {
        sessions[sessionId].title = title;
        sessions[sessionId].updatedAt = Date.now();
        saveSessions(sessions);
    }
}

function deleteSession(sessionId) {
    const sessions = getSessions();
    delete sessions[sessionId];
    saveSessions(sessions);
    removeItem(STORAGE_KEYS.MESSAGES + sessionId);
    if (getActiveSessionId() === sessionId) {
        const remaining = Object.keys(sessions);
        setActiveSessionId(remaining.length > 0 ? remaining[remaining.length - 1] : null);
    }
}

function getSessionList() {
    const sessions = getSessions();
    return Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt);
}


// ════════════════════════════════════════════════════════════════
// MESSAGE STORAGE (session-scoped)
// ════════════════════════════════════════════════════════════════

function getMessages(sessionId) {
    if (!sessionId) return [];
    return getItem(STORAGE_KEYS.MESSAGES + sessionId, []);
}

function saveMessages(sessionId, messages) {
    if (!sessionId || !Array.isArray(messages)) return false;
    const trimmed = messages.slice(-300);
    // Auto-update session updatedAt
    const sessions = getSessions();
    if (sessions[sessionId]) {
        sessions[sessionId].updatedAt = Date.now();
        saveSessions(sessions);
    }
    return setItem(STORAGE_KEYS.MESSAGES + sessionId, trimmed);
}

function addMessage(sessionId, message) {
    if (!message || typeof message !== 'object') return false;
    const validated = {
        id: message.id || Utils.generateId('msg'),
        role: message.role || 'user',
        content: message.content || '',
        timestamp: message.timestamp || Date.now(),
        sources: message.sources || []
    };
    const messages = getMessages(sessionId);
    messages.push(validated);
    return saveMessages(sessionId, messages);
}

function clearMessages(sessionId) {
    if (!sessionId) return false;
    return saveMessages(sessionId, []);
}

function updateMessage(sessionId, messageId, updatedMessage) {
    const messages = getMessages(sessionId);
    const index = messages.findIndex(m => m.id === messageId);
    if (index !== -1) {
        messages[index] = updatedMessage;
        return saveMessages(sessionId, messages);
    }
    return false;
}

function deleteMessage(sessionId, messageId) {
    const messages = getMessages(sessionId);
    return saveMessages(sessionId, messages.filter(m => m.id !== messageId));
}

function getMessageCount(sessionId) {
    return getMessages(sessionId).length;
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

    // Sessions
    getSessions,
    createSession,
    updateSessionTitle,
    deleteSession,
    getSessionList,
    getActiveSessionId,
    setActiveSessionId,

    // Messages (session-scoped)
    getMessages,
    saveMessages,
    addMessage,
    updateMessage,
    deleteMessage,
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

    // Session tracking
    updateLastActive,
    getLastActive,
    isNewSession,

    // Stats
    getStorageStats
};
