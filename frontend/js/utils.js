/**
 * ════════════════════════════════════════════════════════════════
 * UTILITY FUNCTIONS
 * ════════════════════════════════════════════════════════════════
 * 
 * Collection of helper functions used throughout the application.
 * These are pure functions with no side effects (mostly).
 * 
 * Contents:
 * 1. DOM Utilities
 * 2. String Utilities
 * 3. Date/Time Utilities
 * 4. Validation Utilities
 * 5. Markdown Parser
 * 6. Debounce & Throttle
 * 7. Copy to Clipboard
 * 8. Export Utilities
 */


// ════════════════════════════════════════════════════════════════
// 1. DOM UTILITIES
// ════════════════════════════════════════════════════════════════

/**
 * Shorthand for document.querySelector
 * @param {string} selector - CSS selector
 * @param {Element} parent - Optional parent element (defaults to document)
 * @returns {Element|null}
 */
function $(selector, parent = document) {
    return parent.querySelector(selector);
}

/**
 * Shorthand for document.querySelectorAll, returns array
 * @param {string} selector - CSS selector
 * @param {Element} parent - Optional parent element
 * @returns {Element[]}
 */
function $$(selector, parent = document) {
    return Array.from(parent.querySelectorAll(selector));
}

/**
 * Create an element with optional attributes and children
 * @param {string} tag - HTML tag name
 * @param {Object} attrs - Attributes to set
 * @param {(string|Element)[]} children - Child elements or text
 * @returns {Element}
 * 
 * @example
 * createElement('div', { class: 'message', id: 'msg-1' }, [
 *     createElement('p', {}, ['Hello World']),
 *     'Some text'
 * ]);
 */
function createElement(tag, attrs = {}, children = []) {
    const element = document.createElement(tag);

    // Set attributes
    Object.entries(attrs).forEach(([key, value]) => {
        if (key === 'class') {
            // Handle class as string or array
            const classes = Array.isArray(value) ? value : value.split(' ');
            element.classList.add(...classes.filter(c => c));
        } else if (key === 'dataset') {
            // Handle data attributes
            Object.entries(value).forEach(([dataKey, dataValue]) => {
                element.dataset[dataKey] = dataValue;
            });
        } else if (key.startsWith('on') && typeof value === 'function') {
            // Handle event listeners
            const event = key.slice(2).toLowerCase();
            element.addEventListener(event, value);
        } else if (key === 'style' && typeof value === 'object') {
            // Handle style object
            Object.assign(element.style, value);
        } else {
            element.setAttribute(key, value);
        }
    });

    // Append children
    children.forEach(child => {
        if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
        } else if (child instanceof Element) {
            element.appendChild(child);
        }
    });

    return element;
}

/**
 * Remove all children from an element
 * @param {Element} element 
 */
function clearChildren(element) {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}


// ════════════════════════════════════════════════════════════════
// 2. STRING UTILITIES
// ════════════════════════════════════════════════════════════════

/**
 * Sanitize HTML to prevent XSS attacks
 * Escapes < > & " ' characters
 * @param {string} str - String to sanitize
 * @returns {string}
 */
function sanitizeHTML(str) {
    if (typeof str !== 'string') return '';

    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    };

    return str.replace(/[&<>"']/g, char => map[char]);
}

/**
 * Truncate string to max length with ellipsis
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string}
 */
function truncate(str, maxLength) {
    if (!str || str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
}

/**
 * Generate a unique ID
 * @param {string} prefix - Optional prefix
 * @returns {string}
 */
function generateId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Strip HTML tags from a string
 * @param {string} html 
 * @returns {string}
 */
function stripHTML(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return temp.textContent || temp.innerText || '';
}


// ════════════════════════════════════════════════════════════════
// 3. DATE/TIME UTILITIES
// ════════════════════════════════════════════════════════════════

/**
 * Format timestamp to relative time (e.g., "2 minutes ago")
 * @param {Date|number|string} timestamp 
 * @returns {string}
 */
function formatRelativeTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) {
        return 'just now';
    } else if (diffInSeconds < 3600) {
        const minutes = Math.floor(diffInSeconds / 60);
        return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    } else if (diffInSeconds < 86400) {
        const hours = Math.floor(diffInSeconds / 3600);
        return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    } else if (diffInSeconds < 604800) {
        const days = Math.floor(diffInSeconds / 86400);
        return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    } else {
        // For older messages, show the actual date
        return formatTime(date);
    }
}

/**
 * Format timestamp to HH:MM format
 * @param {Date|number|string} timestamp 
 * @returns {string}
 */
function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Format timestamp to full date-time
 * @param {Date|number|string} timestamp 
 * @returns {string}
 */
function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}


// ════════════════════════════════════════════════════════════════
// 4. VALIDATION UTILITIES
// ════════════════════════════════════════════════════════════════

/**
 * Validate URL format
 * @param {string} url 
 * @returns {boolean}
 */
function isValidURL(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if a string is empty or only whitespace
 * @param {string} str 
 * @returns {boolean}
 */
function isEmpty(str) {
    return !str || str.trim().length === 0;
}

/**
 * Validate message input
 * @param {string} message 
 * @param {number} maxLength 
 * @returns {{valid: boolean, error: string|null}}
 */
function validateMessage(message, maxLength = 2000) {
    if (isEmpty(message)) {
        return { valid: false, error: 'Message cannot be empty' };
    }

    if (message.length > maxLength) {
        return { valid: false, error: `Message too long (max ${maxLength} characters)` };
    }

    return { valid: true, error: null };
}


// ════════════════════════════════════════════════════════════════
// 5. MARKDOWN PARSER (Simple)
// ════════════════════════════════════════════════════════════════

/**
 * Parse simple markdown to HTML
 * Supports: **bold**, *italic*, `code`, ```code blocks```, lists, and links
 * 
 * SECURITY: Input should be sanitized BEFORE passing to this function
 * 
 * @param {string} text - Pre-sanitized text
 * @returns {string} - HTML string
 */
function parseMarkdown(text) {
    if (!text) return '';

    // First, sanitize the input
    let html = sanitizeHTML(text);

    // Code blocks (```code```) - must be done first to prevent other parsing inside
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

    // Inline code (`code`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold (**text** or __text__)
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Italic (*text* or _text_)
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Convert newlines to line breaks for paragraph-like content,
    // but preserve existing structure
    const lines = html.split('\n');
    const processedLines = [];
    let inList = false;

    lines.forEach((line, index) => {
        const trimmed = line.trim();

        // Unordered list items (- item or * item)
        if (/^[-*]\s+/.test(trimmed)) {
            if (!inList) {
                processedLines.push('<ul>');
                inList = true;
            }
            const listContent = trimmed.replace(/^[-*]\s+/, '');
            processedLines.push(`<li>${listContent}</li>`);
        }
        // Numbered list items (1. item)
        else if (/^\d+\.\s+/.test(trimmed)) {
            if (!inList) {
                processedLines.push('<ol>');
                inList = true;
            }
            const listContent = trimmed.replace(/^\d+\.\s+/, '');
            processedLines.push(`<li>${listContent}</li>`);
        }
        // Regular line
        else {
            if (inList) {
                // Close the previous list
                const lastPush = processedLines[processedLines.length - 2];
                if (lastPush === '<ul>') {
                    processedLines.push('</ul>');
                } else {
                    processedLines.push('</ol>');
                }
                inList = false;
            }

            // Convert empty lines to paragraph breaks
            if (trimmed === '') {
                if (index > 0 && index < lines.length - 1) {
                    processedLines.push('<br><br>');
                }
            } else {
                processedLines.push(line);
            }
        }
    });

    // Close any open list
    if (inList) {
        const listType = processedLines.find(l => l === '<ul>' || l === '<ol>');
        processedLines.push(listType === '<ul>' ? '</ul>' : '</ol>');
    }

    html = processedLines.join('\n');

    // Convert remaining newlines to <br> for non-list content
    // But avoid adding <br> inside <pre> blocks
    html = html.replace(/\n(?![^<]*<\/pre>)/g, '<br>');

    // Clean up multiple consecutive <br>s
    html = html.replace(/(<br>){3,}/g, '<br><br>');

    return html;
}


// ════════════════════════════════════════════════════════════════
// 6. DEBOUNCE & THROTTLE
// ════════════════════════════════════════════════════════════════

/**
 * Debounce function - delays execution until after wait ms have passed
 * since the last invocation. Useful for search inputs, resize handlers.
 * 
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function}
 * 
 * @example
 * const debouncedSearch = debounce(search, 300);
 * input.addEventListener('input', debouncedSearch);
 */
function debounce(func, wait) {
    let timeout;

    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func.apply(this, args);
        };

        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function - limits execution to at most once per wait ms.
 * Useful for scroll handlers, mousemove handlers.
 * 
 * @param {Function} func - Function to throttle
 * @param {number} wait - Wait time in ms
 * @returns {Function}
 */
function throttle(func, wait) {
    let lastTime = 0;

    return function executedFunction(...args) {
        const now = Date.now();

        if (now - lastTime >= wait) {
            lastTime = now;
            func.apply(this, args);
        }
    };
}


// ════════════════════════════════════════════════════════════════
// 7. COPY TO CLIPBOARD
// ════════════════════════════════════════════════════════════════

/**
 * Copy text to clipboard with fallback for older browsers
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} - Success status
 */
async function copyToClipboard(text) {
    // Modern approach using Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            console.error('Clipboard API failed:', err);
        }
    }

    // Fallback for older browsers
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        return success;
    } catch (err) {
        console.error('Fallback copy failed:', err);
        return false;
    }
}


// ════════════════════════════════════════════════════════════════
// 8. EXPORT UTILITIES
// ════════════════════════════════════════════════════════════════

/**
 * Export data as a downloadable file
 * @param {string} content - File content
 * @param {string} filename - Name of the file
 * @param {string} mimeType - MIME type (default: text/plain)
 */
function downloadFile(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();

    // Cleanup
    setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, 100);
}

/**
 * Export chat messages to text format
 * @param {Array} messages - Array of message objects
 * @returns {string}
 */
function formatMessagesAsText(messages) {
    if (!messages || messages.length === 0) {
        return 'No messages to export.';
    }

    let output = '═══════════════════════════════════════════\n';
    output += '  KANYA RAASI - Chat Export\n';
    output += `  Exported: ${formatDateTime(new Date())}\n`;
    output += '═══════════════════════════════════════════\n\n';

    messages.forEach(msg => {
        const role = msg.role === 'user' ? 'You' : 'AI Coach';
        const time = formatDateTime(msg.timestamp);

        output += `[${role}] - ${time}\n`;
        output += '─────────────────────────────────────────\n';
        output += `${msg.content}\n`;

        if (msg.sources && msg.sources.length > 0) {
            output += `\nSources: ${msg.sources.join(', ')}\n`;
        }

        output += '\n';
    });

    output += '═══════════════════════════════════════════\n';
    output += '  End of Export\n';
    output += '═══════════════════════════════════════════\n';

    return output;
}

/**
 * Export chat messages to JSON format
 * @param {Array} messages - Array of message objects
 * @returns {string}
 */
function formatMessagesAsJSON(messages) {
    const exportData = {
        exportDate: new Date().toISOString(),
        application: 'Kanya Raasi - AI Health Coach',
        messageCount: messages.length,
        messages: messages.map(msg => ({
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
            sources: msg.sources || []
        }))
    };

    return JSON.stringify(exportData, null, 2);
}


// ════════════════════════════════════════════════════════════════
// EXPORT FOR USE IN OTHER MODULES
// ════════════════════════════════════════════════════════════════

// Make utilities available globally (for non-module scripts)
window.Utils = {
    $,
    $$,
    createElement,
    clearChildren,
    sanitizeHTML,
    truncate,
    generateId,
    stripHTML,
    formatRelativeTime,
    formatTime,
    formatDateTime,
    isValidURL,
    isEmpty,
    validateMessage,
    parseMarkdown,
    debounce,
    throttle,
    copyToClipboard,
    downloadFile,
    formatMessagesAsText,
    formatMessagesAsJSON
};
