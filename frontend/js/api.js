/**
 * ════════════════════════════════════════════════════════════════
 * API COMMUNICATION LAYER
 * ════════════════════════════════════════════════════════════════
 * 
 * Handles all HTTP communication with the FastAPI backend.
 * 
 * Features:
 * - Request/response handling with proper error management
 * - Timeout handling (30 second default)
 * - Retry logic for transient failures
 * - Request cancellation via AbortController
 * - Rate limiting protection
 * - Health check functionality
 * 
 * Backend Endpoints:
 * - GET  /          - Welcome message
 * - GET  /health    - Health check
 * - POST /ask       - Ask question, get AI answer with sources
 * - POST /search    - Search documents without AI answer
 * 
 * ════════════════════════════════════════════════════════════════
 */


// ════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════

const API_CONFIG = {
    get baseUrl() {
        // 1. config.js override — set BACKEND_URL when frontend and backend are on different hosts
        // 2. Same origin — works when served together (Render / local backend)
        // 3. Localhost fallback for plain file:// dev
        const configured = (typeof APP_CONFIG !== 'undefined') && APP_CONFIG.BACKEND_URL;
        if (configured) return APP_CONFIG.BACKEND_URL.replace(/\/$/, '');
        if (window.location.protocol !== 'file:') return window.location.origin;
        return 'http://localhost:8000';
    },
    timeout: 60000,          // 30 seconds - AI responses can take time
    retryAttempts: 2,        // Number of retry attempts for failed requests
    retryDelay: 1000,        // Delay between retries in ms
    healthCheckInterval: 30000  // Health check every 30 seconds
};

// Track active requests for cancellation
const activeRequests = new Map();


// ════════════════════════════════════════════════════════════════
// CORE REQUEST FUNCTION
// ════════════════════════════════════════════════════════════════

/**
 * Make an HTTP request with timeout, error handling, and retry logic
 * 
 * @param {string} endpoint - API endpoint (e.g., '/ask')
 * @param {Object} options - Fetch options
 * @param {Object} config - Additional configuration
 * @returns {Promise<Object>} - Response data
 * @throws {APIError} - On failure
 */
async function request(endpoint, options = {}, config = {}) {
    const {
        timeout = API_CONFIG.timeout,
        retries = API_CONFIG.retryAttempts,
        requestId = Utils.generateId('req')
    } = config;

    const url = `${API_CONFIG.baseUrl}${endpoint}`;

    // Create AbortController for timeout and cancellation
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Store controller for potential cancellation
    activeRequests.set(requestId, controller);

    // Default headers
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers
    };

    const fetchOptions = {
        ...options,
        headers,
        signal: controller.signal
    };

    let lastError = null;

    // Retry loop
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, fetchOptions);

            // Clear timeout on successful response
            clearTimeout(timeoutId);
            activeRequests.delete(requestId);

            // Handle HTTP errors
            if (!response.ok) {
                const errorData = await parseErrorResponse(response);
                throw new APIError(
                    errorData.message || `HTTP ${response.status}`,
                    response.status,
                    errorData
                );
            }

            // Parse JSON response
            const data = await response.json();
            return data;

        } catch (error) {
            lastError = error;

            // Don't retry on abort (timeout or manual cancellation)
            if (error.name === 'AbortError') {
                clearTimeout(timeoutId);
                activeRequests.delete(requestId);
                throw new APIError(
                    'Request timed out. Please try again.',
                    408,
                    { type: 'timeout' }
                );
            }

            // Don't retry on client errors (4xx)
            if (error instanceof APIError && error.status >= 400 && error.status < 500) {
                throw error;
            }

            // Retry on network errors or server errors (5xx)
            if (attempt < retries) {
                console.log(`Request failed, retrying (${attempt + 1}/${retries})...`);
                await sleep(API_CONFIG.retryDelay * (attempt + 1)); // Exponential backoff
                continue;
            }
        }
    }

    // All retries exhausted
    clearTimeout(timeoutId);
    activeRequests.delete(requestId);

    if (lastError instanceof APIError) {
        throw lastError;
    }

    throw new APIError(
        'Unable to connect to server. Please check your connection.',
        0,
        { type: 'network', originalError: lastError }
    );
}

/**
 * Parse error response from server
 * @param {Response} response 
 * @returns {Object}
 */
async function parseErrorResponse(response) {
    try {
        const data = await response.json();
        return {
            message: data.detail || data.message || data.error || 'An error occurred',
            ...data
        };
    } catch {
        return {
            message: `Server error (${response.status})`
        };
    }
}

/**
 * Custom API Error class
 */
class APIError extends Error {
    constructor(message, status, data = {}) {
        super(message);
        this.name = 'APIError';
        this.status = status;
        this.data = data;
    }

    /**
     * Get user-friendly error message
     * @returns {string}
     */
    getUserMessage() {
        switch (this.status) {
            case 0:
                return 'Cannot connect to server. Is the backend running?';
            case 400:
                return 'Invalid request. Please check your input.';
            case 404:
                return 'The requested resource was not found.';
            case 408:
                return 'Request timed out. The AI is taking too long to respond.';
            case 429:
                return 'Too many requests. Please wait a moment before trying again.';
            case 500:
                return 'Server error. ' + (this.message || 'Please try again later.');
            case 503:
                return 'Service temporarily unavailable. Please try again later.';
            default:
                return this.message || 'An unexpected error occurred.';
        }
    }
}


// ════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ════════════════════════════════════════════════════════════════

/**
 * Check API health status
 * @returns {Promise<{status: string, connected: boolean}>}
 */
async function checkHealth() {
    try {
        const data = await request('/health', { method: 'GET' }, {
            timeout: 5000,
            retries: 0
        });
        return { status: data.status, connected: true };
    } catch (error) {
        console.error('Health check failed:', error);
        return { status: 'disconnected', connected: false, error: error.message };
    }
}

/**
 * Ask a question and get AI-generated answer with streaming support
 * 
 * @param {string} query - User's question
 * @param {number} k - Number of documents to retrieve (default: 5)
 * @param {Array} conversationHistory - Previous conversation context
 * @param {Function} onChunk - Callback for streaming chunks
 * @returns {Promise<{question: string, answer: string, sources: string[]}>}
 */
async function askQuestion(query, k = null, conversationHistory = [], onChunk = null) {
    // Validate input
    const validation = Utils.validateMessage(query);
    if (!validation.valid) {
        throw new APIError(validation.error, 400, { type: 'validation' });
    }

    // Use default k if not provided
    if (k === null) {
        k = 5;
    }

    const url = `${API_CONFIG.baseUrl}/ask`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);
    
    activeRequests.set('ask-question', controller);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/plain'
            },
            body: JSON.stringify({
                query: query.trim(),
                k: k,
                conversation_history: conversationHistory
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        activeRequests.delete('ask-question');

        if (!response.ok) {
            const errorData = await parseErrorResponse(response);
            throw new APIError(
                errorData.message || `HTTP ${response.status}`,
                response.status,
                errorData
            );
        }

        // Handle streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullAnswer = '';
        const FOOTER_MARKER = '\n\n---\nSources:';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            fullAnswer += chunk;

            // Show only the answer portion (before the sources footer) while streaming
            if (onChunk) {
                const footerIndex = fullAnswer.indexOf(FOOTER_MARKER);
                const visibleContent = footerIndex !== -1
                    ? fullAnswer.slice(0, footerIndex)
                    : fullAnswer;
                onChunk(visibleContent, true); // true = replace mode
            }
        }

        // Parse sources from the footer
        const footerIndex = fullAnswer.indexOf(FOOTER_MARKER);
        const answerPart = footerIndex !== -1 ? fullAnswer.slice(0, footerIndex).trim() : fullAnswer.trim();
        const footerPart = footerIndex !== -1 ? fullAnswer.slice(footerIndex) : '';

        const sourcesMatch = footerPart.match(/Sources: ([^\n]+)/);
        const sources = sourcesMatch
            ? sourcesMatch[1].split(',').map(s => s.trim()).filter(Boolean)
            : [];

        if (!answerPart) {
            throw new APIError('The AI returned an empty response. Please try again.', 500, { type: 'empty_response' });
        }

        return {
            question: query,
            answer: answerPart,
            sources: sources,
            fullAnswer: fullAnswer
        };

    } catch (error) {
        clearTimeout(timeoutId);
        activeRequests.delete('ask-question');

        if (error.name === 'AbortError') {
            throw new APIError('Request timed out. Please try again.', 408, { type: 'timeout' });
        }

        if (error instanceof APIError) {
            throw error;
        }

        throw new APIError(
            'Unable to connect to server. Please check your connection.',
            0,
            { type: 'network', originalError: error }
        );
    }
}

/**
 * Search for relevant documents without AI answer
 * 
 * @param {string} query - Search query
 * @param {number} k - Number of documents to retrieve
 * @returns {Promise<{query: string, results: Array}>}
 */
async function searchDocuments(query, k = 5) {
    const validation = Utils.validateMessage(query);
    if (!validation.valid) {
        throw new APIError(validation.error, 400, { type: 'validation' });
    }

    const response = await request('/search', {
        method: 'POST',
        body: JSON.stringify({
            query: query.trim(),
            k: k
        })
    });

    return {
        query: response.query,
        results: response.results || []
    };
}

/**
 * Get API welcome/info message
 * @returns {Promise<Object>}
 */
async function getApiInfo() {
    return await request('/', { method: 'GET' });
}


// ════════════════════════════════════════════════════════════════
// REQUEST MANAGEMENT
// ════════════════════════════════════════════════════════════════

/**
 * Cancel a specific request by ID
 * @param {string} requestId 
 */
function cancelRequest(requestId) {
    const controller = activeRequests.get(requestId);
    if (controller) {
        controller.abort();
        activeRequests.delete(requestId);
        console.log(`Request ${requestId} cancelled`);
    }
}

/**
 * Cancel all active requests
 */
function cancelAllRequests() {
    activeRequests.forEach((controller, requestId) => {
        controller.abort();
        console.log(`Request ${requestId} cancelled`);
    });
    activeRequests.clear();
}

/**
 * Check if there are any active requests
 * @returns {boolean}
 */
function hasActiveRequests() {
    return activeRequests.size > 0;
}

/**
 * Get count of active requests
 * @returns {number}
 */
function getActiveRequestCount() {
    return activeRequests.size;
}


// ════════════════════════════════════════════════════════════════
// HEALTH CHECK MONITORING
// ════════════════════════════════════════════════════════════════

let healthCheckTimer = null;
let healthCheckCallbacks = [];

/**
 * Start periodic health checks
 * @param {Function} callback - Called with health status on each check
 */
function startHealthCheck(callback) {
    if (callback) {
        healthCheckCallbacks.push(callback);
    }

    // Stop existing timer
    stopHealthCheck();

    // Perform immediate check
    performHealthCheck();

    // Set up periodic check
    healthCheckTimer = setInterval(performHealthCheck, API_CONFIG.healthCheckInterval);
}

/**
 * Stop periodic health checks
 */
function stopHealthCheck() {
    if (healthCheckTimer) {
        clearInterval(healthCheckTimer);
        healthCheckTimer = null;
    }
}

/**
 * Perform a single health check and notify callbacks
 */
async function performHealthCheck() {
    const status = await checkHealth();
    healthCheckCallbacks.forEach(callback => {
        try {
            callback(status);
        } catch (error) {
            console.error('Health check callback error:', error);
        }
    });
}

/**
 * Remove a health check callback
 * @param {Function} callback 
 */
function removeHealthCheckCallback(callback) {
    healthCheckCallbacks = healthCheckCallbacks.filter(cb => cb !== callback);
}


// ════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ════════════════════════════════════════════════════════════════

/**
 * Sleep for specified milliseconds
 * @param {number} ms 
 * @returns {Promise}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


// ════════════════════════════════════════════════════════════════
// EXPORT FOR USE IN OTHER MODULES
// ════════════════════════════════════════════════════════════════

window.API = {
    // Configuration
    config: API_CONFIG,

    // Core
    request,
    APIError,

    // Endpoints
    checkHealth,
    askQuestion,
    searchDocuments,
    getApiInfo,

    // Request Management
    cancelRequest,
    cancelAllRequests,
    hasActiveRequests,
    getActiveRequestCount,

    // Health Monitoring
    startHealthCheck,
    stopHealthCheck,
    performHealthCheck,
    removeHealthCheckCallback
};
