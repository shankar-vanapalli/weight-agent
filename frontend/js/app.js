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
    isLoading: false,
    messages: [],               // Messages for the CURRENT session only
    currentSessionId: null,     // Active session ID
    currentRequestId: null,
    isScrolledToBottom: true,
    typingIndicatorId: null
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
    get sidebarNewChatBtn() { return Utils.$('#sidebarNewChatBtn'); },
    get sidebarList() { return Utils.$('#sidebarList'); },
    get sidebar() { return Utils.$('#sidebar'); },
    get sidebarToggle() { return Utils.$('#sidebarToggle'); },
    get moreDropdown() { return Utils.$('#moreDropdown'); },
    get moreBtn() { return Utils.$('#moreBtn'); },
    get dropdownMenu() { return Utils.$('#dropdownMenu'); },
    get exportChatBtn() { return Utils.$('#exportChatBtn'); },
    get clearHistoryBtn() { return Utils.$('#clearHistoryBtn'); },
    get errorBanner() { return Utils.$('#errorBanner'); },
    get errorMessage() { return Utils.$('#errorMessage'); },
    get errorClose() { return Utils.$('#errorClose'); },
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
    initializeTheme();
    initializeSession();
    setupEventListeners();
    API.startHealthCheck(updateHealthStatus);
    Storage.setupStorageSync(handleCrossTabMessageUpdate, handleCrossTabThemeUpdate);
    Storage.updateLastActive();
    Elements.messageInput.focus();
    setTimeout(() => {
        Elements.loadingOverlay.classList.add('fade-out');
        setTimeout(() => Elements.loadingOverlay.classList.add('hidden'), 350);
    }, 500);
}

/**
 * Initialize or restore the active session
 */
function initializeSession() {
    let sessionId = Storage.getActiveSessionId();
    const sessions = Storage.getSessions();

    // If no sessions exist or saved session is gone, create a fresh one
    if (!sessionId || !sessions[sessionId]) {
        const session = Storage.createSession('New chat');
        sessionId = session.id;
    }

    AppState.currentSessionId = sessionId;
    Storage.setActiveSessionId(sessionId);

    renderSidebar();
    loadMessages();
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
    Elements.sidebarNewChatBtn.addEventListener('click', handleNewChat);
    Elements.sidebarToggle.addEventListener('click', toggleSidebar);

    // ─── Dropdown Menu ───
    Elements.moreBtn.addEventListener('click', toggleDropdown);
    document.addEventListener('click', handleOutsideDropdownClick);

    // ─── Dropdown Actions ───
    Elements.exportChatBtn.addEventListener('click', handleExportChat);
    Elements.clearHistoryBtn.addEventListener('click', handleClearHistory);

    // ─── Error Banner ───
    Elements.errorClose.addEventListener('click', hideError);

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
 * Send a message and get AI response with streaming
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

    // ── Snapshot session context BEFORE any async work ──
    const sessionId = AppState.currentSessionId;

    // Build conversation history BEFORE adding the new user message
    // (backend appends the query itself, so including it here would duplicate it)
    const conversationHistory = AppState.messages
        .filter(msg => !msg.isStreaming && !msg.isError)
        .slice(-30)
        .map(msg => ({
            role: msg.role,
            content: msg.content
        }));

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

    const aiMessageId = Utils.generateId('msg');
    const aiMessage = {
        id: aiMessageId,
        role: 'ai',
        content: '',
        sources: [],
        timestamp: Date.now(),
        isStreaming: true
    };

    let bubbleRendered = false;
    let fullContent = '';

    // Helper: check if user is still viewing the session that started this request
    const isStillActiveSession = () => AppState.currentSessionId === sessionId;

    try {
        AppState.currentRequestId = Utils.generateId('req');

        const response = await API.askQuestion(
            message,
            null,
            conversationHistory,
            (content, replaceMode) => {
                fullContent = replaceMode ? content : (fullContent + content);

                if (!fullContent.trim()) return;

                // First chunk: render the bubble (only if still viewing this session)
                if (!bubbleRendered) {
                    hideTypingIndicator();
                    if (isStillActiveSession()) {
                        AppState.messages.push(aiMessage);
                        renderMessage(aiMessage);
                    }
                    // Always save to storage under the correct session
                    Storage.addMessage(sessionId, aiMessage);
                    bubbleRendered = true;
                }

                // Update bubble content in real-time (DOM element may not exist if user switched)
                const messageElement = document.querySelector(`[data-message-id="${aiMessageId}"]`);
                if (messageElement) {
                    const contentElement = messageElement.querySelector('.message-content');
                    if (contentElement) {
                        contentElement.innerHTML = Utils.parseMarkdown(fullContent);
                        if (AppState.isScrolledToBottom) {
                            scrollToBottom();
                        }
                    }
                }
            }
        );

        // If no chunks arrived at all, render now
        if (!bubbleRendered) {
            hideTypingIndicator();
            aiMessage.content = response.answer;
            if (isStillActiveSession()) {
                AppState.messages.push(aiMessage);
                renderMessage(aiMessage);
            }
            Storage.addMessage(sessionId, aiMessage);
            bubbleRendered = true;
        }

        // Finalise message state
        aiMessage.content = response.answer;
        aiMessage.sources = response.sources;
        aiMessage.isStreaming = false;

        // Update in-memory state only if still viewing this session
        if (isStillActiveSession()) {
            const messageIndex = AppState.messages.findIndex(m => m.id === aiMessageId);
            if (messageIndex !== -1) {
                AppState.messages[messageIndex] = aiMessage;
            }
        }
        // Always persist to correct session in storage
        Storage.updateMessage(sessionId, aiMessageId, aiMessage);

        // Update final content + attach sources in-place (DOM may not exist)
        const messageElement = document.querySelector(`[data-message-id="${aiMessageId}"]`);
        if (messageElement) {
            const contentElement = messageElement.querySelector('.message-content');
            if (contentElement) {
                contentElement.innerHTML = Utils.parseMarkdown(response.answer);
            }
            if (response.sources && response.sources.length > 0) {
                const existingSources = messageElement.querySelector('.sources');
                if (!existingSources) {
                    try {
                        const sourcesElement = renderSources(response.sources);
                        const bubble = messageElement.querySelector('.message');
                        if (bubble) bubble.appendChild(sourcesElement);
                    } catch (e) {
                        console.error('Error adding sources:', e);
                    }
                }
            }
        }
        if (isStillActiveSession()) {
            scrollToBottom();
        }
        hideError();

    } catch (error) {
        console.error('Failed to get response:', error);

        hideTypingIndicator();
        // Remove the streaming message bubble if it was already rendered
        const messageElement = document.querySelector(`[data-message-id="${aiMessageId}"]`);
        if (messageElement) {
            messageElement.remove();
        }
        
        // Remove from state
        if (isStillActiveSession()) {
            AppState.messages = AppState.messages.filter(m => m.id !== aiMessageId);
        }
        Storage.deleteMessage(sessionId, aiMessageId);

        // Show error only if still on the same session
        if (isStillActiveSession()) {
            const errorMessage = error instanceof API.APIError
                ? error.getUserMessage()
                : 'An unexpected error occurred. Please try again.';

            showError(errorMessage);

            const errorBubble = {
                id: Utils.generateId('msg'),
                role: 'ai',
                content: `⚠️ **Error:** ${errorMessage}\n\nPlease try again or check your connection.`,
                isError: true,
                timestamp: Date.now()
            };

            addMessageToState(errorBubble);
            renderMessage(errorBubble);
            scrollToBottom();
        }

    } finally {
        setLoading(false);
        AppState.currentRequestId = null;
        if (isStillActiveSession()) {
            Elements.messageInput.focus();
        }
    }
}

/**
 * Add message to state and save to storage
 * @param {Object} message 
 */
function addMessageToState(message) {
    AppState.messages.push(message);
    Storage.addMessage(AppState.currentSessionId, message);

    // Auto-title the session from the first user message
    const sessions = Storage.getSessions();
    const session = sessions[AppState.currentSessionId];
    if (session && session.title === 'New chat' && message.role === 'user') {
        const title = message.content.slice(0, 40) + (message.content.length > 40 ? '…' : '');
        Storage.updateSessionTitle(AppState.currentSessionId, title);
        renderSidebar();
    }
}

/**
 * Load messages from storage
 */
function loadMessages() {
    Utils.clearChildren(Elements.messagesContainer);
    AppState.messages = Storage.getMessages(AppState.currentSessionId);

    if (AppState.messages.length > 0) {
        if (Elements.welcomeScreen) Elements.welcomeScreen.classList.add('hidden');
        AppState.messages.forEach(renderMessage);
        setTimeout(scrollToBottom, 100);
    } else {
        // Show welcome screen for empty sessions
        const existing = Utils.$('#welcomeScreen');
        if (!existing) {
            const ws = createWelcomeScreen();
            Elements.messagesContainer.appendChild(ws);
        } else {
            existing.classList.remove('hidden');
        }
    }
}


// ════════════════════════════════════════════════════════════════
// SIDEBAR
// ════════════════════════════════════════════════════════════════

/**
 * Render the sidebar session list
 */
function renderSidebar() {
    const list = Elements.sidebarList;
    if (!list) return;
    Utils.clearChildren(list);

    const sessions = Storage.getSessionList();
    if (sessions.length === 0) {
        const empty = Utils.createElement('div', { class: 'sidebar-empty' }, ['No chats yet']);
        list.appendChild(empty);
        return;
    }

    sessions.forEach(session => {
        const isActive = session.id === AppState.currentSessionId;
        const item = Utils.createElement('div', {
            class: `sidebar-item${isActive ? ' active' : ''}`,
            dataset: { sessionId: session.id }
        });

        const icon = Utils.createElement('span', { class: 'sidebar-item-icon' }, ['💬']);
        const text = Utils.createElement('span', { class: 'sidebar-item-text' }, [session.title]);
        const del = Utils.createElement('button', {
            class: 'sidebar-item-delete',
            title: 'Delete chat'
        }, ['×']);

        del.addEventListener('click', (e) => {
            e.stopPropagation();
            handleDeleteSession(session.id);
        });

        item.appendChild(icon);
        item.appendChild(text);
        item.appendChild(del);

        item.addEventListener('click', () => switchSession(session.id));
        list.appendChild(item);
    });
}

/**
 * Switch to a different session
 * @param {string} sessionId
 */
function switchSession(sessionId) {
    if (sessionId === AppState.currentSessionId) return;
    AppState.currentSessionId = sessionId;
    Storage.setActiveSessionId(sessionId);
    loadMessages();
    renderSidebar();
    hideError();
    Elements.messageInput.focus();
}

/**
 * Delete a session from the sidebar
 * @param {string} sessionId
 */
function handleDeleteSession(sessionId) {
    Storage.deleteSession(sessionId);

    if (sessionId === AppState.currentSessionId) {
        const remaining = Storage.getSessionList();
        if (remaining.length > 0) {
            AppState.currentSessionId = remaining[0].id;
            Storage.setActiveSessionId(remaining[0].id);
        } else {
            const fresh = Storage.createSession('New chat');
            AppState.currentSessionId = fresh.id;
        }
        loadMessages();
    }
    renderSidebar();
}

/**
 * Toggle sidebar collapsed state
 */
function toggleSidebar() {
    const sidebar = Elements.sidebar;
    const toggle = Elements.sidebarToggle;
    sidebar.classList.toggle('collapsed');
    toggle.classList.toggle('collapsed');
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
        dataset: { messageId: message.id }
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
    const typingIndicator = Utils.$('#typingIndicator');
    try {
        if (typingIndicator && typingIndicator.parentNode === Elements.messagesContainer) {
            Elements.messagesContainer.insertBefore(wrapper, typingIndicator);
        } else if (typingIndicator && typingIndicator.parentNode) {
            // Typing indicator exists but is not a direct child, find its parent
            typingIndicator.parentNode.insertBefore(wrapper, typingIndicator);
        } else {
            // Typing indicator doesn't exist or has no parent, just append
            Elements.messagesContainer.appendChild(wrapper);
        }
    } catch (e) {
        console.error('Error inserting message:', e);
        // Fallback to append if insertBefore fails
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
        let child;
        if (source.startsWith('http')) {
            child = Utils.createElement('a', {
                href: source,
                target: '_blank',
                rel: 'noopener noreferrer',
                class: 'source-link'
            }, [source.replace(/^https?:\/\//, '').split('/')[0]]);
        } else {
            child = document.createTextNode(source.replace(/\.(pdf|txt|md)$/i, '').replace(/[-_]/g, ' '));
        }
        const item = Utils.createElement('li', { class: 'source-item' }, [child]);
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
    // Create a fresh session immediately — no confirmation needed
    const session = Storage.createSession('New chat');
    AppState.currentSessionId = session.id;
    AppState.messages = [];

    Utils.clearChildren(Elements.messagesContainer);
    Elements.messagesContainer.appendChild(createWelcomeScreen());

    renderSidebar();
    hideError();
    Elements.messageInput.focus();
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

    const sessions = Storage.getSessions();
    const title = sessions[AppState.currentSessionId]?.title || 'chat';
    const textContent = Utils.formatMessagesAsText(AppState.messages);
    const slug = title.slice(0, 30).replace(/[^a-z0-9]/gi, '-').toLowerCase();
    Utils.downloadFile(textContent, `kanya-raasi-${slug}-${new Date().toISOString().slice(0, 10)}.txt`, 'text/plain');
}

/**
 * Handle clear history
 */
function handleClearHistory() {
    closeDropdown();

    showConfirmModal(
        'Delete all chats? This cannot be undone.',
        () => {
            // Delete every session
            Storage.getSessionList().forEach(s => Storage.deleteSession(s.id));

            // Start fresh
            const session = Storage.createSession('New chat');
            AppState.currentSessionId = session.id;
            AppState.messages = [];

            Utils.clearChildren(Elements.messagesContainer);
            Elements.messagesContainer.appendChild(createWelcomeScreen());

            renderSidebar();
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
