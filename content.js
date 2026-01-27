// Content script to modify Slack DOM

// Configuration
const ATLASSIAN_DOMAINS = ['atlassian.net', 'jira', 'confluence']; // Basic keywords to identify Atlassian URLs

// Observer to handle dynamic content loading in Slack
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) { // Element
                processNode(node);
            }
        });
    });
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

// Initial processing
processNode(document.body);

function processNode(rootNode) {
    highlightreplies(rootNode);
    replaceAtlassianLinks(rootNode);
}

function highlightreplies(rootNode) {
    // Try to find reply counts using multiple strategies

    // 1. Common classes
    const classSelectors = [
        '.c-message__reply_count',
        '.c-message_kit__reply_count',
        '.c-reply_bar', // Often used for "View X more replies"
        '.c-reply_bar__count',
        '[data-qa="reply_bar_count"]'
    ];

    // 2. Aria labels (more stable)
    const ariaSelectors = [
        'button[aria-label*="replies"]',
        'button[aria-label*="返信"]',
        'div[aria-label*="replies"]',
        'div[aria-label*="返信"]',
        'button[aria-label*="thread"]', // Sometimes regular threads
        'div[aria-label*="thread"]'
    ];

    const selector = [...classSelectors, ...ariaSelectors].join(', ');
    const replyElements = rootNode.querySelectorAll(selector);

    replyElements.forEach(el => {
        // Verify it's not the main message input or something else
        const text = el.textContent || "";

        // Check for numbers match
        const hasNumber = /\d/.test(text);

        // Specific check for "Other replies" (その他の返信)
        const isOtherReplies = text.includes("その他の返信") || text.includes("other replies");

        if (hasNumber || isOtherReplies) {
            applyHighlight(el);
        }
    });

    // 3. Text content fallback (for "Other replies" that might not match above selectors)
    // This is more expensive, so we scope it carefully if possible, or just scan buttons.
    const buttons = rootNode.querySelectorAll('button, div[role="button"]');
    buttons.forEach(btn => {
        if (btn.textContent.includes("その他の返信") || btn.textContent.includes("other replies")) {
            applyHighlight(btn);
        }
    });
}

function applyHighlight(element) {
    if (!element.classList.contains('slack-enhancer-reply-highlight')) {
        element.classList.add('slack-enhancer-reply-highlight');
    }
}

function replaceAtlassianLinks(rootNode) {
    const links = rootNode.querySelectorAll('a');

    links.forEach(link => {
        const href = link.href;
        const text = link.textContent.trim();

        // Check if it's an Atlassian link
        const isAtlassian = ATLASSIAN_DOMAINS.some(domain => href.includes(domain));

        if (isAtlassian) {
            // Check if the text is just the URL (or very close to it)
            if (text.includes('http') || text === href) {
                // Avoid fetching if we already processed it
                if (link.dataset.slackEnhancerProcessed) return;

                link.dataset.slackEnhancerProcessed = 'true';
                const originalText = link.textContent;

                // 1. Try to derive a "pretty text" from the URL immediately (fallback)
                let fallbackText = originalText;

                // Jira: /browse/KEY-123
                const jiraMatch = href.match(/\/browse\/([A-Z0-9]+-\d+)/i);
                if (jiraMatch && jiraMatch[1]) {
                    fallbackText = jiraMatch[1];
                }

                // Confluence: /display/SPACE/Page+Title
                // or /wiki/spaces/SPACE/pages/123/Page+Title
                if (fallbackText === originalText) { // Only if not found yet
                    const confMatch = href.match(/\/display\/[^/]+\/([^/?#]+)/);
                    if (confMatch && confMatch[1]) {
                        fallbackText = decodeURIComponent(confMatch[1].replace(/\+/g, ' '));
                    }
                }

                link.textContent = 'Loading...';

                chrome.runtime.sendMessage({ action: 'fetchTitle', url: href }, (response) => {
                    let newTitle = null;

                    if (response && response.title) {
                        const title = response.title.trim();

                        // Filter Logic
                        const badList = ['Log in', 'Login', 'Loading', 'Atlassian account', 'ID', 'Sign up'];
                        const isGeneric = ['Jira', 'Confluence', 'Atlassian', 'Error', 'Dashboard'].some(g => title === g);
                        const isAuth = badList.some(bad => title.includes(bad));

                        // Accept if it's NOT generic AND (NOT auth OR it has significant length indicating content)
                        // Also accept if it contains the fallback text (Issue Key) regardless of other words
                        const hasKey = (fallbackText !== originalText) && title.includes(fallbackText);

                        if (hasKey || (!isGeneric && (!isAuth || title.length > 40))) {
                            newTitle = title;
                        }
                    }

                    // Apply: Title > Fallback > Original
                    if (newTitle) {
                        link.textContent = newTitle;
                    } else if (fallbackText !== originalText) {
                        link.textContent = fallbackText;
                        // Add a subtle indicator that it's a fallback (optional, skipping for clean look)
                    } else {
                        link.textContent = originalText;
                    }
                });
            }
        }
    });
}
