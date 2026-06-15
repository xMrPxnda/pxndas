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
    const AI_TOGGLE_KEY = 'pxndas_ai_toggle';

    // Auto-load AI key from server env if not in localStorage
    (function ensureAiKey() {
        if (!localStorage.getItem('pxndas_ai_key')) {
            fetch('/api/config').then(r => r.json()).then(cfg => {
                if (cfg.ok && cfg.aiKey) {
                    localStorage.setItem('pxndas_ai_key', cfg.aiKey);
                    if (cfg.aiModel) localStorage.setItem('pxndas_ai_model', cfg.aiModel);
                    if (cfg.aiProvider) localStorage.setItem('pxndas_ai_provider', cfg.aiProvider);
                    updateHeaderMode();
                }
            }).catch(() => {});
        }
    })();

    const isAiEnabled = () => {
        const hasKey = !!localStorage.getItem('pxndas_ai_key');
        const pref = localStorage.getItem(AI_TOGGLE_KEY);
        // Default: ON if key exists, OFF if no key
        if (pref === null) return hasKey;
        return pref === 'true' && hasKey;
    };

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
        // ─── ACCOUNTS ───
        add_account: {
            desc: 'Add a new GTA account listing to the store.',
            args: {
                title: 'string (required) — listing title',
                price: 'number (required) — price in USD',
                category: 'string (required) — e.g. Modded, Money, Rank, Recovery, Bundles, Other',
                description: 'string (optional) — account details (stats, unlocks, delivery method)',
                stock: 'number (optional) — quantity available (default 1)'
            },
            execute: args => {
                if (!args.title || !args.price) return { error: 'title and price are required' };
                const accounts = Security.secureStore.get('store_accounts') || [];
                const newAccount = {
                    id: Date.now(),
                    title: args.title,
                    price: args.price,
                    category: args.category || 'Other',
                    description: args.description || '',
                    stock: args.stock || 1,
                    icon: '📦',
                    images: [],
                    date: new Date().toISOString().split('T')[0]
                };
                accounts.unshift(newAccount);
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
                description: 'string (optional) — new description',
                stock: 'number (optional) — new stock quantity'
            },
            execute: args => {
                const accounts = Security.secureStore.get('store_accounts') || [];
                const idx = accounts.findIndex(a => a.id === args.id || a.id == args.id);
                if (idx === -1) return { error: `Account with id ${args.id} not found. Use list_accounts to find IDs.` };
                if (args.title !== undefined) accounts[idx].title = args.title;
                if (args.price !== undefined) accounts[idx].price = args.price;
                if (args.category !== undefined) accounts[idx].category = args.category;
                if (args.description !== undefined) accounts[idx].description = args.description;
                if (args.stock !== undefined) accounts[idx].stock = args.stock;
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
                if (idx === -1) return { error: `Account with id ${args.id} not found.` };
                const removed = accounts.splice(idx, 1)[0];
                Security.secureStore.set('store_accounts', accounts);
                Security.auditLog('AI_DELETE_ACCOUNT', { id: args.id, title: removed.title });
                return { success: true, message: `Deleted "${removed.title}" (#${args.id})` };
            }
        },
        list_accounts: {
            desc: 'List all GTA account listings with IDs, prices, categories, and stock.',
            args: { category: 'string (optional) — filter by category' },
            execute: args => {
                const accounts = Security.secureStore.get('store_accounts') || [];
                let filtered = accounts;
                if (args.category) filtered = accounts.filter(a => a.category?.toLowerCase() === args.category.toLowerCase());
                if (!filtered.length) return { success: true, message: 'No accounts found.' };
                const lines = filtered.map(a => `#${a.id} — ${a.title} ($${a.price}) [${a.category}] stock: ${a.stock || 1}`);
                return { success: true, message: lines.join('\n') };
            }
        },
        get_account: {
            desc: 'Get full details of a single account listing by ID.',
            args: { id: 'number (required) — account ID' },
            execute: args => {
                const accounts = Security.secureStore.get('store_accounts') || [];
                const a = accounts.find(a => a.id === args.id || a.id == args.id);
                if (!a) return { error: `Account #${args.id} not found.` };
                return { success: true, message: `#${a.id} — ${a.title}\nPrice: $${a.price}\nCategory: ${a.category}\nStock: ${a.stock || 1}\nDescription: ${a.description || 'N/A'}\nImages: ${(a.images || []).length || (a.image ? 1 : 0)}` };
            }
        },
        update_stock: {
            desc: 'Update the stock quantity of an account listing.',
            args: { id: 'number (required) — account ID', stock: 'number (required) — new stock quantity (0 = out of stock)' },
            execute: args => {
                const accounts = Security.secureStore.get('store_accounts') || [];
                const idx = accounts.findIndex(a => a.id === args.id || a.id == args.id);
                if (idx === -1) return { error: `Account #${args.id} not found.` };
                accounts[idx].stock = Math.max(0, parseInt(args.stock) || 0);
                Security.secureStore.set('store_accounts', accounts);
                Security.auditLog('AI_UPDATE_STOCK', { id: args.id, stock: accounts[idx].stock });
                return { success: true, message: `Stock for #${args.id} set to ${accounts[idx].stock}` };
            }
        },

        // ─── POSTS ───
        add_post: {
            desc: 'Add a post to the feed (announcements/news).',
            args: { title: 'string (required) — post title', content: 'string (required) — post body/content' },
            execute: args => {
                if (!args.title || !args.content) return { error: 'title and content are required' };
                const posts = Security.secureStore.get('pxnda_posts') || [];
                posts.unshift({
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
        edit_post: {
            desc: 'Edit a feed post title and/or content by ID.',
            args: {
                id: 'number (required) — post ID to edit',
                title: 'string (optional) — new title',
                content: 'string (optional) — new content'
            },
            execute: args => {
                const posts = Security.secureStore.get('pxnda_posts') || [];
                const idx = posts.findIndex(p => p.id === args.id || p.id == args.id);
                if (idx === -1) return { error: `Post with id ${args.id} not found.` };
                if (args.title !== undefined) posts[idx].title = args.title;
                if (args.content !== undefined) posts[idx].content = args.content;
                Security.secureStore.set('pxnda_posts', posts);
                Security.auditLog('AI_EDIT_POST', { id: args.id });
                return { success: true, message: `Updated post #${args.id}` };
            }
        },
        delete_post: {
            desc: 'Delete a feed post by ID.',
            args: { id: 'number (required) — post ID to delete' },
            confirm: true,
            execute: args => {
                const posts = Security.secureStore.get('pxnda_posts') || [];
                const idx = posts.findIndex(p => p.id === args.id || p.id == args.id);
                if (idx === -1) return { error: `Post with id ${args.id} not found.` };
                const removed = posts.splice(idx, 1)[0];
                Security.secureStore.set('pxnda_posts', posts);
                Security.auditLog('AI_DELETE_POST', { id: args.id, title: removed.title });
                return { success: true, message: `Deleted post "${removed.title}"` };
            }
        },
        list_posts: {
            desc: 'List all feed posts with IDs, titles, dates, and content preview.',
            args: {},
            execute: () => {
                const posts = Security.secureStore.get('pxnda_posts') || [];
                if (!posts.length) return { success: true, message: 'No posts yet.' };
                const lines = posts.map(p => `#${p.id} — ${p.title} (${p.date})\n   ${(p.content || '').substring(0, 100)}`);
                return { success: true, message: lines.join('\n') };
            }
        },

        // ─── ORDERS ───
        view_orders: {
            desc: 'View orders with optional status filter.',
            args: { status: 'string (optional) — filter: PAID, PENDING, CANCELLED, or all' },
            execute: args => {
                const requests = Security.secureStore.get('service_requests') || [];
                let filtered = requests;
                if (args.status && args.status.toUpperCase() !== 'ALL') {
                    filtered = requests.filter(r => r.status === args.status.toUpperCase());
                }
                if (!filtered.length) return { success: true, message: 'No orders found.' };
                const lines = filtered.map(r => {
                    const date = r.timestamp ? new Date(r.timestamp).toLocaleDateString() : 'N/A';
                    return `#${r.id || '?'} — $${r.total || '0'} — ${r.status || '?'} — ${r.items || 0} items — ${r.email || 'N/A'} — ${date}`;
                });
                return { success: true, message: lines.join('\n') };
            }
        },
        update_order_status: {
            desc: 'Update the status of an order by ID.',
            args: { id: 'number (required) — order ID', status: 'string (required) — new status: PAID, PENDING, CANCELLED, DELIVERED' },
            confirm: true,
            execute: args => {
                const requests = Security.secureStore.get('service_requests') || [];
                const idx = requests.findIndex(r => r.id === args.id || r.id == args.id);
                if (idx === -1) return { error: `Order #${args.id} not found.` };
                const valid = ['PAID', 'PENDING', 'CANCELLED', 'DELIVERED'];
                if (!valid.includes(args.status.toUpperCase())) return { error: `Status must be: ${valid.join(', ')}` };
                requests[idx].status = args.status.toUpperCase();
                Security.secureStore.set('service_requests', requests);
                Security.auditLog('AI_UPDATE_ORDER', { id: args.id, status: args.status.toUpperCase() });
                return { success: true, message: `Order #${args.id} set to ${args.status.toUpperCase()}` };
            }
        },
        delete_order: {
            desc: 'Delete an order by ID.',
            args: { id: 'number (required) — order ID to delete' },
            confirm: true,
            execute: args => {
                const requests = Security.secureStore.get('service_requests') || [];
                const idx = requests.findIndex(r => r.id === args.id || r.id == args.id);
                if (idx === -1) return { error: `Order #${args.id} not found.` };
                const removed = requests.splice(idx, 1)[0];
                Security.secureStore.set('service_requests', requests);
                Security.auditLog('AI_DELETE_ORDER', { id: args.id });
                return { success: true, message: `Deleted order #${args.id} (${removed.status})` };
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

        // ─── USERS ───
        view_users: {
            desc: 'View all registered users with usernames, roles, and join dates.',
            args: {},
            execute: () => {
                const users = Security.secureStore.get('pxndas_users') || [];
                if (!users.length) return { success: true, message: 'No users yet.' };
                const lines = users.map(u => `@${u.username} (${u.role || 'user'}) — joined ${new Date(u.created).toLocaleDateString()}${u.email ? ' — ' + u.email : ''}`);
                return { success: true, message: lines.join('\n') };
            }
        },

        // ─── SUPPORT TICKETS ───
        list_tickets: {
            desc: 'List all support tickets with status, subject, and date.',
            args: { status: 'string (optional) — filter: OPEN, CLOSED, or all' },
            execute: args => {
                const tickets = Security.secureStore.get('support_tickets') || [];
                let filtered = tickets;
                if (args.status && args.status.toUpperCase() !== 'ALL') {
                    filtered = tickets.filter(t => t.status === args.status.toUpperCase());
                }
                if (!filtered.length) return { success: true, message: 'No tickets found.' };
                const lines = filtered.map((t, i) => `#${i} — ${t.subject || 'No subject'} — ${t.status || 'OPEN'} — ${t.user || '?'} — ${t.date || ''}`);
                return { success: true, message: lines.join('\n') };
            }
        },
        reply_ticket: {
            desc: 'Reply to a support ticket by index.',
            args: { id: 'number (required) — ticket index number', message: 'string (required) — reply text' },
            execute: args => {
                const tickets = Security.secureStore.get('support_tickets') || [];
                const idx = parseInt(args.id);
                if (isNaN(idx) || idx < 0 || idx >= tickets.length) return { error: `Ticket #${args.id} not found.` };
                if (!tickets[idx].replies) tickets[idx].replies = [];
                tickets[idx].replies.push({ text: args.message, sender: 'admin', date: new Date().toLocaleString() });
                Security.secureStore.set('support_tickets', tickets);
                Security.auditLog('AI_REPLY_TICKET', { id: args.id });
                return { success: true, message: `Replied to ticket #${args.id}` };
            }
        },
        close_ticket: {
            desc: 'Close a support ticket by index.',
            args: { id: 'number (required) — ticket index number' },
            confirm: true,
            execute: args => {
                const tickets = Security.secureStore.get('support_tickets') || [];
                const idx = parseInt(args.id);
                if (isNaN(idx) || idx < 0 || idx >= tickets.length) return { error: `Ticket #${args.id} not found.` };
                tickets[idx].status = 'CLOSED';
                Security.secureStore.set('support_tickets', tickets);
                Security.auditLog('AI_CLOSE_TICKET', { id: args.id });
                return { success: true, message: `Closed ticket #${args.id}` };
            }
        },

        // ─── SETTINGS ───
        update_setting: {
            desc: 'Update a site configuration setting.',
            args: {
                key: 'string (required) — setting name: payment_mode, idle_timeout',
                value: 'string (required) — new value (payment_mode: "test" or "live", idle_timeout: minutes)'
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

        // ─── DATA ───
        view_revenue: {
            desc: 'View total revenue, paid orders count, and recent transactions.',
            args: {},
            execute: () => {
                const requests = Security.secureStore.get('service_requests') || [];
                const paid = requests.filter(r => r.status === 'PAID');
                const revenue = paid.reduce((s, r) => s + parseFloat((r.total || '').replace('$', '') || 0), 0);
                const recent = paid.slice(-3).map(r => `  $${r.total} — ${r.email || '?'} — ${r.timestamp ? new Date(r.timestamp).toLocaleDateString() : ''}`);
                return { success: true, message: `💰 Total Revenue: $${revenue.toFixed(2)}\nPaid Orders: ${paid.length}\n\nRecent:\n${recent.join('\n') || '  No paid orders yet'}` };
            }
        },
        view_audit: {
            desc: 'View recent activity log entries.',
            args: { limit: 'number (optional) — how many entries to show (default 10)' },
            execute: args => {
                const audit = Security.secureStore.get('pxndas_audit_log') || [];
                const limit = Math.min(parseInt(args.limit) || 10, 50);
                if (!audit.length) return { success: true, message: 'No activity logged yet.' };
                const lines = audit.slice(-limit).map(e => `${new Date(e.timestamp).toLocaleString()} — ${e.event}${e.details ? ' — ' + JSON.stringify(e.details) : ''}`);
                return { success: true, message: lines.join('\n') };
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
        },
        clear_data: {
            desc: 'Factory reset all store data (accounts, posts, orders, users, tickets, audit).',
            args: {},
            confirm: true,
            execute: () => {
                Security.secureStore.clear();
                Security.auditLog('AI_CLEAR_ALL_DATA', {});
                return { success: true, message: 'All store data has been reset.' };
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
        const toolLines = Object.entries(tools).map(([name, t]) => {
            const args = Object.entries(t.args).map(([k, v]) => `  - ${k}: ${v}`).join('\n');
            return `${name}: ${t.desc}${t.confirm ? ' [REQUIRES CONFIRMATION]' : ''}\nArgs:\n${args}`;
        }).join('\n\n');

        return `You are Pxnda AI, the all-powerful AI assistant for pxndas — a GTA V / GTA Online account marketplace. You have FULL control over the entire store. You can view, add, edit, delete anything using your tools.

## Current Store State
- Registered users: ${data.users.length}
- Total orders: ${data.requests.length} (${data.paid.length} paid)
- Total revenue: $${data.revenue.toFixed(2)}
- GTA account listings: ${data.accounts.length}
- Feed posts: ${data.posts.length}
- Support tickets: ${data.tickets.length}
- Payment mode: ${(window.PXNDAS_CONFIG || {}).PAYMENT_MODE === 'live' ? 'LIVE' : 'TEST'}

## Available Tools
You have these tools at your disposal. Include a tool block in your response to execute actions.

Format (exact JSON in the block):
{tool:tool_name}{"arg1":"value1","arg2":"value2"}{/tool}

${toolLines}

## How to respond
- When the admin asks you to DO something, use the appropriate tool immediately. Always explain briefly what you're doing.
- When asked to VIEW data, use a tool (list_accounts, view_orders, etc.) to get live data.
- When you don't have a tool for something needed, suggest the closest alternative.
- NEVER say "I can't do that" — always try to help using your tools.
- Be confident, concise, and professional. You're in full control.

## Examples

Admin: "Add a modded money account for $89"
You: Adding a Modded Money Account for $89.
{tool:add_account}{"title":"Modded Money Account","price":89,"category":"Modded","description":"$500M+ modded cash, all properties, full recovery access"}{/tool}

Admin: "Show me my orders"
You: Here are your current orders:
{tool:view_orders}{}{/tool}

Admin: "Delete account 1712345678"
You: Deleting account #1712345678.
{tool:delete_account}{"id":1712345678}{/tool}

Admin: "Create a post saying we have new accounts"
You: Creating a new feed post.
{tool:add_post}{"title":"New Accounts Available","content":"Fresh modded money accounts just landed. Check them out in the store."}{/tool}

Admin: "Change payment to live mode"
You: Switching to live payment mode.
{tool:update_setting}{"key":"payment_mode","value":"live"}{/tool}

## CRITICAL RULES
1. ALWAYS use a tool when the admin asks you to do something. Never just talk about doing it.
2. For destructive actions (delete, clear), the system will show a confirmation prompt automatically — just include the tool block.
3. After a tool executes successfully, tell the admin what happened and offer next steps.
4. Keep responses short and actionable. No fluff.
5. You have FULL access — act like it.`;
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

        // Edit post
        const editPostMatch = q.match(/(?:edit|update)\s*(?:feed\s+)?post\s*[#]?(\d+)\s*(?:titled\s+[\"']?([^\"']+)[\"']?)?(?:\s*(?:content|to|say)\s+[\"']?(.+?)[\"']?)?$/i);
        if (editPostMatch) {
            const id = parseInt(editPostMatch[1]);
            const idx = data.posts.findIndex(p => p.id === id || p.id == id);
            if (idx === -1) return `❌ Post #${id} not found.`;
            const args = { id };
            if (editPostMatch[2]) args.title = editPostMatch[2].trim();
            if (editPostMatch[3]) args.content = editPostMatch[3].trim();
            const result = tools.edit_post.execute(args);
            return result.error ? `❌ ${result.error}` : `✅ ${result.message}`;
        }

        // Update order status
        const orderStatusMatch = q.match(/(?:set|mark|update)\s*(?:order\s+)?[#]?(\d+)\s*(?:as\s+|to\s+)?(paid|pending|cancelled|delivered)/i);
        if (orderStatusMatch) {
            const id = parseInt(orderStatusMatch[1]);
            const status = orderStatusMatch[2].toUpperCase();
            if (!confirm(`Set order #${id} to ${status}?`)) return `Cancelled.`;
            const result = tools.update_order_status.execute({ id, status });
            return result.error ? `❌ ${result.error}` : `✅ ${result.message}`;
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
        const toggle = document.getElementById('chatAiToggle');
        const enabled = isAiEnabled();
        if (toggle) toggle.checked = enabled;
        if (key && enabled) {
            headerLabel.textContent = short.toUpperCase();
            headerLabel.style.cssText = 'color:var(--secondary);border-color:rgba(0,255,255,0.2);background:rgba(0,255,255,0.1)';
            if (titleSub) titleSub.textContent = model;
        } else {
            headerLabel.textContent = 'LOCAL';
            headerLabel.style.cssText = 'color:var(--neon-yellow);border-color:rgba(255,200,0,0.2);background:rgba(255,200,0,0.08)';
            if (titleSub) titleSub.textContent = 'offline mode';
        }
    };
    // Toggle listener
    document.addEventListener('change', (e) => {
        if (e.target.id === 'chatAiToggle') {
            localStorage.setItem(AI_TOGGLE_KEY, e.target.checked ? 'true' : 'false');
            updateHeaderMode();
        }
    });
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

        if (apiKey && isAiEnabled()) {
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
