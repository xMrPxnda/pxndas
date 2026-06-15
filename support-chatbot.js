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
        if (history.length > 4) history.splice(0, history.length - 4);
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

    // --- Tools ---
    let lastToolResult = '';
    const tools = {
        list_accounts: {
            desc: 'Show all available GTA accounts with prices and categories.',
            args: {},
            execute: () => {
                const data = storeData();
                if (!data.accounts.length) return { success: false, message: 'No accounts listed right now.' };
                const lines = data.accounts.map(a => `• **${a.title}** — $${a.price} (${a.category})${a.stock > 0 ? ' ✅ In stock' : ' ❌ Out of stock'}`);
                return { success: true, message: `**Available GTA Accounts:**\n\n${lines.join('\n')}` };
            }
        },
        get_account: {
            desc: 'Get full details on a specific account by title or ID.',
            args: { query: 'string — account title or ID to look up' },
            execute: (args) => {
                if (!args.query) return { error: 'Which account? Try: "Tell me about Modded Money Account"' };
                const data = storeData();
                const a = data.accounts.find(x => x.title?.toLowerCase().includes(args.query.toLowerCase()) || String(x.id) === args.query);
                if (!a) return { error: `Couldn't find an account matching "${args.query}"` };
                return { success: true, message: `**${a.title}** — $${a.price}\nCategory: ${a.category}\nStock: ${a.stock}\n\n${a.description || 'No description.'}` };
            }
        },
        create_ticket: {
            desc: 'Create a support ticket for the customer.',
            args: { subject: 'string — short summary', message: 'string — details of the issue' },
            execute: (args) => {
                if (!args.subject || !args.message) return { error: 'Need a subject and message for the ticket.' };
                const tickets = Security.secureStore.get('support_tickets') || [];
                const ticket = {
                    id: Date.now(),
                    status: 'OPEN',
                    subject: args.subject,
                    message: args.message,
                    user: 'customer',
                    date: new Date().toISOString(),
                    replies: []
                };
                tickets.push(ticket);
                Security.secureStore.set('support_tickets', tickets);
                Security.auditLog('SUPPORT_TICKET_CREATED', { id: ticket.id, subject: args.subject });
                return { success: true, message: `✅ Ticket #${ticket.id} created for: "${args.subject}". A human will get back to you soon.` };
            }
        },
        check_order: {
            desc: 'Look up an order by email address.',
            args: { email: 'string — email used at checkout' },
            execute: (args) => {
                if (!args.email) return { error: 'Need the email you ordered with.' };
                const requests = Security.secureStore.get('service_requests') || [];
                const orders = requests.filter(r => r.email?.toLowerCase() === args.email.toLowerCase());
                if (!orders.length) return { success: true, message: `No orders found for ${args.email}. Did you use a different email?` };
                const lines = orders.map(r => `• Order #${r.id} — ${r.items} — $${r.total} — Status: **${r.status}**`);
                return { success: true, message: `**Orders for ${args.email}:**\n\n${lines.join('\n')}` };
            }
        }
    };

    // --- Parse tool calls from AI response ---
    const parseToolCalls = (text) => {
        const calls = [];
        const regex = /\{tool:(\w+)\}([\s\S]*?)\{\/tool\}/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            try {
                const args = match[2].trim() ? JSON.parse(match[2]) : {};
                calls.push({ name: match[1], args });
            } catch { /* skip malformed */ }
        }
        return calls;
    };

    // Execute tools
    const execTool = async (call) => {
        const tool = tools[call.name];
        if (!tool) return `Unknown tool: ${call.name}`;
        const result = await tool.execute(call.args);
        if (result.error) return `Error: ${result.error}`;
        return `✅ ${result.message}`;
    };

    // --- Update buildPrompt to mention tools ---
    const buildPrompt = () => {
        const data = storeData();
        const listings = data.accounts.map(a => `- ${a.title} ($${a.price}) ${a.stock > 0 ? '[IN STOCK]' : '[SOLD OUT]'}`).join('\n') || 'None';

        const toolLines = Object.entries(tools).map(([name, t]) => {
            const args = Object.entries(t.args).map(([k, v]) => `${k}:${v}`).join(', ');
            return `${name}: ${t.desc} (${args})`;
        }).join('\n');

        return `You are Pxnda Support — the AI for pxndas (GTA V marketplace). Help customers buy accounts.

## RULES
1. Use tools for real data — never guess prices/availability
2. One sentence explaining action → {tool:name}{"args"}{/tool}
3. Be friendly and honest. Don't promise ban safety.
4. After answering, offer the logical next step.

## TOOLS
${toolLines}

## LISTINGS
${listings}

## TOPICS
Modded accounts (money/rank/unlocks), Money drops, Rank unlocks, Recovery, Bundles. Delivery 1-24h by email. PayPal only. 30-day warranty. Clean VPN accounts.`;
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

        try {
            if (apiKey && isAiEnabled()) {
                const response = await callProxyAI(text);
                removeTyping();

                const toolCalls = parseToolCalls(response);
                let output = response.replace(/\{tool:\w+\}[\s\S]*?\{\/tool\}/g, '').trim();
                for (const call of toolCalls) {
                    let result;
                    try {
                        result = await execTool(call);
                    } catch (e) {
                        result = `Error: ${e.message}`;
                    }
                    lastToolResult = result;
                    if (output) output += '\n\n' + result;
                    else output = result;
                }

                appendMessage(formatResponse(output || 'Done.'));
            } else {
                await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
                removeTyping();
                appendMessage(localResponse(text));
            }
        } catch (e) {
            removeTyping();
            appendMessage(`⚠️ Error: ${e.message}`);
        }
    };

    sendBtn.addEventListener('click', handleSend);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSend();
    });
});
