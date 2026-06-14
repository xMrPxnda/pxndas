document.addEventListener('DOMContentLoaded', () => {
    const session = Security.secureStore.get('pxndas_logged_in');
    if (!session || session.role !== 'admin') {
        Security.toast.show('Access denied. Admin privileges required.', 'error');
        setTimeout(() => { window.location.href = 'index.html'; }, 1000);
        return;
    }

    // Set admin display name
    const adminId = document.querySelector('.admin-id');
    if (adminId) adminId.textContent = session.username.toUpperCase();

    const navItems = document.querySelectorAll('.sidebar-nav li');
    const tabContents = document.querySelectorAll('.tab-content');
    const headerTitle = document.querySelector('.admin-header h1');
    const newPostForm = document.getElementById('newPostForm');
    const adminPostsList = document.getElementById('adminPostsList');
    const accountForm = document.getElementById('accountForm');
    const adminAccountsList = document.getElementById('adminAccountsList');
    const accImageInput = document.getElementById('acc-image');
    const imagePreview = document.getElementById('imagePreview');
    const previewImg = document.getElementById('previewImg');
    const removeImageBtn = document.getElementById('removeImage');
    const uploadBtnLabel = document.getElementById('uploadBtnLabel');
    let currentImageData = null;

    // ---- Data Loaders ----

    const loadDashboard = () => {
        const requests = Security.secureStore.get('service_requests') || [];
        const users = Security.secureStore.get('pxndas_users') || [];

        // Revenue from paid orders
        const paid = requests.filter(r => r.status === 'PAID');
        const totalRevenue = paid.reduce((sum, r) => {
            const val = parseFloat(r.total?.replace('$', '') || 0);
            return sum + val;
        }, 0);

        document.getElementById('stat-revenue').textContent = `$${totalRevenue.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
        document.getElementById('stat-revenue-change').textContent = `${paid.length} paid order(s)`;

        document.getElementById('stat-users').textContent = users.length;
        document.getElementById('stat-users-change').textContent = users.length > 0 ? 'Registered users' : 'No data yet';

        const pending = requests.filter(r => r.status === 'PENDING');
        document.getElementById('stat-pending').textContent = pending.length;
        document.getElementById('stat-pending-change').textContent = pending.length > 0 ? 'Requires action' : 'All clear';

        // Activity feed from audit log
        const logContainer = document.getElementById('activity-log');
        if (logContainer) {
            const auditLog = Security.secureStore.get('pxndas_audit_log') || [];
            const recent = auditLog.slice(0, 10);
            logContainer.innerHTML = recent.length
                ? recent.map(entry => {
                    const time = new Date(entry.timestamp).toLocaleTimeString();
                    const isError = entry.event.includes('FAILED') || entry.event.includes('LIMITED');
                    return `<div class="log-entry${isError ? ' error' : ''}"><span class="time">[${time}]</span><span class="msg">${Security.sanitize(entry.event)} — ${Security.sanitize(JSON.stringify(entry.details))}</span></div>`;
                }).join('')
                : '<div class="log-entry"><span class="time">[--:--:--]</span><span class="msg">No activity recorded yet.</span></div>';
        }
    };

    const loadUsers = () => {
        const body = document.getElementById('users-table-body');
        if (!body) return;
        const users = Security.secureStore.get('pxndas_users') || [];
        body.innerHTML = users.length
            ? users.map((u, i) => `
                <tr>
                    <td>#U${String(i + 1).padStart(3, '0')}</td>
                    <td>${Security.sanitize(u.username)}</td>
                    <td><span class="badge active">ACTIVE</span></td>
                    <td>${u.created ? new Date(u.created).toLocaleDateString() : 'N/A'}</td>
                    <td><button class="btn-action" disabled>Edit</button></td>
                </tr>
            `).join('')
            : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No registered users.</td></tr>';
    };

    const loadServiceRequests = () => {
        const body = document.getElementById('serviceRequestsBody');
        if (!body) return;
        const requests = Security.secureStore.get('service_requests') || [];
        body.innerHTML = requests.length
            ? requests.map(req => `
                <tr>
                    <td>${Security.sanitize(req.id)}</td>
                    <td>${Security.sanitize(req.email)}</td>
                    <td>${Security.sanitize(req.items)}</td>
                    <td>${Security.sanitize(req.total)}</td>
                    <td><span class="badge ${req.status === 'PAID' ? 'active' : ''}">${Security.sanitize(req.status)}</span></td>
                </tr>
            `).join('')
            : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No service requests.</td></tr>';
    };

    let currentTicketIdx = -1;

    const loadSupportTickets = () => {
        const body = document.getElementById('supportTicketsBody');
        if (!body) return;
        const tickets = Security.secureStore.get('support_tickets') || [];
        body.innerHTML = tickets.length
            ? tickets.map((t, i) => `
                <tr class="ticket-row ${i === currentTicketIdx ? 'active-ticket' : ''}" data-index="${i}" style="cursor:pointer;${i === currentTicketIdx ? 'border-left:3px solid var(--neon-blue);' : ''}">
                    <td>${Security.sanitize(t.user || t.username || '—')}</td>
                    <td>${Security.sanitize(t.subject)}</td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${Security.sanitize(t.message)}">${Security.sanitize(t.message)}</td>
                    <td style="text-align:center;">${(t.replies || []).length}</td>
                    <td><span class="badge ${t.status === 'OPEN' ? '' : ''}" style="${t.status === 'OPEN' ? 'background:rgba(245,158,11,0.15);color:#f59e0b;border-color:rgba(245,158,11,0.3);' : 'background:rgba(34,197,94,0.15);color:#22c55e;border-color:rgba(34,197,94,0.3);'}">${Security.sanitize(t.status)}</span></td>
                    <td>${Security.sanitize(t.date)}</td>
                    <td><button class="btn-delete ticket-toggle-btn" data-index="${i}" style="padding:0.3rem 0.8rem;font-size:0.7rem;">${t.status === 'OPEN' ? 'Close' : 'Reopen'}</button></td>
                </tr>
            `).join('')
            : '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No support tickets.</td></tr>';

        // Click row to open reply panel
        body.querySelectorAll('.ticket-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('.ticket-toggle-btn')) return;
                const idx = parseInt(row.dataset.index);
                openTicketReply(idx);
            });
        });

        // Toggle status buttons
        body.querySelectorAll('.ticket-toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index);
                const tickets = Security.secureStore.get('support_tickets') || [];
                if (tickets[idx]) {
                    tickets[idx].status = tickets[idx].status === 'CLOSED' ? 'OPEN' : 'CLOSED';
                    Security.secureStore.set('support_tickets', tickets);
                    Security.auditLog('TICKET_TOGGLE', { subject: tickets[idx].subject, status: tickets[idx].status });
                    Security.toast.show(`Ticket ${tickets[idx].status === 'CLOSED' ? 'closed' : 'reopened'}.`, 'success');
                    if (idx === currentTicketIdx) openTicketReply(idx);
                    else loadSupportTickets();
                }
            });
        });
    };

    const openTicketReply = (idx) => {
        currentTicketIdx = idx;
        const panel = document.getElementById('ticket-reply-panel');
        const subjectEl = document.getElementById('ticket-reply-subject');
        const conversation = document.getElementById('ticket-reply-conversation');
        const replyInput = document.getElementById('ticket-reply-input');
        const tickets = Security.secureStore.get('support_tickets') || [];
        const ticket = tickets[idx];
        if (!ticket) return;

        panel.style.display = 'block';
        subjectEl.textContent = `${Security.sanitize(ticket.subject)} — ${Security.sanitize(ticket.user || 'Unknown')}`;

        // Build conversation
        conversation.innerHTML = '';
        const addMsg = (text, sender, date) => {
            const div = document.createElement('div');
            const isAdmin = sender === 'admin';
            div.style.cssText = `display:flex;flex-direction:column;align-items:${isAdmin ? 'flex-end' : 'flex-start'};`;
            div.innerHTML = `
                <div style="font-size:0.6rem;color:var(--text-muted);margin-bottom:2px;">${sender === 'admin' ? 'You' : Security.sanitize(ticket.user || 'Customer')} — ${date}</div>
                <div style="background:${isAdmin ? 'rgba(0,255,255,0.08)' : 'rgba(188,19,254,0.08)'};border:1px solid ${isAdmin ? 'rgba(0,255,255,0.15)' : 'rgba(188,19,254,0.15)'};border-radius:${isAdmin ? '12px 12px 4px 12px' : '12px 12px 12px 4px'};padding:0.6rem 1rem;max-width:80%;color:#d0d8e0;font-size:0.82rem;line-height:1.5;">
                    ${Security.sanitize(text)}
                </div>
            `;
            conversation.appendChild(div);
        };

        // Original message
        addMsg(ticket.message, 'customer', ticket.date);
        // Replies
        (ticket.replies || []).forEach(r => addMsg(r.text, r.sender, r.date));

        conversation.scrollTop = conversation.scrollHeight;

        // Focus input
        replyInput.focus();

        // Scroll to panel
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        loadSupportTickets();
    };

    // Reply send
    const setupTicketReply = () => {
        const sendBtn = document.getElementById('ticket-reply-send');
        const input = document.getElementById('ticket-reply-input');
        const closeBtn = document.getElementById('ticket-reply-close');
        const panel = document.getElementById('ticket-reply-panel');

        if (!sendBtn || !input) return;

        const sendReply = () => {
            const text = input.value.trim();
            if (!text || currentTicketIdx < 0) return;
            const tickets = Security.secureStore.get('support_tickets') || [];
            const ticket = tickets[currentTicketIdx];
            if (!ticket) return;

            if (!ticket.replies) ticket.replies = [];
            ticket.replies.push({
                text: text,
                sender: 'admin',
                date: new Date().toLocaleString()
            });
            ticket.status = 'OPEN';
            Security.secureStore.set('support_tickets', tickets);
            Security.auditLog('TICKET_REPLY', { subject: ticket.subject });
            Security.toast.show('Reply sent.', 'success');
            input.value = '';
            openTicketReply(currentTicketIdx);
        };

        sendBtn.addEventListener('click', sendReply);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendReply(); });

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                panel.style.display = 'none';
                currentTicketIdx = -1;
                loadSupportTickets();
            });
        }
    };

    // ---- Live Chat ----
    let liveChatSelectedUser = null;
    let liveChatLastCount = {};
    let liveChatNotifications = {};

    const loadLiveChatSidebar = () => {
        const list = document.getElementById('live-chat-user-list');
        if (!list) return;
        const msgs = Security.secureStore.get('live_chat_messages') || [];
        const users = {};
        msgs.forEach(m => {
            if (!users[m.user] || m.time > users[m.user].lastTime) {
                users[m.user] = { lastTime: m.time, lastText: m.text, count: (users[m.user]?.count || 0) + 1 };
            } else { users[m.user].count = (users[m.user]?.count || 0) + 1; }
        });
        const sorted = Object.entries(users).sort((a, b) => b[1].lastTime - a[1].lastTime);

        const totalUnread = Object.values(liveChatNotifications).reduce((s, v) => s + v, 0);
        const badge = document.getElementById('live-chat-tab-badge');
        if (badge) {
            badge.textContent = totalUnread;
            badge.classList.toggle('show', totalUnread > 0);
        }

        list.innerHTML = sorted.length
            ? sorted.map(([user, data]) => {
                const isActive = user === liveChatSelectedUser;
                const time = new Date(data.lastTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const unread = liveChatNotifications[user] || 0;
                return `<div class="live-chat-user-item${isActive ? ' active' : ''}" data-user="${Security.sanitize(user)}">
                    ${unread > 0 ? `<span class="live-chat-user-badge">${unread > 9 ? '9+' : unread}</span>` : ''}
                    <div class="live-chat-user-name">${Security.sanitize(user)}</div>
                    <div class="live-chat-user-preview">${Security.sanitize(data.lastText)}</div>
                    <div class="live-chat-user-time">${time}</div>
                </div>`;
            }).join('')
            : '<div class="live-chat-empty">No conversations yet.</div>';

        list.querySelectorAll('.live-chat-user-item').forEach(el => {
            el.addEventListener('click', () => {
                liveChatSelectedUser = el.dataset.user;
                liveChatNotifications[liveChatSelectedUser] = 0;
                loadLiveChatMessages();
                loadLiveChatSidebar();
            });
        });
    };

    const loadLiveChatMessages = () => {
        const container = document.getElementById('live-chat-main-messages');
        const header = document.getElementById('live-chat-main-header');
        const inputArea = document.getElementById('live-chat-main-input');
        const adminInput = document.getElementById('live-chat-admin-input');
        const typingEl = document.getElementById('live-chat-typing-indicator');
        if (!container) return;
        if (!liveChatSelectedUser) {
            if (header) header.textContent = 'Select a conversation';
            if (inputArea) inputArea.classList.remove('visible');
            if (container) container.innerHTML = '<div class="live-chat-empty">Click a user on the left to view their chat.</div>';
            if (typingEl) typingEl.style.display = 'none';
            return;
        }
        if (header) header.textContent = `Chatting with: @${Security.sanitize(liveChatSelectedUser)}`;
        if (inputArea) inputArea.classList.add('visible');

        const msgs = Security.secureStore.get('live_chat_messages') || [];
        const userMsgs = msgs.filter(m => m.user === liveChatSelectedUser);
        container.innerHTML = userMsgs.length
            ? userMsgs.map(m => {
                const isAdmin = m.from === 'admin';
                const label = isAdmin ? 'You' : liveChatSelectedUser;
                const time = new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return `<div class="live-chat-msg-row ${isAdmin ? 'admin' : 'user'}">
                    <div class="live-chat-msg-label">${Security.sanitize(label)} · ${time}</div>
                    <div class="live-chat-msg-bubble">${Security.sanitize(m.text)}</div>
                </div>`;
            }).join('')
            : '<div class="live-chat-no-msgs">No messages yet.</div>';

        // Check typing indicator
        if (typingEl) {
            const typing = Security.secureStore.get('live_chat_typing') || {};
            const lastTyping = typing[liveChatSelectedUser];
            if (lastTyping && Date.now() - lastTyping < 3000) {
                typingEl.classList.add('show');
                typingEl.textContent = `${Security.sanitize(liveChatSelectedUser)} is typing...`;
            } else {
                typingEl.classList.remove('show');
            }
        }

        container.scrollTop = container.scrollHeight;
        if (adminInput) adminInput.focus();
    };

    const setupLiveChatSend = () => {
        const sendBtn = document.getElementById('live-chat-admin-send');
        const input = document.getElementById('live-chat-admin-input');
        if (!sendBtn || !input) return;
        const send = () => {
            const text = input.value.trim();
            if (!text || !liveChatSelectedUser) return;
            const msgs = Security.secureStore.get('live_chat_messages') || [];
            msgs.push({ user: liveChatSelectedUser, text, from: 'admin', time: Date.now() });
            Security.secureStore.set('live_chat_messages', msgs);
            Security.auditLog('LIVE_CHAT_REPLY', { user: liveChatSelectedUser });
            input.value = '';
            loadLiveChatMessages();
            loadLiveChatSidebar();
        };
        sendBtn.addEventListener('click', send);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    };

    const startLiveChatPoll = () => {
        setInterval(() => {
            const tab = document.querySelector('#live-chat.active');
            const msgs = Security.secureStore.get('live_chat_messages') || [];
            const counts = {};

            msgs.forEach(m => {
                counts[m.user] = (counts[m.user] || 0) + 1;
                if (m.from === 'user') {
                    // Only increment notification if admin hasn't selected this user
                    if (m.user !== liveChatSelectedUser || !tab) {
                        const key = m.user + '_' + m.time;
                        if (!liveChatNotifications['_seen_' + key]) {
                            liveChatNotifications[m.user] = (liveChatNotifications[m.user] || 0) + 1;
                            liveChatNotifications['_seen_' + key] = true;
                        }
                    }
                }
            });

            if (!tab) {
                // Still update badge even when tab is hidden
                const totalUnread = Object.keys(liveChatNotifications)
                    .filter(k => !k.startsWith('_seen_'))
                    .reduce((s, u) => s + (liveChatNotifications[u] || 0), 0);
                const badge = document.getElementById('live-chat-tab-badge');
                if (badge) {
                    badge.textContent = totalUnread;
                    badge.classList.toggle('show', totalUnread > 0);
                }
                return;
            }

            let changed = Object.keys(counts).length !== Object.keys(liveChatLastCount).length;
            if (!changed) {
                for (const [u, c] of Object.entries(counts)) { if (liveChatLastCount[u] !== c) { changed = true; break; } }
            }
            if (changed) {
                liveChatLastCount = counts;
                loadLiveChatSidebar();
                if (liveChatSelectedUser) loadLiveChatMessages();
            }
        }, 2000);
    };

    const loadOrders = () => {
        const body = document.getElementById('orders-table-body');
        if (!body) return;
        const requests = Security.secureStore.get('service_requests') || [];
        body.innerHTML = requests.length
            ? requests.map(req => `
                <tr>
                    <td>${Security.sanitize(req.id)}</td>
                    <td>${Security.sanitize(req.email)}</td>
                    <td>${Security.sanitize(req.items)}</td>
                    <td>${Security.sanitize(req.total)}</td>
                    <td><span class="badge ${req.status === 'PAID' ? 'active' : ''}">${Security.sanitize(req.status)}</span></td>
                    <td>${Security.sanitize(req.date)}</td>
                </tr>
            `).join('')
            : '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No orders yet.</td></tr>';
    };

    const loadAdminPosts = () => {
        if (!adminPostsList) return;
        const posts = Security.secureStore.get('pxnda_posts') || [];
        adminPostsList.innerHTML = posts.length
            ? posts.map((post, i) => `
                <div class="manage-item">
                    <div>
                        <strong style="color: #fff;">${Security.sanitize(post.title)}</strong>
                        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">${Security.sanitize(post.date)}</div>
                    </div>
                    <button class="btn-delete" data-index="${i}">Delete</button>
                </div>
            `).join('')
            : '<p style="color: var(--text-muted); text-align: center;">No posts yet.</p>';
    };

    const loadAccounts = () => {
        if (!adminAccountsList) return;
        const accounts = Security.secureStore.get('store_accounts') || [];
        adminAccountsList.innerHTML = accounts.length
            ? accounts.map((a, i) => `
                <div class="manage-item" style="gap:1rem;">
                    ${a.image ? `<img src="${Security.sanitize(a.image)}" alt="" style="width:50px;height:50px;border-radius:8px;object-fit:cover;border:1px solid rgba(0,255,255,0.15);flex-shrink:0;">` : `<div style="width:50px;height:50px;border-radius:8px;background:rgba(0,255,255,0.05);display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0;">${Security.sanitize(a.icon || '🔑')}</div>`}
                    <div style="flex:1;min-width:0;">
                        <strong style="color:#fff;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Security.sanitize(a.title)}</strong>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">$${Security.sanitize(a.price)} — ${Security.sanitize(a.category)}</div>
                    </div>
                    <button class="btn-delete" data-index="${i}">Delete</button>
                </div>
            `).join('')
            : '<p style="color: var(--text-muted); text-align: center;">No listings yet.</p>';
    };

    if (accountForm) {
        accountForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const title = document.getElementById('acc-title').value.trim();
            const desc = document.getElementById('acc-desc').value.trim();
            const price = document.getElementById('acc-price').value;
            const category = document.getElementById('acc-category').value;

            if (!title || !desc || !price) {
                Security.toast.show('All fields required.', 'warning');
                return;
            }
            const priceNum = parseFloat(price);
            if (isNaN(priceNum) || priceNum < 0.01 || priceNum > 9999.99) {
                Security.toast.show('Price must be between $0.01 and $9,999.99.', 'warning');
                return;
            }

            const accounts = Security.secureStore.get('store_accounts') || [];
            accounts.unshift({
                title: Security.sanitize(title),
                desc: Security.sanitize(desc),
                price: priceNum.toFixed(2),
                category,
                icon: '📦',
                image: currentImageData
            });
            Security.secureStore.set('store_accounts', accounts);
            Security.auditLog('ACCOUNT_LISTED', { title });

            Security.toast.show('Account listed successfully!', 'success');
            accountForm.reset();
            currentImageData = null;
            imagePreview.style.display = 'none';
            previewImg.src = '';
            uploadBtnLabel.textContent = '+ Choose Image';
            loadAccounts();
        });
    }

    // Image upload preview
    if (accImageInput) {
        accImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                currentImageData = ev.target.result;
                previewImg.src = currentImageData;
                imagePreview.style.display = 'flex';
                uploadBtnLabel.textContent = 'Change Image';
            };
            reader.readAsDataURL(file);
        });
    }

    // Remove image
    if (removeImageBtn) {
        removeImageBtn.addEventListener('click', () => {
            currentImageData = null;
            imagePreview.style.display = 'none';
            previewImg.src = '';
            accImageInput.value = '';
            uploadBtnLabel.textContent = '+ Choose Image';
        });
    }

    // ---- Tab Switching ----

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tabId = item.dataset.tab;
            navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === tabId) content.classList.add('active');
            });
            headerTitle.textContent = item.textContent.trim();

            // Load data on tab switch
            if (tabId === 'dashboard') loadDashboard();
            if (tabId === 'users') loadUsers();
            if (tabId === 'service-requests') loadServiceRequests();
            if (tabId === 'support-tickets') loadSupportTickets();
            if (tabId === 'live-chat') { loadLiveChatSidebar(); loadLiveChatMessages(); }
            if (tabId === 'orders') loadOrders();
            if (tabId === 'content-manager') loadAdminPosts();
            if (tabId === 'accounts') loadAccounts();
            if (tabId === 'settings') loadSettings();
        });
    });

    // ---- Settings ----

    const loadSettings = () => {
        const config = Object.assign({}, window.PXNDAS_CONFIG || {}, Security.secureStore.get('pxndas_config') || {});
        const modeEl = document.getElementById('settings-payment-mode');
        if (modeEl) {
            const isLive = config.PAYMENT_MODE === 'live';
            modeEl.textContent = isLive ? 'LIVE (real payments)' : 'TEST (mock payments)';
            modeEl.style.color = isLive ? 'var(--secondary)' : 'var(--neon-yellow)';
        }

        // Idle timeout
        const slider = document.getElementById('idleTimeoutSlider');
        const label = document.getElementById('idleTimeoutLabel');
        if (slider && label) {
            const saved = parseInt(localStorage.getItem('pxndas_idle_timeout') || '15');
            slider.value = saved;
            label.textContent = saved + ' min';
        }

        // Storage usage
        const usageEl = document.getElementById('storageUsage');
        if (usageEl) {
            let totalBytes = 0;
            for (let key in localStorage) {
                if (localStorage.hasOwnProperty(key)) {
                    totalBytes += (localStorage[key].length + key.length) * 2;
                }
            }
            const kb = (totalBytes / 1024).toFixed(1);
            usageEl.textContent = kb + ' KB';
        }

        // AI config — auto-save defaults if not configured yet
        if (!localStorage.getItem('pxndas_ai_key')) {
            // Try to fetch from server env
            fetch('/api/config').then(r => r.json()).then(cfg => {
                if (cfg.ok && cfg.aiKey) {
                    localStorage.setItem('pxndas_ai_key', cfg.aiKey);
                    if (cfg.aiModel) localStorage.setItem('pxndas_ai_model', cfg.aiModel);
                    if (cfg.aiProvider) localStorage.setItem('pxndas_ai_provider', cfg.aiProvider);
                    loadSettings();
                }
            }).catch(() => {});
        }
        const savedKey = localStorage.getItem('pxndas_ai_key') || '';
        const savedModel = localStorage.getItem('pxndas_ai_model') || 'openai/gpt-4o-mini';
        const savedProvider = localStorage.getItem('pxndas_ai_provider') || 'openrouter';
        const aiKeyInput = document.getElementById('aiApiKey');
        const aiModelSelect = document.getElementById('aiModel');
        const aiProviderSelect = document.getElementById('aiProvider');
        const aiStatus = document.getElementById('aiStatus');
        if (aiKeyInput) aiKeyInput.value = savedKey;
        if (aiModelSelect) aiModelSelect.value = savedModel;
        if (aiProviderSelect) aiProviderSelect.value = savedProvider;
        if (aiStatus) {
            aiStatus.textContent = savedKey ? 'Configured ✓' : 'Not configured';
            aiStatus.style.color = savedKey ? 'var(--secondary)' : 'var(--neon-yellow)';
        }
        // Switch model options based on provider
        if (aiProviderSelect && aiModelSelect) {
            const updateModels = () => {
                const prov = aiProviderSelect.value;
                if (prov === 'gemini') {
                    aiModelSelect.innerHTML = `
                        <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash (free)</option>
                        <option value="gemini-1.5-flash">Gemini 1.5 Flash (free)</option>
                        <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                    `;
                } else {
                    aiModelSelect.innerHTML = `
                        <option value="openai/gpt-4o">GPT-4o (smartest)</option>
                        <option value="openai/gpt-4o-mini">GPT-4o Mini (fast)</option>
                        <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
                        <option value="google/gemini-2.0-flash-001">Gemini 2.0 Flash</option>
                        <option value="meta-llama/llama-3.1-405b-instruct">Llama 3.1 405B</option>
                        <option value="deepseek/deepseek-r1">DeepSeek R1</option>
                        <option value="mistralai/mistral-large">Mistral Large</option>
                    `;
                }
                aiModelSelect.value = localStorage.getItem('pxndas_ai_model') || aiModelSelect.options[0].value;
            };
            updateModels();
            aiProviderSelect.addEventListener('change', updateModels);
        }
    };

    // Idle timeout slider
    const timeoutSlider = document.getElementById('idleTimeoutSlider');
    const timeoutLabel = document.getElementById('idleTimeoutLabel');
    if (timeoutSlider && timeoutLabel) {
        timeoutSlider.addEventListener('input', () => {
            const val = timeoutSlider.value;
            timeoutLabel.textContent = val + ' min';
            localStorage.setItem('pxndas_idle_timeout', val);
        });
    }

    // Clear orders
    const clearOrdersBtn = document.getElementById('clearOrdersBtn');
    if (clearOrdersBtn) {
        clearOrdersBtn.addEventListener('click', () => {
            if (!confirm('Delete ALL order/service request records? This cannot be undone.')) return;
            Security.secureStore.set('service_requests', []);
            Security.auditLog('ADMIN_CLEARED_ORDERS', {});
            Security.toast.show('All orders cleared.', 'success');
        });
    }

    // Clear audit log
    const clearAuditBtn = document.getElementById('clearAuditBtn');
    if (clearAuditBtn) {
        clearAuditBtn.addEventListener('click', () => {
            if (!confirm('Delete the entire audit log?')) return;
            Security.secureStore.set('pxndas_audit_log', []);
            Security.toast.show('Audit log cleared.', 'success');
        });
    }

    // Clear all data
    const clearAllBtn = document.getElementById('clearAllBtn');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
            if (!confirm('⚠️ This will delete ALL data including users, orders, posts, accounts. Are you sure?')) return;
            if (!confirm('Last warning: all data will be permanently lost. Continue?')) return;
            Security.secureStore.clear();
            Security.secureStore.set('pxndas_audit_log', []);
            Security.toast.show('All data has been reset.', 'info');
            setTimeout(() => location.reload(), 1000);
        });
    }

    // AI Config
    const saveAiBtn = document.getElementById('saveAiConfig');
    if (saveAiBtn) {
        saveAiBtn.addEventListener('click', () => {
            const key = document.getElementById('aiApiKey').value.trim();
            const model = document.getElementById('aiModel').value;
            const provider = document.getElementById('aiProvider').value;
            localStorage.setItem('pxndas_ai_key', key);
            localStorage.setItem('pxndas_ai_model', model);
            localStorage.setItem('pxndas_ai_provider', provider);
            Security.auditLog('AI_CONFIG_UPDATED', { provider, model });
            Security.toast.show('AI config saved.', 'success');
            if (window.updateChatHeader) window.updateChatHeader();
            loadSettings();
        });
    }

    // AI Test button
    const testAiBtn = document.getElementById('testAiBtn');
    if (testAiBtn) {
        testAiBtn.addEventListener('click', async () => {
            const key = document.getElementById('aiApiKey').value.trim();
            const model = document.getElementById('aiModel').value;
            const provider = document.getElementById('aiProvider').value;
            if (!key) { Security.toast.show('Enter an API key first.', 'warning'); return; }

            testAiBtn.textContent = 'Testing...';
            testAiBtn.disabled = true;
            try {
                const res = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider, apiKey: key, model, query: 'Say OK in one word.', context: 'Reply concisely.' })
                });
                const json = await res.json();
                if (json.ok) {
                    Security.toast.show('API key works! ✅', 'success');
                    localStorage.setItem('pxndas_ai_key', key);
                    localStorage.setItem('pxndas_ai_model', model);
                    localStorage.setItem('pxndas_ai_provider', provider);
                    Security.auditLog('AI_TEST_OK', { provider, model });
                    if (window.updateChatHeader) window.updateChatHeader();
                    loadSettings();
                } else {
                    Security.toast.show(`API error: ${json.error}`, 'error');
                }
            } catch (e) {
                Security.toast.show(`Cannot reach the API server. Is it running?`, 'error');
            }
            testAiBtn.textContent = 'Test';
            testAiBtn.disabled = false;
        });
    }

    // ---- Post Creation ----

    if (newPostForm) {
        newPostForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const rawTitle = document.getElementById('postTitle').value.trim();
            const rawContent = document.getElementById('postContent').value.trim();

            if (!rawTitle || !rawContent) {
                Security.toast.show('Both title and content are required.', 'warning');
                return;
            }
            if (rawTitle.length > 200 || rawContent.length > 5000) {
                Security.toast.show('Content exceeds maximum length.', 'warning');
                return;
            }

            const posts = Security.secureStore.get('pxnda_posts') || [];
            posts.unshift({
                title: Security.sanitize(rawTitle),
                content: Security.sanitize(rawContent),
                date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()
            });
            Security.secureStore.set('pxnda_posts', posts);
            Security.auditLog('POST_CREATED', { title: rawTitle });

            Security.toast.show('Post published successfully!', 'success');
            newPostForm.reset();
            loadAdminPosts();
        });
    }

    // ---- Post & Account Deletion ----

    if (adminPostsList) {
        adminPostsList.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-delete')) {
                if (!confirm('Delete this post?')) return;
                const index = parseInt(e.target.dataset.index);
                const posts = Security.secureStore.get('pxnda_posts') || [];
                if (index >= 0 && index < posts.length) {
                    const deleted = posts.splice(index, 1);
                    Security.secureStore.set('pxnda_posts', posts);
                    Security.auditLog('POST_DELETED', { title: deleted[0]?.title });
                    loadAdminPosts();
                }
            }
        });
    }

    if (adminAccountsList) {
        adminAccountsList.addEventListener('click', (e) => {
            if (e.target.classList.contains('btn-delete')) {
                if (!confirm('Delete this listing?')) return;
                const index = parseInt(e.target.dataset.index);
                const accounts = Security.secureStore.get('store_accounts') || [];
                if (index >= 0 && index < accounts.length) {
                    const deleted = accounts.splice(index, 1);
                    Security.secureStore.set('store_accounts', accounts);
                    Security.auditLog('ACCOUNT_DELETED', { title: deleted[0]?.title });
                    loadAccounts();
                }
            }
        });
    }

    // ---- Initial Load ----

    loadDashboard();
    loadServiceRequests();
    loadAdminPosts();
    setupTicketReply();
    setupLiveChatSend();
    startLiveChatPoll();
});
