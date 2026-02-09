/**
 * ════════════════════════════════════════════════════════════════
 * MAIN APPLICATION
 * ════════════════════════════════════════════════════════════════
 * 
 * Main controller for the Kanya Raasi Chat UI.
 * Coordinates all modules: Utils, Storage, API
 * 
 * Responsibilities:
 * - Initialize the application
 * - Handle user interactions
 * - Render messages to the DOM
 * - Manage application state
 * - Handle errors gracefully
 * 
 * ════════════════════════════════════════════════════════════════
 */


// ════════════════════════════════════════════════════════════════
// APPLICATION STATE
// ════════════════════════════════════════════════════════════════

const AppState = {
    isLoading: false,           // Is the AI currently generating a response?
    messages: [],               // In-memory message cache
    currentRequestId: null,     // Track current request for cancellation
    isScrolledToBottom: true,   // Is the user at the bottom of chat?
    typingIndicatorId: null     // ID of typing indicator element
};


// ════════════════════════════════════════════════════════════════
// DOM ELEMENT REFERENCES
// ════════════════════════════════════════════════════════════════

// Using Utils.$ for shorthand querySelector
const Elements = {
    get app() { return Utils.$('#app'); },
    get messagesContainer() { return Utils.$('#messagesContainer'); },
    get welcomeScreen() { return Utils.$('#welcomeScreen'); },
    get chatForm() { return Utils.$('#chatForm'); },
    get messageInput() { return Utils.$('#messageInput'); },
    get sendBtn() { return Utils.$('#sendBtn'); },
    get charCounter() { return Utils.$('#charCounter'); },
    get scrollBottomBtn() { return Utils.$('#scrollBottomBtn'); },
    get statusIndicator() { return Utils.$('#statusIndicator'); },
    get themeToggle() { return Utils.$('#themeToggle'); },
    get newChatBtn() { return Utils.$('#newChatBtn'); },
    get moreDropdown() { return Utils.$('#moreDropdown'); },
    get moreBtn() { return Utils.$('#moreBtn'); },
    get dropdownMenu() { return Utils.$('#dropdownMenu'); },
    get exportChatBtn() { return Utils.$('#exportChatBtn'); },
    get clearHistoryBtn() { return Utils.$('#clearHistoryBtn'); },
    get settingsBtn() { return Utils.$('#settingsBtn'); },
    get errorBanner() { return Utils.$('#errorBanner'); },
    get errorMessage() { return Utils.$('#errorMessage'); },
    get errorClose() { return Utils.$('#errorClose'); },
    get settingsModal() { return Utils.$('#settingsModal'); },
    get closeSettingsBtn() { return Utils.$('#closeSettingsBtn'); },
    get apiUrlInput() { return Utils.$('#apiUrlInput'); },
    get numSourcesInput() { return Utils.$('#numSourcesInput'); },
    get cancelSettingsBtn() { return Utils.$('#cancelSettingsBtn'); },
    get saveSettingsBtn() { return Utils.$('#saveSettingsBtn'); },
    get confirmModal() { return Utils.$('#confirmModal'); },
    get confirmMessage() { return Utils.$('#confirmMessage'); },
    get confirmCancelBtn() { return Utils.$('#confirmCancelBtn'); },
    get confirmOkBtn() { return Utils.$('#confirmOkBtn'); },
    get loadingOverlay() { return Utils.$('#loadingOverlay'); }
};


// ════════════════════════════════════════════════════════════════
// INITIALIZATION
// ════════════════════════════════════════════════════════════════

/**
 * Initialize the application
 * Called when DOM is ready
 */
function initializeApp() {
    console.log('🏋️ Kanya Raasi - Initializing...');

    // Load saved theme
    initializeTheme();

    // Load saved messages
    loadMessages();

    // Set up event listeners
    setupEventListeners();

    // Start health check
    API.startHealthCheck(updateHealthStatus);

    // Set up cross-tab sync
    Storage.setupStorageSync(handleCrossTabMessageUpdate, handleCrossTabThemeUpdate);

    // Update last active
    Storage.updateLastActive();

    // Focus input
    Elements.messageInput.focus();

    // Hide loading overlay with fade animation
    setTimeout(() => {
        Elements.loadingOverlay.classList.add('fade-out');
        setTimeout(() => {
            Elements.loadingOverlay.classList.add('hidden');
        }, 350);
    }, 500);

    console.log('✅ Kanya Raasi - Ready!');
}

/**
 * Initialize theme from storage
 */
function initializeTheme() {
    const theme = Storage.getTheme();
    document.documentElement.setAttribute('data-theme', theme);
}


// ════════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ════════════════════════════════════════════════════════════════

/**
 * Set up all event listeners
 */
function setupEventListeners() {
    // ─── Form Submission ───
    Elements.chatForm.addEventListener('submit', handleFormSubmit);

    // ─── Input Handling ───
    Elements.messageInput.addEventListener('input', handleInputChange);
    Elements.messageInput.addEventListener('keydown', handleInputKeydown);

    // ─── Scroll Detection ───
    Elements.messagesContainer.addEventListener('scroll',
        Utils.throttle(handleScroll, 100)
    );

    // ─── Scroll to Bottom Button ───
    Elements.scrollBottomBtn.addEventListener('click', scrollToBottom);

    // ─── Theme Toggle ───
    Elements.themeToggle.addEventListener('click', handleThemeToggle);

    // ─── New Chat ───
    Elements.newChatBtn.addEventListener('click', handleNewChat);

    // ─── Dropdown Menu ───
    Elements.moreBtn.addEventListener('click', toggleDropdown);
    document.addEventListener('click', handleOutsideDropdownClick);

    // ─── Dropdown Actions ───
    Elements.exportChatBtn.addEventListener('click', handleExportChat);
    Elements.clearHistoryBtn.addEventListener('click', handleClearHistory);
    Elements.settingsBtn.addEventListener('click', openSettingsModal);

    // ─── Error Banner ───
    Elements.errorClose.addEventListener('click', hideError);

    // ─── Settings Modal ───
    Elements.closeSettingsBtn.addEventListener('click', closeSettingsModal);
    Elements.cancelSettingsBtn.addEventListener('click', closeSettingsModal);
    Elements.saveSettingsBtn.addEventListener('click', saveSettings);
    Elements.settingsModal.addEventListener('click', handleModalBackdropClick);

    // ─── Confirm Modal ───
    Elements.confirmModal.addEventListener('click', handleModalBackdropClick);

    // ─── Suggestion Chips ───
    Utils.$$('.chip').forEach(chip => {
        chip.addEventListener('click', handleSuggestionClick);
    });

    // ─── Keyboard Shortcuts ───
    document.addEventListener('keydown', handleGlobalKeydown);

    // ─── Window Events ───
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
}


// ════════════════════════════════════════════════════════════════
// MESSAGE HANDLING
// ════════════════════════════════════════════════════════════════

/**
 * Handle form submission (send message)
 * @param {Event} event 
 */
async function handleFormSubmit(event) {
    event.preventDefault();

    const message = Elements.messageInput.value.trim();

    if (!message || AppState.isLoading) {
        return;
    }

    await sendMessage(message);
}

/**
 * Send a message and get AI response
 * @param {string} message 
 */
async function sendMessage(message) {
    // Hide welcome screen
    if (Elements.welcomeScreen) {
        Elements.welcomeScreen.classList.add('hidden');
    }

    // Clear input
    Elements.messageInput.value = '';
    updateCharCounter();
    updateSendButton();

    // Add user message
    const userMessage = {
        id: Utils.generateId('msg'),
        role: 'user',
        content: message,
        timestamp: Date.now()
    };

    addMessageToState(userMessage);
    renderMessage(userMessage);
    scrollToBottom();

    // Set loading state
    setLoading(true);
    showTypingIndicator();

    try {
        // Make API request
        AppState.currentRequestId = Utils.generateId('req');
        const response = await API.askQuestion(message);

        // Add AI response
        const aiMessage = {
            id: Utils.generateId('msg'),
            role: 'ai',
            content: response.answer,
            sources: response.sources,
            timestamp: Date.now()
        };

        addMessageToState(aiMessage);
        hideTypingIndicator();
        renderMessage(aiMessage);
        scrollToBottom();
        hideError();

    } catch (error) {
        console.error('Failed to get response:', error);
        hideTypingIndicator();

        // Show error message
        const errorMessage = error instanceof API.APIError
            ? error.getUserMessage()
            : 'An unexpected error occurred. Please try again.';

        showError(errorMessage);

        // Add error message to chat
        const errorBubble = {
            id: Utils.generateId('msg'),
            role: 'ai',
            content: `⚠️ **Error:** ${errorMessage}\n\nPlease try again or check your connection.`,
            isError: true,
            timestamp: Date.now()
        };

        renderMessage(errorBubble);
        scrollToBottom();

    } finally {
        setLoading(false);
        AppState.currentRequestId = null;
        Elements.messageInput.focus();
    }
}

/**
 * Add message to state and save to storage
 * @param {Object} message 
 */
function addMessageToState(message) {
    AppState.messages.push(message);
    Storage.addMessage(message);
}

/**
 * Load messages from storage
 */
function loadMessages() {
    AppState.messages = Storage.getMessages();

    if (AppState.messages.length > 0) {
        // Hide welcome screen
        if (Elements.welcomeScreen) {
            Elements.welcomeScreen.classList.add('hidden');
        }

        // Render all messages
        AppState.messages.forEach(renderMessage);

        // Scroll to bottom after rendering
        setTimeout(scrollToBottom, 100);
    }
}


// ════════════════════════════════════════════════════════════════
// MESSAGE RENDERING
// ════════════════════════════════════════════════════════════════

/**
 * Render a single message to the DOM
 * @param {Object} message 
 */
function renderMessage(message) {
    const wrapper = Utils.createElement('div', {
        class: `message-wrapper ${message.role}`,
        dataset: { id: message.id }
    });

    // Message bubble
    const bubble = Utils.createElement('div', {
        class: `message ${message.role} ${message.isError ? 'error-message' : ''}`
    });

    // Message content
    const content = Utils.createElement('div', { class: 'message-content' });
    content.innerHTML = Utils.parseMarkdown(message.content);
    bubble.appendChild(content);

    // Sources (for AI messages)
    if (message.role === 'ai' && message.sources && message.sources.length > 0) {
        bubble.appendChild(renderSources(message.sources));
    }

    wrapper.appendChild(bubble);

    // Message metadata (time, copy button)
    const meta = Utils.createElement('div', { class: 'message-meta' });

    // Timestamp
    const time = Utils.createElement('span', { class: 'message-time' }, [
        Utils.formatTime(message.timestamp)
    ]);
    meta.appendChild(time);

    // Copy button
    const copyBtn = Utils.createElement('button', {
        class: 'copy-btn',
        title: 'Copy message',
        onClick: () => handleCopyMessage(message.content, copyBtn)
    }, ['📋']);
    meta.appendChild(copyBtn);

    wrapper.appendChild(meta);

    // Insert before typing indicator if present, otherwise append
    const typingIndicator = Utils.$('.typing-indicator', Elements.messagesContainer);
    if (typingIndicator) {
        Elements.messagesContainer.insertBefore(wrapper, typingIndicator);
    } else {
        Elements.messagesContainer.appendChild(wrapper);
    }
}

/**
 * Render sources section for AI messages
 * @param {string[]} sources 
 * @returns {Element}
 */
function renderSources(sources) {
    const sourcesContainer = Utils.createElement('div', { class: 'sources' });

    const toggle = Utils.createElement('button', {
        class: 'sources-toggle',
        onClick: (e) => {
            e.target.closest('.sources-toggle').classList.toggle('open');
        }
    }, [
        '📚 Sources (', sources.length.toString(), ') ',
        Utils.createElement('span', { class: 'arrow' }, ['▼'])
    ]);

    const list = Utils.createElement('ul', { class: 'sources-list' });

    sources.forEach(source => {
        const item = Utils.createElement('li', { class: 'source-item' }, [source]);
        list.appendChild(item);
    });

    sourcesContainer.appendChild(toggle);
    sourcesContainer.appendChild(list);

    return sourcesContainer;
}

/**
 * Show typing indicator
 */
function showTypingIndicator() {
    // Remove existing indicator
    hideTypingIndicator();

    const indicator = Utils.createElement('div', {
        class: 'message-wrapper ai',
        id: 'typingIndicator'
    }, [
        Utils.createElement('div', { class: 'message ai typing-indicator' }, [
            Utils.createElement('div', { class: 'typing-dots' }, [
                Utils.createElement('span', { class: 'typing-dot' }),
                Utils.createElement('span', { class: 'typing-dot' }),
                Utils.createElement('span', { class: 'typing-dot' })
            ])
        ])
    ]);

    Elements.messagesContainer.appendChild(indicator);
    scrollToBottom();
}

/**
 * Hide typing indicator
 */
function hideTypingIndicator() {
    const indicator = Utils.$('#typingIndicator');
    if (indicator) {
        indicator.remove();
    }
}


// ════════════════════════════════════════════════════════════════
// INPUT HANDLING
// ════════════════════════════════════════════════════════════════

/**
 * Handle input change - auto-resize and update counter
 * @param {Event} event 
 */
function handleInputChange(event) {
    const textarea = event.target;

    // Auto-resize textarea
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';

    // Update character counter
    updateCharCounter();

    // Update send button state
    updateSendButton();
}

/**
 * Handle special keys in input
 * @param {KeyboardEvent} event 
 */
function handleInputKeydown(event) {
    // Enter to send (without Shift)
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        Elements.chatForm.dispatchEvent(new Event('submit'));
    }
}

/**
 * Update character counter display
 */
function updateCharCounter() {
    const length = Elements.messageInput.value.length;
    const maxLength = 2000;

    Elements.charCounter.textContent = `${length} / ${maxLength}`;

    // Add warning/error classes
    Elements.charCounter.classList.remove('warning', 'error');
    if (length > maxLength * 0.9) {
        Elements.charCounter.classList.add('error');
    } else if (length > maxLength * 0.75) {
        Elements.charCounter.classList.add('warning');
    }
}

/**
 * Update send button state
 */
function updateSendButton() {
    const hasContent = Elements.messageInput.value.trim().length > 0;
    const isValid = Elements.messageInput.value.length <= 2000;

    Elements.sendBtn.disabled = !hasContent || !isValid || AppState.isLoading;
}


// ════════════════════════════════════════════════════════════════
// SCROLL HANDLING
// ════════════════════════════════════════════════════════════════

/**
 * Handle scroll events on messages container
 */
function handleScroll() {
    const container = Elements.messagesContainer;
    const scrollBottom = container.scrollHeight - container.clientHeight - container.scrollTop;

    // Consider "at bottom" if within 100px of bottom
    AppState.isScrolledToBottom = scrollBottom < 100;

    // Show/hide scroll button
    if (AppState.isScrolledToBottom) {
        Elements.scrollBottomBtn.classList.add('hidden');
    } else {
        Elements.scrollBottomBtn.classList.remove('hidden');
    }
}

/**
 * Scroll to bottom of messages
 */
function scrollToBottom() {
    Elements.messagesContainer.scrollTo({
        top: Elements.messagesContainer.scrollHeight,
        behavior: 'smooth'
    });
    AppState.isScrolledToBottom = true;
    Elements.scrollBottomBtn.classList.add('hidden');
}


// ════════════════════════════════════════════════════════════════
// UI STATE MANAGEMENT
// ════════════════════════════════════════════════════════════════

/**
 * Set loading state
 * @param {boolean} isLoading 
 */
function setLoading(isLoading) {
    AppState.isLoading = isLoading;
    Elements.sendBtn.disabled = isLoading;

    if (isLoading) {
        Elements.messageInput.setAttribute('placeholder', 'Waiting for response...');
    } else {
        Elements.messageInput.setAttribute('placeholder', 'Ask me about nutrition, exercise, or weight loss...');
    }

    updateSendButton();
}

/**
 * Update health status indicator
 * @param {Object} status 
 */
function updateHealthStatus(status) {
    const indicator = Elements.statusIndicator;
    const text = Utils.$('.status-text', indicator);

    indicator.classList.remove('connected', 'error');

    if (status.connected) {
        indicator.classList.add('connected');
        text.textContent = 'Connected';
    } else {
        indicator.classList.add('error');
        text.textContent = 'Disconnected';
    }
}


// ════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ════════════════════════════════════════════════════════════════

/**
 * Show error banner
 * @param {string} message 
 */
function showError(message) {
    Elements.errorMessage.textContent = message;
    Elements.errorBanner.classList.remove('hidden');
}

/**
 * Hide error banner
 */
function hideError() {
    Elements.errorBanner.classList.add('hidden');
}


// ════════════════════════════════════════════════════════════════
// MODAL HANDLING
// ════════════════════════════════════════════════════════════════

/**
 * Open settings modal
 */
function openSettingsModal() {
    closeDropdown();

    // Populate with current settings
    const settings = Storage.getSettings();
    Elements.apiUrlInput.value = settings.apiUrl;
    Elements.numSourcesInput.value = settings.numSources;

    Elements.settingsModal.classList.remove('hidden');
}

/**
 * Close settings modal
 */
function closeSettingsModal() {
    Elements.settingsModal.classList.add('hidden');
}

/**
 * Save settings from modal
 */
function saveSettings() {
    const apiUrl = Elements.apiUrlInput.value.trim();
    const numSources = parseInt(Elements.numSourcesInput.value, 10);

    // Validate API URL
    if (apiUrl && !Utils.isValidURL(apiUrl)) {
        alert('Please enter a valid URL');
        return;
    }

    Storage.saveSettings({
        apiUrl: apiUrl || Storage.DEFAULT_SETTINGS.apiUrl,
        numSources: isNaN(numSources) ? 5 : Math.min(10, Math.max(1, numSources))
    });

    closeSettingsModal();

    // Refresh health check with new URL
    API.performHealthCheck();
}

/**
 * Show confirmation modal
 * @param {string} message 
 * @param {Function} onConfirm 
 */
function showConfirmModal(message, onConfirm) {
    Elements.confirmMessage.textContent = message;
    Elements.confirmModal.classList.remove('hidden');

    // Remove old listeners and add new ones
    const newCancelBtn = Elements.confirmCancelBtn.cloneNode(true);
    const newOkBtn = Elements.confirmOkBtn.cloneNode(true);

    Elements.confirmCancelBtn.parentNode.replaceChild(newCancelBtn, Elements.confirmCancelBtn);
    Elements.confirmOkBtn.parentNode.replaceChild(newOkBtn, Elements.confirmOkBtn);

    newCancelBtn.addEventListener('click', () => {
        Elements.confirmModal.classList.add('hidden');
    });

    newOkBtn.addEventListener('click', () => {
        Elements.confirmModal.classList.add('hidden');
        onConfirm();
    });
}

/**
 * Handle click on modal backdrop (close modal)
 * @param {Event} event 
 */
function handleModalBackdropClick(event) {
    if (event.target.classList.contains('modal-overlay')) {
        event.target.classList.add('hidden');
    }
}


// ════════════════════════════════════════════════════════════════
// DROPDOWN MENU
// ════════════════════════════════════════════════════════════════

/**
 * Toggle dropdown menu
 */
function toggleDropdown() {
    Elements.moreDropdown.classList.toggle('open');
}

/**
 * Close dropdown menu
 */
function closeDropdown() {
    Elements.moreDropdown.classList.remove('open');
}

/**
 * Handle click outside dropdown to close it
 * @param {Event} event 
 */
function handleOutsideDropdownClick(event) {
    if (!Elements.moreDropdown.contains(event.target)) {
        closeDropdown();
    }
}


// ════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ════════════════════════════════════════════════════════════════

/**
 * Handle theme toggle
 */
function handleThemeToggle() {
    const newTheme = Storage.toggleTheme();
    document.documentElement.setAttribute('data-theme', newTheme);
}

/**
 * Handle new chat button
 */
function handleNewChat() {
    showConfirmModal(
        'Start a new chat? Current conversation will be saved.',
        () => {
            // Keep messages in storage but clear from view
            Utils.clearChildren(Elements.messagesContainer);

            // Show welcome screen
            const welcomeScreen = createWelcomeScreen();
            Elements.messagesContainer.appendChild(welcomeScreen);

            // Clear in-memory messages (keep in storage as history)
            AppState.messages = [];
            Storage.clearMessages();

            hideError();
            Elements.messageInput.focus();
        }
    );
}

/**
 * Create welcome screen element
 * @returns {Element}
 */
function createWelcomeScreen() {
    const welcome = Utils.createElement('div', { class: 'welcome-screen', id: 'welcomeScreen' });

    welcome.innerHTML = `
        <div class="welcome-icon">🌿</div>
        <h2>Welcome to Kanya Raasi</h2>
        <p>Your AI-powered health and nutrition coach</p>
        
        <div class="suggestions">
            <p class="suggestions-label">Try asking:</p>
            <div class="suggestion-chips">
                <button class="chip" data-query="What should I eat to lose weight?">
                    🥗 What should I eat to lose weight?
                </button>
                <button class="chip" data-query="How much protein do I need daily?">
                    🥩 How much protein do I need daily?
                </button>
                <button class="chip" data-query="Best exercises for fat loss?">
                    💪 Best exercises for fat loss?
                </button>
                <button class="chip" data-query="How to maintain calorie deficit?">
                    📊 How to maintain calorie deficit?
                </button>
            </div>
        </div>
    `;

    // Add event listeners to chips
    Utils.$$('.chip', welcome).forEach(chip => {
        chip.addEventListener('click', handleSuggestionClick);
    });

    return welcome;
}

/**
 * Handle suggestion chip click
 * @param {Event} event 
 */
function handleSuggestionClick(event) {
    const query = event.currentTarget.dataset.query;
    if (query) {
        Elements.messageInput.value = query;
        updateCharCounter();
        updateSendButton();
        sendMessage(query);
    }
}

/**
 * Handle export chat
 */
function handleExportChat() {
    closeDropdown();

    if (AppState.messages.length === 0) {
        alert('No messages to export.');
        return;
    }

    const textContent = Utils.formatMessagesAsText(AppState.messages);
    const filename = `kanya-raasi-chat-${new Date().toISOString().slice(0, 10)}.txt`;

    Utils.downloadFile(textContent, filename, 'text/plain');
}

/**
 * Handle clear history
 */
function handleClearHistory() {
    closeDropdown();

    showConfirmModal(
        'Clear all chat history? This cannot be undone.',
        () => {
            Utils.clearChildren(Elements.messagesContainer);
            AppState.messages = [];
            Storage.clearMessages();

            // Show welcome screen
            const welcomeScreen = createWelcomeScreen();
            Elements.messagesContainer.appendChild(welcomeScreen);

            hideError();
        }
    );
}

/**
 * Handle copy message
 * @param {string} content 
 * @param {Element} button 
 */
async function handleCopyMessage(content, button) {
    const success = await Utils.copyToClipboard(content);

    if (success) {
        const originalText = button.textContent;
        button.textContent = '✅';
        button.classList.add('copied');

        setTimeout(() => {
            button.textContent = originalText;
            button.classList.remove('copied');
        }, 2000);
    }
}


// ════════════════════════════════════════════════════════════════
// CROSS-TAB SYNCHRONIZATION
// ════════════════════════════════════════════════════════════════

/**
 * Handle messages updated in another tab
 * @param {Array} newMessages 
 */
function handleCrossTabMessageUpdate(newMessages) {
    // Find new messages not in current state
    const currentIds = new Set(AppState.messages.map(m => m.id));
    const newOnes = newMessages.filter(m => !currentIds.has(m.id));

    if (newOnes.length > 0) {
        newOnes.forEach(msg => {
            AppState.messages.push(msg);
            renderMessage(msg);
        });

        if (AppState.isScrolledToBottom) {
            scrollToBottom();
        }
    }
}

/**
 * Handle theme changed in another tab
 * @param {string} newTheme 
 */
function handleCrossTabThemeUpdate(newTheme) {
    document.documentElement.setAttribute('data-theme', newTheme);
}


// ════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════════════════════

/**
 * Handle global keyboard shortcuts
 * @param {KeyboardEvent} event 
 */
function handleGlobalKeydown(event) {
    // Escape to close modals
    if (event.key === 'Escape') {
        closeSettingsModal();
        Utils.$('#confirmModal')?.classList.add('hidden');
        closeDropdown();
    }

    // Ctrl/Cmd + K for new chat
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault();
        handleNewChat();
    }

    // Ctrl/Cmd + / to focus input
    if ((event.ctrlKey || event.metaKey) && event.key === '/') {
        event.preventDefault();
        Elements.messageInput.focus();
    }
}


// ════════════════════════════════════════════════════════════════
// WINDOW EVENTS
// ════════════════════════════════════════════════════════════════

/**
 * Handle before page unload
 */
function handleBeforeUnload() {
    // Cancel any pending requests
    API.cancelAllRequests();

    // Update last active
    Storage.updateLastActive();
}

/**
 * Handle coming back online
 */
function handleOnline() {
    hideError();
    API.performHealthCheck();
}

/**
 * Handle going offline
 */
function handleOffline() {
    showError('You are offline. Please check your internet connection.');
    updateHealthStatus({ connected: false });
}


// ════════════════════════════════════════════════════════════════
// STARTUP
// ════════════════════════════════════════════════════════════════

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    // DOM already loaded
    initializeApp();
}
