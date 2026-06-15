document.addEventListener('DOMContentLoaded', () => {
    const session = Security.secureStore.get('pxndas_logged_in');
    if (!session || session.role !== 'admin') return;

    const toggle = document.getElementById('chat-toggle');
    const panel = document.getElementById('chat-panel');
    const closeBtn = document.getElementById('chat-close');
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    const messages = document.getElementById('chat-messages');
    const headerLabel = document.getElementById('chat-header-label');
    const titleSub = document.querySelector('.chat-title-sub');
    const API_PROXY = '/api/chat';

    if (!toggle || !panel) return;

    let history = [];
    let processingTool = false;

    // --- Tool system ---
    const storeData = () => {
        const users = Security.secureStore.get('pxndas_users') || [];
        const requests = Security.secureStore.get('service_requests') || [];
        const accounts = Security.secureStore.get('store_accounts') || [];
        const posts = Security.secureStore.get('pxnda_posts') || [];
        const paid = requests.filter(r => r.status === 'PAID');
        const revenue = paid.reduce((s, r) => s + parseFloat((r.total || '').replace('$', '') || 0), 0);
        const audit = Security.secureStore.get('pxndas_audit_log') || [];
        const tickets = Security.secureStore.get('support_tickets') || [];
        return { users, requests, paid, revenue, accounts, posts, audit, tickets };
    };

    const tools = {
        add_account: {
            desc: 'Add a new GTA account listing to the store.',
            args: {
                title: 'string (required) — listing title',
                price: 'number (required) — price in USD',
                category: 'string (required) — e.g. Modded, Money, Rank, Recovery, Bundles, Other',
                description: 'string (optional) — account details (stats, unlocks, delivery method)'
            },
            execute: args => {
                if (!args.title || !args.price) return { error: 'title and price are required' };
                const accounts = Security.secureStore.get('store_accounts') || [];
                const newAccount = {
                    id: Date.now(),
                    title: args.title,
                    price: args.price,
                    category: args.category || 'other',
                    description: args.description || '',
                    image: '',
                    date: new Date().toISOString().split('T')[0]
                };
                accounts.push(newAccount);
                Security.secureStore.set('store_accounts', accounts);
                Security.auditLog('AI_ADD_ACCOUNT', { title: args.title, price: args.price });
                return { success: true, message: `Added "${args.title}" for $${args.price}`, id: newAccount.id };
            }
        },
        edit_account: {
            desc: 'Edit an existing GTA account listing by ID.',
            args: {
                id: 'number (required) — account ID to edit',
                title: 'string (optional) — new title',
                price: 'number (optional) — new price',
                category: 'string (optional) — new category',
                description: 'string (optional) — new description'
            },
            execute: args => {
                const accounts = Security.secureStore.get('store_accounts') || [];
                const idx = accounts.findIndex(a => a.id === args.id || a.id == args.id);
                if (idx === -1) return { error: `Account with id ${args.id} not found` };
                if (args.title !== undefined) accounts[idx].title = args.title;
                if (args.price !== undefined) accounts[idx].price = args.price;
                if (args.category !== undefined) accounts[idx].category = args.category;
                if (args.description !== undefined) accounts[idx].description = args.description;
                Security.secureStore.set('store_accounts', accounts);
                Security.auditLog('AI_EDIT_ACCOUNT', { id: args.id });
                return { success: true, message: `Updated account #${args.id}` };
            }
        },
        delete_account: {
            desc: 'Delete a GTA account listing by ID.',
            args: { id: 'number (required) — account ID to delete' },
            confirm: true,
            execute: args => {
                const accounts = Security.secureStore.get('store_accounts') || [];
                const idx = accounts.findIndex(a => a.id === args.id || a.id == args.id);
                if (idx === -1) return { error: `Account with id ${args.id} not found` };
                const removed = accounts.splice(idx, 1)[0];
                Security.secureStore.set('store_accounts', accounts);
                Security.auditLog('AI_DELETE_ACCOUNT', { id: args.id, title: removed.title });
                return { success: true, message: `Deleted "${removed.title}" (#${args.id})` };
            }
        },
        list_accounts: {
            desc: 'Get a detailed list of all GTA account listings with IDs, prices, and categories.',
            args: {},
            execute: () => {
                const accounts = Security.secureStore.get('store_accounts') || [];
                if (!accounts.length) return { success: true, message: 'No listings yet.' };
                const lines = accounts.map(a => `#${a.id} — ${a.title} ($${a.price}) [${a.category}]`);
                return { success: true, message: lines.join('\n') };
            }
        },
        add_post: {
            desc: 'Add a post to the feed (announcements/news).',
            args: {
                title: 'string (required) — post title',
                content: 'string (required) — post content/body'
            },
            execute: args => {
                if (!args.title || !args.content) return { error: 'title and content are required' };
                const posts = Security.secureStore.get('pxnda_posts') || [];
                posts.push({
                    id: Date.now(),
                    title: args.title,
                    content: args.content,
                    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                });
                Security.secureStore.set('pxnda_posts', posts);
                Security.auditLog('AI_ADD_POST', { title: args.title });
                return { success: true, message: `Posted "${args.title}" to feed` };
            }
        },
        delete_post: {
            desc: 'Delete a feed post by ID.',
            args: { id: 'number (required) — post ID to delete' },
            confirm: true,
            execute: args => {
                const posts = Security.secureStore.get('pxnda_posts') || [];
                const idx = posts.findIndex(p => p.id === args.id || p.id == args.id);
                if (idx === -1) return { error: `Post with id ${args.id} not found` };
                const removed = posts.splice(idx, 1)[0];
                Security.secureStore.set('pxnda_posts', posts);
                Security.auditLog('AI_DELETE_POST', { id: args.id, title: removed.title });
                return { success: true, message: `Deleted post "${removed.title}"` };
            }
        },
        view_orders: {
            desc: 'View all orders with details (status, total, items, date).',
            args: { status: 'string (optional) — filter by status: PAID, PENDING, or all' },
            execute: args => {
                const requests = Security.secureStore.get('service_requests') || [];
                let filtered = requests;
                if (args.status && args.status.toUpperCase() !== 'ALL') {
                    filtered = requests.filter(r => r.status === args.status.toUpperCase());
                }
                if (!filtered.length) return { success: true, message: 'No orders found.' };
                const lines = filtered.map(r => {
                    const date = r.timestamp ? new Date(r.timestamp).toLocaleDateString() : 'N/A';
                    return `#${r.id || '?'} — $${r.total || '0'} — ${r.status || '?'} — ${r.items || 0} items — ${date}`;
                });
                return { success: true, message: lines.join('\n') };
            }
        },
        view_users: {
            desc: 'View all registered users with usernames and join dates.',
            args: {},
            execute: () => {
                const users = Security.secureStore.get('pxndas_users') || [];
                if (!users.length) return { success: true, message: 'No users yet.' };
                const lines = users.map(u => `${u.username} (${u.role || 'user'}) — joined ${new Date(u.created).toLocaleDateString()}`);
                return { success: true, message: lines.join('\n') };
            }
        },
        update_setting: {
            desc: 'Update a site configuration setting.',
            args: {
                key: 'string (required) — setting name: payment_mode, idle_timeout',
                value: 'string (required) — new value (for payment_mode: "test" or "live", for idle_timeout: number in minutes)'
            },
            execute: args => {
                if (args.key === 'payment_mode') {
                    if (!['test', 'live'].includes(args.value)) return { error: 'payment_mode must be "test" or "live"' };
                    try {
                        const cfg = Security.secureStore.get('pxndas_config') || {};
                        cfg.PAYMENT_MODE = args.value;
                        Security.secureStore.set('pxndas_config', cfg);
                    } catch {}
                    Security.auditLog('AI_SET_PAYMENT_MODE', { value: args.value });
                    return { success: true, message: `Payment mode set to "${args.value}"` };
                }
                if (args.key === 'idle_timeout') {
                    const mins = parseInt(args.value);
                    if (isNaN(mins) || mins < 1) return { error: 'idle_timeout must be a positive number (minutes)' };
                    try {
                        const cfg = Security.secureStore.get('pxndas_config') || {};
                        cfg.IDLE_TIMEOUT = mins;
                        Security.secureStore.set('pxndas_config', cfg);
                    } catch {}
                    Security.auditLog('AI_SET_IDLE_TIMEOUT', { value: mins });
                    return { success: true, message: `Idle timeout set to ${mins} minutes` };
                }
                return { error: `Unknown setting "${args.key}". Available: payment_mode, idle_timeout` };
            }
        },
        clear_orders: {
            desc: 'Delete all completed (PAID) orders.',
            args: {},
            confirm: true,
            execute: () => {
                const requests = Security.secureStore.get('service_requests') || [];
                const remaining = requests.filter(r => r.status !== 'PAID');
                const count = requests.length - remaining.length;
                Security.secureStore.set('service_requests', remaining);
                Security.auditLog('AI_CLEAR_ORDERS', { count });
                return { success: true, message: `Cleared ${count} completed order(s)` };
            }
        },
        clear_audit: {
            desc: 'Delete the entire audit log.',
            args: {},
            confirm: true,
            execute: () => {
                Security.secureStore.remove('pxndas_audit_log');
                Security.auditLog('AI_CLEAR_AUDIT', {});
                return { success: true, message: 'Audit log cleared' };
            }
        }
    };

    // --- Parse tool calls from AI response ---
    const parseToolCalls = (text) => {
        const calls = [];
        const regex = /\{tool:(\w+)\}([\s\S]*?)\{\/tool\}/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const name = match[1];
            let args = {};
            try { args = JSON.parse(match[2].trim()); } catch {}
            calls.push({ name, args });
        }
        return calls;
    };

    // --- Execute a tool call ---
    const execTool = async (call) => {
        const tool = tools[call.name];
        if (!tool) return `Unknown tool "${call.name}"`;

        if (tool.confirm) {
            const confirmed = await new Promise(resolve => {
                const div = document.createElement('div');
                div.className = 'chat-msg bot confirm';
                div.innerHTML = `<div class="msg-avatar">⚠️</div><div class="msg-content confirm"><p>Allow <strong>${call.name}</strong>?</p><div class="confirm-btns"><button class="confirm-yes">Yes</button><button class="confirm-no">No</button></div></div>`;
                messages.appendChild(div);
                messages.scrollTop = messages.scrollHeight;
                div.querySelector('.confirm-yes').onclick = () => { div.remove(); resolve(true); };
                div.querySelector('.confirm-no').onclick = () => { div.remove(); resolve(false); };
            });
            if (!confirmed) return 'Cancelled.';
        }

        const result = tool.execute(call.args);
        if (result.error) return `Error: ${result.error}`;
        Security.toast.show(result.message, 'success');
        return `✅ ${result.message}`;
    };

    // --- Append a message to the chat ---
    const appendMessage = (text, sender = 'bot') => {
        const div = document.createElement('div');
        div.className = 'chat-msg ' + sender;

        if (sender === 'bot') {
            div.innerHTML = `<div class="msg-avatar">🐼</div><div class="msg-content"><strong>Pxnda AI</strong><div class="msg-text">${text}</div></div>`;
        } else if (sender === 'system') {
            div.innerHTML = `<div class="msg-content system">${text}</div>`;
        } else {
            div.innerHTML = `<div class="msg-content user"><p>${Security.sanitize(text)}</p></div>`;
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
        div.className = 'chat-msg bot typing';
        div.id = 'typing-indicator';
        div.innerHTML = `<div class="msg-avatar">🐼</div><div class="msg-content"><strong>Pxnda AI</strong><div class="typing-dots"><span>.</span><span>.</span><span>.</span></div></div>`;
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
    };

    const removeTyping = () => {
        const el = document.getElementById('typing-indicator');
        if (el) el.remove();
    };

    // --- Build system prompt with tools ---
    const buildPrompt = () => {
        const data = storeData();
        const toolDescs = Object.entries(tools).map(([name, t]) => {
            const args = Object.entries(t.args).map(([k, v]) => `  - ${k}: ${v}`).join('\n');
            return `${name}: ${t.desc}${t.confirm ? ' [REQUIRES CONFIRMATION]' : ''}\nArgs:\n${args}`;
        }).join('\n\n');

        return `You are Pxnda AI, the AI assistant for pxndas — a GTA V / GTA Online account marketplace. You have full access to live store data and can make changes using the tool system.

## Current Store State
- Registered users: ${data.users.length}
- Total orders: ${data.requests.length} (${data.paid.length} paid)
- Total revenue: $${data.revenue.toFixed(2)}
- GTA account listings: ${data.accounts.length}
- Feed posts: ${data.posts.length}
- Support tickets: ${data.tickets.length}
- Payment mode: ${(window.PXNDAS_CONFIG || {}).PAYMENT_MODE === 'live' ? 'LIVE' : 'TEST'}

## Available Tools
You can perform actions by including a tool call block in your response. The block will be detected and executed automatically.

Format:
\`\`\`
{tool:tool_name}{"arg1":"value1","arg2":"value2"}{/tool}
\`\`\`

${toolDescs}

## IMPORTANT RULES
1. When the admin asks you to DO something (add/edit/delete/change), include the appropriate tool block in your response.
2. Always explain what you're doing before the tool block.
3. If admin asks to see data (listings, orders, users), use the appropriate tool or summarize from context.
4. Destructive actions (delete, clear) require confirmation — just include the tool block and the system will prompt.
5. Be concise but helpful.
6. If admin asks to do something you can't do, explain what's possible.
7. After a tool executes, the system will show the result. You can continue the conversation.

## Example
Admin: "Add a modded money account for $89"
You: Adding a Modded Money Account with $500M+ cash for $89.
{tool:add_account}{"title":"Modded Money Account","price":89,"category":"Modded","description":"$500M+ modded cash, all properties, full recovery access"}{/tool}

Admin: "Show me my orders"
You: Here are your orders:
{tool:view_orders}{}{/tool}`;
    };

    // --- Local fallback: Q&A + action commands ---
    const localResponse = async (query) => {
        const q = query.toLowerCase().trim();
        const data = storeData();

        // Action commands (no API key needed)
        // Add account
        const addAccMatch = q.match(/(?:add|create|new|list)\s*(?:a\s+)?(?:gta\s+)?account(?:\s+(?:called|named|titled)\s+[\"']?([^\"'$]+?)[\"']?)?(?:\s+for\s+\$?([\d.]+))?/i);
        if (addAccMatch) {
            const title = addAccMatch[1] ? addAccMatch[1].trim() : null;
            const price = addAccMatch[2] ? parseFloat(addAccMatch[2]) : null;
            if (!title) return `❓ What should I name the account? Try: *add account called "Modded Money" for $89*`;
            if (!price || isNaN(price)) return `❓ What price? Try: *add account called "${title}" for $89*`;
            const result = tools.add_account.execute({ title, price, category: 'other', description: '' });
            if (result.error) return `❌ ${result.error}`;
            return `✅ **${title}** listed for **$${price}**. Account #${result.id}`;
        }

        // Add post
        const addPostMatch = q.match(/(?:add|create|new|make)\s*(?:a\s+)?post\s*(?:titled\s+[\"']?([^\"']+)[\"']?)?(?:\s*(?:with|saying|content)\s+[\"']?(.+?)[\"']?)?$/i);
        if (addPostMatch) {
            let title = addPostMatch[1] ? addPostMatch[1].trim() : null;
            let content = addPostMatch[2] ? addPostMatch[2].trim() : null;
            if (!title) {
                const byline = q.replace(/(?:add|create|new|make)\s*(?:a\s+)?post\s*/i, '').trim();
                if (byline.length > 3 && byline.length < 80) title = byline;
                else return `❓ What should the post title be? Try: *add post titled "New Drop" with content "Fresh accounts available"*`;
            }
            if (!content) content = title;
            const result = tools.add_post.execute({ title, content });
            if (result.error) return `❌ ${result.error}`;
            return `✅ **Post created:** "${title}"`;
        }

        // Delete account
        const delAccMatch = q.match(/(?:delete|remove)\s*(?:account|listing)\s*[#]?(\d+)/i);
        if (delAccMatch) {
            const id = parseInt(delAccMatch[1]);
            const idx = data.accounts.findIndex(a => a.id === id || a.id == id);
            if (idx === -1) return `❌ Account #${id} not found. Try: *list accounts* to see IDs.`;
            const account = data.accounts[idx];
            // Simple confirm via prompt
            if (!confirm(`Delete account "${account.title}" (#${id})?`)) return `Cancelled.`;
            const result = tools.delete_account.execute({ id });
            return result.error ? `❌ ${result.error}` : `✅ Deleted **${account.title}** (#${id})`;
        }

        // Delete post
        const delPostMatch = q.match(/(?:delete|remove)\s*(?:feed\s+)?post\s*[#]?(\d+)/i);
        if (delPostMatch) {
            const id = parseInt(delPostMatch[1]);
            const idx = data.posts.findIndex(p => p.id === id || p.id == id);
            if (idx === -1) return `❌ Post #${id} not found.`;
            const post = data.posts[idx];
            if (!confirm(`Delete post "${post.title}" (#${id})?`)) return `Cancelled.`;
            const result = tools.delete_post.execute({ id });
            return result.error ? `❌ ${result.error}` : `✅ Deleted post **${post.title}** (#${id})`;
        }

        // View accounts (with details)
        if (/^(?:show|view|list)\s*(?:me\s+)?(?:gta\s+)?(?:accounts?|listings?|products?|store)/i.test(q)) {
            if (!data.accounts.length) return `🛒 **Store:** No accounts listed yet.`;
            let reply = `🛒 **${data.accounts.length} account${data.accounts.length !== 1 ? 's' : ''}:**\n`;
            data.accounts.forEach((a, i) => {
                const desc = a.desc ? a.desc.substring(0, 60) : '';
                reply += `\n📦 **#${a.id || i+1}** — ${Security.sanitize(a.title)} — **$${a.price}** [${a.category}]\n   ${Security.sanitize(desc)}`;
            });
            return reply;
        }

        // View posts
        if (/^(?:show|view|list)\s*(?:me\s+)?(?:feed\s+)?(?:posts?|announcements?)/i.test(q)) {
            if (!data.posts.length) return `📡 **Feed:** No posts yet.`;
            let reply = `📡 **${data.posts.length} post${data.posts.length !== 1 ? 's' : ''}:**\n`;
            data.posts.forEach((p, i) => {
                reply += `\n📰 **#${p.id || i+1}** — ${Security.sanitize(p.title)} (${p.date})\n   ${Security.sanitize(p.content ? p.content.substring(0, 80) : '')}`;
            });
            return reply;
        }

        // View orders
        if (/^(?:show|view|list)\s*(?:me\s+)?(?:orders?|purchases?)/i.test(q)) {
            if (!data.requests.length) return `📦 **No orders yet.**`;
            const pending = data.requests.length - data.paid.length;
            let reply = `📦 **${data.requests.length} order${data.requests.length !== 1 ? 's' : ''}** (${data.paid.length} paid, ${pending} pending):\n`;
            data.requests.slice(-5).forEach(r => {
                const d = r.timestamp ? new Date(r.timestamp).toLocaleDateString() : 'N/A';
                reply += `\n• #${r.id || '?'} — $${r.total || '0'} — ${r.status || '?'} — ${d}`;
            });
            return reply;
        }

        // View users
        if (/^(?:show|view|list)\s*(?:me\s+)?(?:users?|customers?)/i.test(q)) {
            if (!data.users.length) return `📊 **No users yet.**`;
            let reply = `📊 **${data.users.length} user${data.users.length !== 1 ? 's' : ''}:**\n`;
            data.users.forEach(u => {
                reply += `\n• @${Security.sanitize(u.username)} — ${u.role || 'user'} — joined ${new Date(u.created).toLocaleDateString()}`;
            });
            return reply;
        }

        // Set payment mode
        const payModeMatch = q.match(/(?:set|switch|change)\s*(?:payment\s+)?mode\s*(?:to\s+)?(test|live)/i);
        if (payModeMatch) {
            const mode = payModeMatch[1].toLowerCase();
            const result = tools.update_setting.execute({ key: 'payment_mode', value: mode });
            return result.error ? `❌ ${result.error}` : `✅ Payment mode set to **${mode.toUpperCase()}**`;
        }

        // Status
        if (/^(status|version|health)\b/.test(q)) return `🟢 **Online** · ${(window.PXNDAS_CONFIG || {}).PAYMENT_MODE === 'live' ? 'LIVE' : 'TEST'}\nUsers: ${data.users.length} · Orders: ${data.requests.length} · Revenue: $${data.revenue.toFixed(2)}`;

        // Help
        if (/^(help|commands|what can you)\b/.test(q)) {
            return `🤖 **I can do everything without an API key:**\n\n` +
                `📦 **Accounts:** add, list, delete\n` +
                `📰 **Posts:** create, list, delete\n` +
                `👥 **Users:** view users\n` +
                `📋 **Orders:** view orders\n` +
                `⚙️ **Settings:** set payment mode\n\n` +
                `Try: *add account called "Modded Money" for $89*\n` +
                `Or: *create post titled "New Drop"*\n` +
                `Or just ask: *show me my accounts*`;
        }

        // Greetings
        if (/\b(hi|hello|hey|sup|yo)\b/.test(q)) return `👋 Hey admin. ${data.requests.length} orders, $${data.revenue.toFixed(2)} revenue. Need me to do something? Try *help* for commands.`;
        if (/\b(thanks?|ty|appreciate)\b/.test(q)) return `👍 Anytime boss.`;

        // Generic data matches
        for (const [word, val] of Object.entries({ 'user': data.users.length, 'order': data.requests.length, 'paid': data.paid.length, 'revenue': `$${data.revenue.toFixed(2)}`, 'listing': data.accounts.length, 'product': data.accounts.length, 'post': data.posts.length })) {
            if (q.includes(word)) return `📊 That relates to **${val}** in the current data.`;
        }
        return `Try *help* to see what I can do, or just tell me something like *add account called "X" for $Y*`;
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

    // --- Update header ---
    const updateHeaderMode = () => {
        if (!headerLabel) return;
        const key = localStorage.getItem('pxndas_ai_key');
        const model = localStorage.getItem('pxndas_ai_model') || '';
        const short = model.split('/').pop() || model;
        if (key) {
            headerLabel.textContent = short.toUpperCase();
            headerLabel.style.cssText = 'color:var(--secondary);border-color:rgba(0,255,255,0.2);background:rgba(0,255,255,0.1)';
            if (titleSub) titleSub.textContent = model;
        } else {
            headerLabel.textContent = 'LOCAL';
            headerLabel.style.cssText = 'color:var(--neon-yellow);border-color:rgba(255,200,0,0.2);background:rgba(255,200,0,0.08)';
            if (titleSub) titleSub.textContent = 'offline mode';
        }
    };
    window.updateChatHeader = updateHeaderMode;
    updateHeaderMode();

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
        if (processingTool) return;

        appendMessage(text, 'user');
        input.value = '';
        showTyping();
        processingTool = true;

        const apiKey = localStorage.getItem('pxndas_ai_key');

        if (apiKey) {
            try {
                const response = await callProxyAI(text);
                removeTyping();

                // Check for tool calls in the response
                const toolCalls = parseToolCalls(response);
                const cleanText = response.replace(/\{tool:\w+\}[\s\S]*?\{\/tool\}/g, '').trim();

                if (cleanText) {
                    appendMessage(formatAIResponse(cleanText));
                }

                // Execute each tool call
                for (const call of toolCalls) {
                    const result = await execTool(call);
                    appendMessage(`⚙️ **${call.name}** → ${result}`, 'system');
                }

                if (!toolCalls.length && !cleanText) {
                    appendMessage(formatAIResponse(response));
                }

                processingTool = false;
                return;
            } catch (e) {
                removeTyping();
                appendMessage(`⚠️ API error: ${e.message}. Falling back to local mode...`);
                // fall through to local
            }
        }

        await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
        removeTyping();
        appendMessage(await localResponse(text));
        processingTool = false;
    };

    // --- Format AI markdown response ---
    const formatAIResponse = (text) => {
        let safe = Security.sanitize(text);
        safe = safe.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        safe = safe.replace(/\*(.*?)\*/g, '<em>$1</em>');
        safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
        safe = safe.replace(/\n/g, '<br>');
        return safe;
    };

    sendBtn.addEventListener('click', handleSend);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSend();
    });
});
