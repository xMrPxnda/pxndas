document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('support-chat-toggle');
    const panel = document.getElementById('support-chat-panel');
    const closeBtn = document.getElementById('support-chat-close');
    const input = document.getElementById('support-chat-input');
    const sendBtn = document.getElementById('support-chat-send');
    const messages = document.getElementById('support-chat-messages');
    const headerLabel = document.getElementById('support-chat-header-label');
    const titleSub = document.querySelector('.support-title-sub');
    const API_PROXY = '/api/chat';

    if (!toggle || !panel) return;

    let history = [];

    // --- Store data snapshot ---
    const storeData = () => {
        const accounts = Security.secureStore.get('store_accounts') || [];
        const posts = Security.secureStore.get('pxnda_posts') || [];
        return { accounts, posts };
    };

    // --- Append message ---
    const appendMessage = (text, sender = 'bot') => {
        const div = document.createElement('div');
        div.className = 'support-msg ' + sender;

        if (sender === 'bot') {
            div.innerHTML = `<div class="support-msg-avatar">🎧</div><div class="support-msg-content"><strong>Pxnda Support</strong><div class="msg-text">${text}</div></div>`;
        } else if (sender === 'system') {
            div.innerHTML = `<div class="support-msg-content system">${text}</div>`;
        } else {
            div.innerHTML = `<div class="support-msg-content user"><p>${Security.sanitize(text)}</p></div>`;
        }

        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;

        if (sender === 'user') {
            history.push({ role: 'user', content: text });
        } else if (sender === 'bot') {
            history.push({ role: 'assistant', content: text.replace(/<[^>]*>/g, '') });
        }
        if (history.length > 20) history.splice(0, history.length - 20);
    };

    const showTyping = () => {
        const div = document.createElement('div');
        div.className = 'support-msg bot typing';
        div.id = 'support-typing-indicator';
        div.innerHTML = `<div class="support-msg-avatar">🎧</div><div class="support-msg-content"><strong>Pxnda Support</strong><div class="support-typing-dots"><span>.</span><span>.</span><span>.</span></div></div>`;
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
    };

    const removeTyping = () => {
        const el = document.getElementById('support-typing-indicator');
        if (el) el.remove();
    };

    // --- Format AI response ---
    const formatResponse = (text) => {
        let safe = Security.sanitize(text);
        safe = safe.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        safe = safe.replace(/\*(.*?)\*/g, '<em>$1</em>');
        safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
        safe = safe.replace(/\n/g, '<br>');
        return safe;
    };

    // --- Build system prompt for AI ---
    const buildPrompt = () => {
        const data = storeData();
        const listings = data.accounts.map(a => `- ${a.title} ($${a.price}) — ${a.category}`).join('\n') || 'No accounts listed yet.';

        return `You are Pxnda Support, the friendly customer support AI for pxndas — a GTA V / GTA Online account marketplace.

## Current Store Listings
${listings}

## Your Role
- Answer customer questions about GTA accounts, pricing, delivery, and the store.
- Be friendly, helpful, and concise. Use a casual but professional tone.
- You can read the current listings above and reference them in answers.
- You do NOT have the ability to make changes to the store.
- If a customer asks about something you can't answer, direct them to the support contact form.

## Common Topics
- **Account types**: Modded (money, rank, unlocks), Money drops, Rank unlocks, Recovery services, Bundles
- **Delivery**: Accounts are delivered via email with full login details. Recovery is done via social club.
- **Payment**: PayPal only. All transactions are secure.
- **Warranty**: All accounts come with a warranty. If something goes wrong within 30 days, we replace it.
- **Safety**: Accounts use clean emails, VPN-created, with no prior bans.

## Rules
1. Never make promises about ban safety — accounts are modded and carry inherent risk.
2. Be honest about what each account type includes.
3. If you don't know, say so and offer to create a support ticket.`;
    };

    // --- Local FAQ fallback ---
    const localResponse = (query) => {
        const q = query.toLowerCase().trim();
        const data = storeData();

        // Greetings
        if (/\b(hi|hello|hey|sup|yo)\b/.test(q)) return `👋 Hey! Welcome to pxndas. Looking for a GTA account? Ask me about our modded money, rank unlocks, recovery, or anything else!`;

        // Pricing / cost
        if (/\b(price|cost|how much|pricing)\b/.test(q)) {
            if (!data.accounts.length) return `💲 We don't have any listings right now, but prices typically range from $24 for money drops to $149 for ultimate bundles. Check back soon!`;
            const prices = data.accounts.map(a => `• **${a.title}** — $${a.price}`).join('\n');
            return `💲 **Current prices:**\n${prices}\n\nAll prices are in USD. Payment via PayPal.`;
        }

        // Delivery
        if (/\b(delivery|how.*get|when|how long|receive|arrive)\b/.test(q)) {
            return `📦 **Delivery:** Most accounts are delivered within **1-24 hours** after payment. You'll receive the login details via email. Recovery services may take up to 48 hours.`;
        }

        // Account types
        if (/\b(modded|mod|money|rank|unlock|recovery|bundle)\b/.test(q)) {
            let reply = `🎮 **We offer these account types:**\n`;
            if (q.includes('modded') || q.includes('mod')) reply += `\n• **Modded Accounts** — $500M+ cash, max rank, all properties, rare unlocks. The full package.`;
            if (q.includes('money')) reply += `\n• **Money Drops** — Fast cash transfers into your existing account. No mods needed on your end.`;
            if (q.includes('rank') || q.includes('unlock')) reply += `\n• **Rank/Unlock** — Rank 1000+ with all vehicles, weapons, properties, and trophies unlocked.`;
            if (q.includes('recovery')) reply += `\n• **Recovery** — Transfer progress or recover a lost account. Full email + social club reset.`;
            if (q.includes('bundle')) reply += `\n• **Ultimate Bundle** — Everything combined: money + rank + unlocks + rare items at a discount.`;
            if (!q.includes('modded') && !q.includes('money') && !q.includes('rank') && !q.includes('unlock') && !q.includes('recovery') && !q.includes('bundle')) {
                reply += `\n• **Modded** — Full modded accounts\n• **Money Drops** — Fast cash\n• **Rank Unlocks** — Max rank\n• **Recovery** — Account recovery\n• **Bundles** — Everything combined`;
            }
            return reply;
        }

        // Safety / ban risk
        if (/\b(ban|safe|risk|detected|get banned|banned)\b/.test(q)) {
            return `⚠️ **Safety:** All accounts are created with clean VPNs and fresh emails. While we take every precaution, modded accounts carry inherent risk. We offer a **30-day warranty** — if your account is banned within 30 days, we replace it free of charge.`;
        }

        // Payment
        if (/\b(pay|payment|paypal|card|how.*buy|checkout)\b/.test(q)) {
            return `💳 **Payment:** We accept **PayPal only**. Just add items to your cart and checkout. All transactions are processed securely through PayPal's payment gateway.`;
        }

        // Warranty
        if (/\b(warranty|guarantee|refund|replace)\b/.test(q)) {
            return `🛡️ **30-Day Warranty:** If your account gets banned or has issues within 30 days, we'll replace it free of charge. Contact us through the support form (💬 button) with your order ID.`;
        }

        // Listings / what's available
        if (/\b(listing|available|what.*have|show|store|account|product)\b/.test(q)) {
            if (!data.accounts.length) return `🛒 **No accounts listed right now.** Check back soon or contact us via the support form (💬 bottom-left).`;
            let reply = `🛒 **Available GTA Accounts:**\n`;
            data.accounts.forEach((a, i) => { reply += `\n${i + 1}. **${a.title}** — $${a.price} (${a.category})`; });
            return reply;
        }

        // Contact / support
        if (/\b(contact|human|agent|real person|ticket)\b/.test(q)) {
            return `📬 To reach a human, click the **💬 button** in the bottom-left corner to open a support ticket. We'll get back to you ASAP.`;
        }

        // Thanks
        if (/\b(thanks|ty|thx|appreciate)\b/.test(q)) return `👍 Happy to help! If you need anything else, just ask. 🐼`;

        // Default
        return `🤔 I can help with questions about our GTA accounts, pricing, delivery, safety, and more! Try asking:\n• "What accounts do you have?"\n• "How much does a modded account cost?"\n• "Is it safe?"\n• "How does delivery work?"`;
    };

    // --- Proxy AI call ---
    const callProxyAI = async (query) => {
        const apiKey = localStorage.getItem('pxndas_ai_key');
        const model = localStorage.getItem('pxndas_ai_model') || 'openai/gpt-4o-mini';
        const provider = localStorage.getItem('pxndas_ai_provider') || 'openrouter';

        const context = buildPrompt();
        const msgs = [
            { role: 'system', content: context },
            ...history.map(h => ({ role: h.role, content: h.content })),
            { role: 'user', content: query }
        ];

        const res = await fetch(API_PROXY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, apiKey, model, query, context, history: msgs })
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Proxy error');
        return json.reply;
    };

    // --- Toggle state ---
    const AI_TOGGLE_KEY = 'pxndas_ai_toggle';
    const isAiEnabled = () => {
        const hasKey = !!localStorage.getItem('pxndas_ai_key');
        const pref = localStorage.getItem(AI_TOGGLE_KEY);
        if (pref === null) return hasKey;
        return pref === 'true' && hasKey;
    };

    // --- Update header mode ---
    const updateHeader = () => {
        const key = localStorage.getItem('pxndas_ai_key');
        const model = localStorage.getItem('pxndas_ai_model') || '';
        const short = model.split('/').pop() || model;
        const toggle = document.getElementById('supportAiToggle');
        const enabled = isAiEnabled();
        if (toggle) toggle.checked = enabled;
        if (key && enabled && headerLabel) {
            headerLabel.textContent = short.toUpperCase();
            if (titleSub) titleSub.textContent = 'AI powered';
        } else {
            if (headerLabel) headerLabel.textContent = 'FAQ';
            if (titleSub) titleSub.textContent = 'quick answers';
        }
    };
    // Toggle listener
    document.addEventListener('change', (e) => {
        if (e.target.id === 'supportAiToggle') {
            localStorage.setItem(AI_TOGGLE_KEY, e.target.checked ? 'true' : 'false');
            updateHeader();
        }
    });
    updateHeader();

    // --- Toggle ---
    toggle.addEventListener('click', () => {
        panel.classList.toggle('open');
        if (panel.classList.contains('open')) input.focus();
    });
    closeBtn.addEventListener('click', () => panel.classList.remove('open'));

    // --- Handle send ---
    const handleSend = async () => {
        const text = input.value.trim();
        if (!text) return;
        appendMessage(text, 'user');
        input.value = '';
        showTyping();

        const apiKey = localStorage.getItem('pxndas_ai_key');

        if (apiKey && isAiEnabled()) {
            try {
                const response = await callProxyAI(text);
                removeTyping();
                appendMessage(formatResponse(response));
                return;
            } catch {
                // Fall through to local
            }
        }

        await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
        removeTyping();
        appendMessage(localResponse(text));
    };

    sendBtn.addEventListener('click', handleSend);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSend();
    });
});
