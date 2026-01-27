// Background script to fetch page titles

// Background script to fetch page titles

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fetchTitle') {
        const url = request.url;

        // Strategy 1: Smart API fetch for Jira (to bypass SPA limitation)
        // Check for standard Jira issue pattern: /browse/KEY-123
        const jiraMatch = url.match(/^(https:\/\/[^/]+)\/browse\/([A-Z0-9]+-\d+)/i);

        if (jiraMatch) {
            const origin = jiraMatch[1];
            const issueKey = jiraMatch[2];
            const apiUrl = `${origin}/rest/api/2/issue/${issueKey}?fields=summary`;

            fetch(apiUrl, { credentials: 'include' })
                .then(res => {
                    if (!res.ok) throw new Error('API failed');
                    return res.json();
                })
                .then(data => {
                    if (data && data.fields && data.fields.summary) {
                        // Success: Return "KEY-123 Summary"
                        // Or just Summary if preferred, but usually Key + Summary is best.
                        // User requested: "【iOSドライブ】地図アイコン表示スケール調整" which looks like the summary itself 
                        // or maybe "[KEY] Summary".
                        // Let's return the simplified standard: "KEY Summary" or just "Summary" if the key is already evident?
                        // The user example "【iOSドライブ】..." sounds like the Summary field contains the bracket content.
                        sendResponse({ title: `${issueKey} ${data.fields.summary}` });
                    } else {
                        throw new Error('No summary field');
                    }
                })
                .catch(err => {
                    console.log('Jira API fallback to HTML:', err);
                    fetchHtmlTitle(url, sendResponse);
                });

            return true; // Async wait
        }



        // Strategy 2: Confluence Page ID (API)
        // Pattern: .../wiki/spaces/SPACE/pages/12345/Title
        const confMatch = url.match(/^(https:\/\/[^/]+)\/wiki\/(?:spaces\/[^/]+\/)?pages\/(\d+)/i);

        if (confMatch) {
            const origin = confMatch[1];
            const pageId = confMatch[2];
            const apiUrl = `${origin}/wiki/rest/api/content/${pageId}`; // V1 API

            fetch(apiUrl, { credentials: 'include' })
                .then(res => {
                    if (!res.ok) throw new Error('Confluence API failed');
                    return res.json();
                })
                .then(data => {
                    if (data && data.title) {
                        sendResponse({ title: data.title });
                    } else {
                        throw new Error('No title in Confluence response');
                    }
                })
                .catch(err => {
                    console.log('Confluence API fallback to HTML:', err);
                    fetchHtmlTitle(url, sendResponse);
                });
            return true;
        }

        // Strategy 3: Standard HTML scrape (Fallback)
        fetchHtmlTitle(url, sendResponse);
        return true;
    }
});

function fetchHtmlTitle(url, sendResponse) {
    fetch(url, { credentials: 'include' })
        .then(response => response.text())
        .then(html => {
            // Helper to decode entities
            const decodeEntities = (text) => {
                if (!text) return text;
                return text.replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&#39;/g, "'")
                    .replace(/&quot;/g, '"');
            };

            // Try to find og:title or twitter:title first
            const ogMatch = html.match(/<meta\s+(?:property|name)=["'](?:og:title|twitter:title)["']\s+content=["']([^"']*)["']/i);
            // Fallback to title tag
            const titleMatch = html.match(/<title>([^<]*)<\/title>/i);

            let bestTitle = null;
            if (ogMatch && ogMatch[1]) {
                bestTitle = ogMatch[1].trim();
            } else if (titleMatch && titleMatch[1]) {
                bestTitle = titleMatch[1].trim();
            }

            if (bestTitle) {
                sendResponse({ title: decodeEntities(bestTitle) });
            } else {
                sendResponse({ title: null });
            }
        })
        .catch(error => {
            console.error('Error fetching title:', error);
            sendResponse({ error: error.message });
        });
}
