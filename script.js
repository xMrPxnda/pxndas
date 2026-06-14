document.addEventListener('DOMContentLoaded', () => {
    let cartCount = 0;
    const cartCountElement = document.getElementById('cart-count');
    const themeToggle = document.getElementById('theme-toggle');
    const productSearch = document.getElementById('productSearch');
    const filterButtons = document.querySelectorAll('.filter-btn');
    const config = Object.assign({}, window.PXNDAS_CONFIG || { PAYMENT_MODE: 'test' }, Security.secureStore.get('pxndas_config') || {});

    const loadScript = (src) => new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });

    // Load payment SDKs based on mode
    const PAYMENT_MODE = config.PAYMENT_MODE;
    if (PAYMENT_MODE === 'live') {
        if (config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_ID !== 'test') {
            loadScript(`https://www.paypal.com/sdk/js?client-id=${config.PAYPAL_CLIENT_ID}&currency=USD&disable-funding=card,venmo,paylater`);
        }
    }

    const toggleTheme = () => {
        document.body.style.transition = 'background-color 0.3s ease, color 0.3s ease';
        if (document.body.classList.contains('light-theme')) {
            document.body.classList.replace('light-theme', 'dark-theme');
            themeToggle.textContent = '☀️';
            localStorage.setItem('theme', 'dark');
        } else {
            document.body.classList.replace('dark-theme', 'light-theme');
            themeToggle.textContent = '🌓';
            localStorage.setItem('theme', 'light');
        }
    };

    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (savedTheme === 'dark') {
        document.body.classList.replace('light-theme', 'dark-theme');
        themeToggle.textContent = '☀️';
    } else {
        document.body.classList.replace('dark-theme', 'light-theme');
        themeToggle.textContent = '🌓';
    }

    themeToggle.addEventListener('click', toggleTheme);

    productSearch.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        document.querySelectorAll('.product-card').forEach(card => {
            const title = card.querySelector('h3').textContent.toLowerCase();
            const desc = card.querySelector('p').textContent.toLowerCase();
            card.style.opacity = '0.3';
            card.style.transform = 'scale(0.95)';
            if (title.includes(searchTerm) || desc.includes(searchTerm)) {
                setTimeout(() => {
                    card.style.display = 'block';
                    requestAnimationFrame(() => {
                        card.style.opacity = '1';
                        card.style.transform = 'scale(1)';
                    });
                }, 50);
            } else {
                card.style.display = 'none';
            }
        });
        if (e.target.value === '') {
            document.querySelectorAll('.product-card').forEach(card => {
                card.style.opacity = '1';
                card.style.transform = 'scale(1)';
            });
        }
    });

    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const category = btn.dataset.category;
            document.querySelectorAll('.product-card').forEach((card, i) => {
                if (category === 'all' || card.dataset.category === category) {
                    card.style.display = 'block';
                    card.style.opacity = '0';
                    card.style.transform = 'translateY(15px)';
                    setTimeout(() => {
                        card.style.opacity = '1';
                        card.style.transform = 'translateY(0)';
                    }, i * 60);
                } else {
                    card.style.display = 'none';
                }
            });
        });
    });

    // Cart persistence
    let cart = JSON.parse(localStorage.getItem('pxndas_cart') || '[]');
    const cartWrapper = document.querySelector('.cart-wrapper');
    const checkoutModal = document.getElementById('checkoutModal');
    const successModal = document.getElementById('successModal');
    const cartItemsList = document.getElementById('cartItemsList');
    const cartTotalElement = document.getElementById('cartTotal');

    const saveCart = () => {
        localStorage.setItem('pxndas_cart', JSON.stringify(cart));
        cartCount = cart.length;
        cartCountElement.textContent = cartCount;
    };

    // Restore cart count
    cartCount = cart.length;
    cartCountElement.textContent = cartCount;

    const loggedInSession = Security.secureStore.get('pxndas_logged_in');
    let idleTracker = null;
    if (loggedInSession && loggedInSession.token) {
        idleTracker = Security.createIdleTracker(15 * 60 * 1000, () => {
            Security.secureStore.remove('pxndas_logged_in');
            Security.auditLog('SESSION_IDLE_TIMEOUT', { username: loggedInSession.username });
            Security.toast.show('Session timed out due to inactivity.', 'warning');
            setTimeout(() => location.reload(), 1500);
        });
        idleTracker.start();
    }

    const animateCount = () => {
        cartCountElement.style.transform = 'scale(1.4)';
        setTimeout(() => { cartCountElement.style.transform = 'scale(1)'; }, 200);
    };

    cartWrapper.addEventListener('click', () => {
        if (cart.length === 0) {
            cartWrapper.querySelector('.cart-icon').style.animation = 'shake 0.4s ease';
            setTimeout(() => {
                cartWrapper.querySelector('.cart-icon').style.animation = '';
            }, 400);
            Security.toast.show('Your cart is empty!', 'warning');
            return;
        }
        renderCheckout();
        checkoutModal.style.display = 'block';
    });

    const shakeKeyframes = `
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            20% { transform: translateX(-5px); }
            40% { transform: translateX(5px); }
            60% { transform: translateX(-5px); }
            80% { transform: translateX(5px); }
        }
    `;
    const styleSheet = document.createElement('style');
    styleSheet.textContent = shakeKeyframes;
    document.head.appendChild(styleSheet);

    const renderCheckout = () => {
        cartItemsList.innerHTML = '';
        let total = 0;
        cart.forEach((item, i) => {
            const row = document.createElement('div');
            row.className = 'cart-item-row';
            row.style.animation = 'slideIn 0.3s ease forwards';
            row.style.alignItems = 'center';
            row.innerHTML = `<span>${item.name}</span><span style="display:flex;align-items:center;gap:12px;">$${item.price.toFixed(2)}<button class="remove-item" data-index="${i}" style="background:none;border:1px solid rgba(255,0,255,0.3);color:var(--neon-pink);border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:0.8rem;line-height:1;display:flex;align-items:center;justify-content:center;transition:var(--transition);">&times;</button></span>`;
            cartItemsList.appendChild(row);
            total += item.price;
        });
        cartTotalElement.textContent = `$${total.toFixed(2)}`;

        document.querySelectorAll('.remove-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index);
                cart.splice(idx, 1);
                saveCart();
                renderCheckout();
                if (cart.length === 0) checkoutModal.style.display = 'none';
            });
        });
    };

    document.getElementById('closeCheckout').addEventListener('click', () => {
        checkoutModal.style.display = 'none';
    });

    document.getElementById('closeSuccess').addEventListener('click', () => {
        successModal.style.display = 'none';
        cart = [];
        saveCart();
    });

    // Update payment mode badge
    const modeBadge = document.getElementById('payment-mode-badge');
    if (modeBadge) {
        modeBadge.textContent = PAYMENT_MODE === 'live' ? 'PAYMENT MODE: LIVE' : 'PAYMENT MODE: TEST';
        modeBadge.style.color = PAYMENT_MODE === 'live' ? 'var(--secondary)' : 'var(--neon-yellow)';
    }

    // --- PayPal Integration ---
    const initPayPal = () => {
        if (PAYMENT_MODE === 'live' && window.paypal) {
            paypal.Buttons({
                createOrder: function(data, actions) {
                    let total = 0;
                    cart.forEach(item => total += item.price);
                    return actions.order.create({
                        purchase_units: [{ amount: { value: total.toFixed(2) } }]
                    });
                },
                onApprove: function(data, actions) {
                    return actions.order.capture().then(function(details) {
                        const orderId = details.id;
                        const total = cartTotalElement.textContent;
                        const items = Security.sanitize(cart.map(i => i.name).join(', '));
                        const email = Security.sanitize(details.payer.email_address);

                        const requests = Security.secureStore.get('service_requests') || [];
                        requests.unshift({ id: orderId, email, items, total, status: 'PAID', date: new Date().toLocaleString() });
                        Security.secureStore.set('service_requests', requests);
                        Security.auditLog('PAYPAL_PURCHASE', { orderId, items, email });

                        checkoutModal.style.display = 'none';
                        successModal.style.display = 'block';
                        document.getElementById('orderIdDisplay').textContent = orderId;
                    });
                }
            }).render('#paypal-button-container');
        } else if (PAYMENT_MODE === 'test') {
            const container = document.getElementById('paypal-button-container');
            if (container) {
                container.innerHTML = `
                    <div style="text-align:center;">
                        <div style="padding:0.8rem;border:1px dashed rgba(255,255,255,0.15);border-radius:8px;color:var(--text-muted);font-size:0.75rem;margin-bottom:1rem;">
                            Test Mode — No real charge
                        </div>
                        <button id="testPayBtn" class="btn btn-primary" style="width:100%;padding:0.9rem;">
                            Complete Test Purchase
                        </button>
                    </div>
                `;
                document.getElementById('testPayBtn').addEventListener('click', () => {
                    const orderId = 'TEST-' + Date.now().toString(36).toUpperCase();
                    const total = cartTotalElement.textContent;
                    const items = Security.sanitize(cart.map(i => i.name).join(', '));
                    const requests = Security.secureStore.get('service_requests') || [];
                    requests.unshift({ id: orderId, email: 'test@pxndas.io', items, total, status: 'PAID', date: new Date().toLocaleString() });
                    Security.secureStore.set('service_requests', requests);
                    Security.auditLog('TEST_PURCHASE', { orderId, items });
                    checkoutModal.style.display = 'none';
                    successModal.style.display = 'block';
                    document.getElementById('orderIdDisplay').textContent = orderId;
                });
            }
        }
    };

    // Retry PayPal init in case SDK loads after DOMContentLoaded
    const paypalReady = () => window.paypal || PAYMENT_MODE === 'test';
    if (paypalReady()) {
        initPayPal();
    } else {
        const paypalInterval = setInterval(() => {
            if (paypalReady()) {
                clearInterval(paypalInterval);
                initPayPal();
            }
        }, 300);
        setTimeout(() => { clearInterval(paypalInterval); initPayPal(); }, 8000);
    }

    const addToCartButtons = document.querySelectorAll('.add-to-cart');
    addToCartButtons.forEach(button => {
        button.addEventListener('click', () => {
            const card = button.closest('.product-card');
            const name = card.querySelector('h3').textContent;
            const price = parseFloat(card.querySelector('.price').textContent.replace('$', ''));

            cart.push({ name, price });
            saveCart();
            animateCount();

            button.textContent = '✓ Added';
            button.style.background = 'var(--secondary)';
            button.style.borderColor = 'var(--secondary)';
            button.style.color = 'white';
            button.disabled = true;

            card.style.transform = 'scale(0.98)';
            setTimeout(() => { card.style.transform = ''; }, 200);

            setTimeout(() => {
                button.textContent = 'Add to Cart';
                button.style.background = '';
                button.style.borderColor = '';
                button.style.color = '';
                button.disabled = false;
            }, 1200);
        });
    });

    const loadPosts = () => {
        const postsGrid = document.getElementById('postsGrid');
        if (!postsGrid) return;

        const posts = Security.secureStore.get('pxnda_posts') || [];
        const escapeHtml = (str) => Security.sanitize(str || '');

        const renderPost = (post, index) => `
            <article class="post-card" style="animation: slideIn 0.4s ease ${index * 0.1}s forwards; opacity: 0;">
                <div class="post-date-box">
                    <div class="post-date">${escapeHtml(post.date)}</div>
                    <div class="post-id">ENTRY_ID: 0x${escapeHtml((Math.floor(Math.random()*1000)).toString(16))}</div>
                </div>
                <div class="post-content-box">
                    <div class="post-tag">Security_Alert</div>
                    <h3>${escapeHtml(post.title)}</h3>
                    <p>${escapeHtml(post.content)}</p>
                    <a href="#" class="read-more">DECRYPT FULL ENTRY...</a>
                </div>
            </article>
        `;

        const staticPost = {
            date: "JUNE 14, 2026",
            title: "System Protocol Update",
            content: "We've implemented new quantum encryption across all digital asset deliveries. Security is our priority."
        };

        postsGrid.innerHTML = renderPost(staticPost, 0) + posts.map((post, i) => renderPost(post, i+1)).join('');
    };

    loadPosts();

    // Load dynamic store accounts from admin
    const loadStoreAccounts = () => {
        const grid = document.getElementById('productGrid');
        if (!grid) return;
        const accounts = Security.secureStore.get('store_accounts') || [];
        accounts.forEach((acc, i) => {
            const card = document.createElement('div');
            card.className = 'product-card';
            card.dataset.category = acc.category || 'other';
            const cardImage = (acc.images?.length ? acc.images[0] : null) || acc.image || null;
            const hasImage = cardImage && cardImage.startsWith('data:');
            card.innerHTML = `
                <span class="product-status" style="background:linear-gradient(135deg,#f59e0b,#d97706);box-shadow:0 4px 15px rgba(245,158,11,0.3);">Listed</span>
                <div class="card-image" style="${hasImage ? `background-image:url('${Security.sanitize(cardImage)}');background-size:cover;background-position:center;font-size:0;` : ''}">${hasImage ? '' : Security.sanitize(acc.icon || '🔑')}</div>
                <div class="card-body">
                    <span class="category-tag">${Security.sanitize((acc.category || 'other').toUpperCase())}</span>
                    <h3>${Security.sanitize(acc.title)}</h3>
                    <p>${Security.sanitize(acc.desc)}</p>
                    <div class="card-footer">
                        <span class="price">$${Security.sanitize(acc.price)}</span>
                        <button class="add-to-cart">Add to Cart</button>
                    </div>
                </div>
            `;
            card.dataset.accIndex = i;
            card.style.cursor = 'pointer';
            grid.appendChild(card);

            // Open detail modal on card click
            card.addEventListener('click', (e) => {
                if (e.target.closest('.add-to-cart')) return;
                openDetailModal(accounts[card.dataset.accIndex]);
            });

            // Wire up the add-to-cart button
            const btn = card.querySelector('.add-to-cart');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const name = card.querySelector('h3').textContent;
                const price = parseFloat(card.querySelector('.price').textContent.replace('$', ''));
                cart.push({ name, price });
                saveCart();
                animateCount();

                btn.textContent = '✓ Added';
                btn.style.background = 'var(--secondary)';
                btn.style.borderColor = 'var(--secondary)';
                btn.style.color = 'white';
                btn.disabled = true;
                card.style.transform = 'scale(0.98)';
                setTimeout(() => { card.style.transform = ''; }, 200);
                setTimeout(() => {
                    btn.textContent = 'Add to Cart';
                    btn.style.background = '';
                    btn.style.borderColor = '';
                    btn.style.color = '';
                    btn.disabled = false;
                }, 1200);
            });
        });
    };
    
    // Product detail overlay
    const pdOverlay = document.getElementById('productDetailOverlay');
    const pdBackBtn = document.getElementById('pdBackBtn');
    const pdCloseBtn = document.getElementById('pdCloseBtn');
    let pdQty = 1;
    let currentPdAccount = null;

    const closePd = () => {
        pdOverlay.classList.remove('open');
        pdOverlay.style.display = 'none';
        document.body.style.overflow = '';
    };

    const openDetailModal = (acc) => {
        if (!pdOverlay || !acc) return;
        currentPdAccount = acc;
        pdQty = 1;

        const images = (acc.images && acc.images.length ? acc.images : (acc.image ? [acc.image] : []));
        const heroBg = document.getElementById('pdHeroBg');
        heroBg.innerHTML = '';
        if (!images.length) {
            heroBg.style.backgroundImage = '';
            heroBg.classList.remove('has-image');
            heroBg.innerHTML = `<span style="font-size:8rem;display:flex;align-items:center;justify-content:center;height:100%;opacity:0.6;">${Security.sanitize(acc.icon || '🔑')}</span>`;
        } else {
            heroBg.style.backgroundImage = `url('${Security.sanitize(images[0])}')`;
            heroBg.classList.add('has-image');
        }
        // Extra images gallery below purchase card
        const extraImages = images.length > 1 ? images.slice(1) : [];
        const strip = document.getElementById('pdGalleryStrip');
        if (extraImages.length) {
            strip.innerHTML = extraImages.map((img) =>
                `<div class="pd-gallery-card">
                    <img src="${Security.sanitize(img)}" alt="" loading="lazy">
                </div>`
            ).join('');
            strip.style.display = '';
        } else {
            strip.style.display = 'none';
        }

        document.getElementById('pdCategory').textContent = (acc.category || 'other').toUpperCase();
        const stock = parseInt(acc.stock) || 0;
        const stockEl = document.getElementById('pdStock');
        stockEl.textContent = stock > 0 ? `${stock} in stock` : 'Out of stock';
        stockEl.className = 'pd-stock ' + (stock > 0 ? 'in' : 'out');

        const titleEl = document.getElementById('pdTitle');
        titleEl.textContent = acc.title;
        titleEl.setAttribute('data-text', acc.title);

        document.getElementById('pdDesc').textContent = acc.desc || 'No description provided.';

        // Build features from description keywords + defaults
        const featuresEl = document.getElementById('pdFeatures');
        const desc = (acc.desc || '').toLowerCase();
        const extras = [];
        if (desc.includes('money') || desc.includes('cash') || desc.includes('$')) extras.push('Modded in-game currency');
        if (desc.includes('rank') || desc.includes('rp') || desc.includes('xp')) extras.push('Rank & XP unlocked');
        if (desc.includes('property') || desc.includes('bunker') || desc.includes('business')) extras.push('All properties & businesses');
        if (desc.includes('vehicle') || desc.includes('car') || desc.includes('garage')) extras.push('Rare vehicles & garages');
        if (desc.includes('recovery') || desc.includes('email') || desc.includes('access')) extras.push('Full email & account access');
        extras.push('Secure delivery & setup');
        const uniqueExtras = [...new Set(extras)].slice(0, 7);
        featuresEl.innerHTML = uniqueExtras.map(f =>
            `<li><span class="pf-icon">✓</span> ${Security.sanitize(f)}</li>`
        ).join('');

        const price = parseFloat(acc.price) || 0;
        document.getElementById('pdPriceLg').textContent = `$${price.toFixed(2)}`;
        document.getElementById('pdCurrentPrice').textContent = `$${price.toFixed(2)}`;

        document.getElementById('pdQtyVal').textContent = '1';
        document.getElementById('pdQtyMinus').disabled = true;

        const addBtn = document.getElementById('pdAddBtn');
        addBtn.textContent = 'Add to Cart';
        addBtn.className = 'pd-add-btn';
        addBtn.disabled = false;

        pdOverlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(() => {
            pdOverlay.classList.add('open');
            pdOverlay.scrollTop = 0;
        });
    };

    // Qty controls
    document.getElementById('pdQtyMinus').addEventListener('click', () => {
        if (pdQty > 1) {
            pdQty--;
            document.getElementById('pdQtyVal').textContent = pdQty;
            document.getElementById('pdQtyMinus').disabled = pdQty <= 1;
            if (currentPdAccount) {
                const price = parseFloat(currentPdAccount.price) || 0;
                document.getElementById('pdCurrentPrice').textContent = `$${(price * pdQty).toFixed(2)}`;
            }
        }
    });
    document.getElementById('pdQtyPlus').addEventListener('click', () => {
        if (pdQty < 99) {
            pdQty++;
            document.getElementById('pdQtyVal').textContent = pdQty;
            document.getElementById('pdQtyMinus').disabled = false;
            if (currentPdAccount) {
                const price = parseFloat(currentPdAccount.price) || 0;
                document.getElementById('pdCurrentPrice').textContent = `$${(price * pdQty).toFixed(2)}`;
            }
        }
    });

    document.getElementById('pdAddBtn').addEventListener('click', function() {
        if (!currentPdAccount) return;
        const price = parseFloat(currentPdAccount.price) || 0;
        for (let i = 0; i < pdQty; i++) {
            cart.push({ name: currentPdAccount.title, price });
        }
        saveCart();
        animateCount();
        this.textContent = `✓ Added ${pdQty} item${pdQty > 1 ? 's' : ''}`;
        this.className = 'pd-add-btn added';
        setTimeout(closePd, 800);
    });

    if (pdBackBtn) pdBackBtn.addEventListener('click', closePd);
    if (pdCloseBtn) pdCloseBtn.addEventListener('click', closePd);

    loadStoreAccounts();

    const authNav = document.getElementById('auth-nav');
    const adminNavLink = document.getElementById('admin-nav-link');
    const loggedInUser = Security.secureStore.get('pxndas_logged_in');

    if (loggedInUser) {
        if (Date.now() > loggedInUser.expires) {
            Security.secureStore.remove('pxndas_logged_in');
            Security.auditLog('SESSION_EXPIRED', { username: loggedInUser.username });
            Security.toast.show('Session expired. Please login again.', 'warning');
            setTimeout(() => location.reload(), 1500);
            return;
        }
        if (!loggedInUser.token || loggedInUser.token.length < 16) {
            Security.secureStore.remove('pxndas_logged_in');
            Security.auditLog('SESSION_INVALID_TOKEN', { username: loggedInUser.username });
            location.reload();
            return;
        }
    }

    if (loggedInUser && authNav) {
        if (loggedInUser.role === 'admin') {
            adminNavLink.style.display = 'block';
        }

        authNav.innerHTML = `
            <div class="user-menu">
                <span id="open-dashboard" style="color: var(--neon-blue); font-weight: 800; cursor: pointer;">@${loggedInUser.username}</span>
                <button id="logout-btn" style="background: none; border: none; color: var(--neon-pink); cursor: pointer; font-size: 0.8rem; margin-left: 10px;">Logout</button>
            </div>
        `;

        document.getElementById('logout-btn').addEventListener('click', () => {
            Security.secureStore.remove('pxndas_logged_in');
            Security.auditLog('LOGOUT', { username: loggedInUser.username });
            if (idleTracker) idleTracker.stop();
            Security.toast.show('Logged out successfully.', 'success');
            setTimeout(() => location.reload(), 500);
        });

        const dashboardModal = document.getElementById('userDashboardModal');
        const userRequestsList = document.getElementById('userRequestsList');

        document.getElementById('open-dashboard').addEventListener('click', () => {
            document.getElementById('dashboardTitle').textContent = `@${loggedInUser.username}'s Dashboard`;
            const allRequests = Security.secureStore.get('service_requests') || [];
            const userRequests = allRequests.filter(req => req.email === loggedInUser.email || loggedInUser.role === 'admin');

            userRequestsList.innerHTML = userRequests.length
                ? userRequests.map(req => `
                    <div class="manage-item" style="margin-bottom: 0.5rem; border: 1px solid rgba(0, 255, 255, 0.1); padding: 1rem; border-radius: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <strong style="color: var(--neon-blue)">${Security.sanitize(req.items)}</strong>
                                <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">ID: ${Security.sanitize(req.id)} | ${Security.sanitize(req.date)}</div>
                            </div>
                            <span class="badge active">${Security.sanitize(req.status)}</span>
                        </div>
                    </div>
                `).join('')
                : '<p style="color: var(--text-muted)">No active requests found.</p>';

            // Load user's support tickets
            const ticketsContainer = document.getElementById('user-tickets-list');
            const allTickets = Security.secureStore.get('support_tickets') || [];
            const userTickets = allTickets.filter(t => (t.user || t.username) === loggedInUser.username);

            ticketsContainer.innerHTML = userTickets.length
                ? userTickets.map((t, ti) => `
                    <div class="manage-item" style="margin-bottom:0.75rem;border:1px solid rgba(255,0,128,0.12);padding:1rem;border-radius:8px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                            <strong style="color:var(--neon-pink);font-size:0.85rem;">${Security.sanitize(t.subject)}</strong>
                            <span style="font-size:0.65rem;padding:2px 8px;border-radius:4px;${t.status === 'OPEN' ? 'background:rgba(245,158,11,0.15);color:#f59e0b;' : 'background:rgba(34,197,94,0.15);color:#22c55e;'}">${t.status}</span>
                        </div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.6rem;">${Security.sanitize(t.date)}</div>
                        <div style="font-size:0.82rem;color:#c0c8d8;padding:0.6rem;background:rgba(188,19,254,0.06);border-radius:6px;margin-bottom:0.5rem;">${Security.sanitize(t.message)}</div>
                        ${(t.replies || []).map(r => `
                            <div style="font-size:0.82rem;color:#c0c8d8;padding:0.6rem;background:${r.sender === 'admin' ? 'rgba(0,255,255,0.06)' : 'rgba(188,19,254,0.06)'};border-radius:6px;margin-bottom:0.4rem;margin-left:${r.sender === 'admin' ? '1.5rem' : '0'};border-left:${r.sender === 'admin' ? '2px solid var(--neon-blue)' : 'none'};">
                                <div style="font-size:0.6rem;color:var(--text-muted);margin-bottom:2px;">${r.sender === 'admin' ? 'Support' : 'You'} — ${r.date}</div>
                                ${Security.sanitize(r.text)}
                            </div>
                        `).join('')}
                        ${t.status === 'OPEN' ? `
                        <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
                            <input type="text" class="ticket-followup-input" data-ticket="${ti}" placeholder="Reply to this ticket..." style="flex:1;padding:0.5rem 0.7rem;background:rgba(255,255,255,0.04);border:1px solid rgba(255,0,128,0.15);border-radius:8px;color:#fff;font-size:0.8rem;outline:none;">
                            <button class="ticket-followup-btn" data-ticket="${ti}" style="padding:0.5rem 1rem;background:linear-gradient(135deg,var(--neon-pink),#cc0055);border:none;border-radius:8px;color:#fff;font-weight:700;font-size:0.7rem;cursor:pointer;white-space:nowrap;">Send</button>
                        </div>` : ''}
                    </div>
                `).join('')
                : '<p style="color:var(--text-muted);font-size:0.85rem;">No support tickets. Use the 💬 button to create one.</p>';

            // Wire up follow-up reply buttons
            ticketsContainer.querySelectorAll('.ticket-followup-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.dataset.ticket);
                    const input = ticketsContainer.querySelector(`.ticket-followup-input[data-ticket="${idx}"]`);
                    const text = input.value.trim();
                    if (!text || !allTickets[idx]) return;
                    if (!allTickets[idx].replies) allTickets[idx].replies = [];
                    allTickets[idx].replies.push({ text, sender: 'customer', date: new Date().toLocaleString() });
                    Security.secureStore.set('support_tickets', allTickets);
                    Security.auditLog('TICKET_FOLLOWUP', { subject: allTickets[idx].subject });
                    Security.toast.show('Reply sent. Support will review it.', 'success');
                    // Re-render tickets
                    document.getElementById('open-dashboard').click();
                });
            });

            dashboardModal.style.display = 'block';
        });

        document.getElementById('closeDashboard').addEventListener('click', () => {
            dashboardModal.style.display = 'none';
        });
    }

    window.addEventListener('click', (e) => {
        document.querySelectorAll('.modal').forEach(modal => {
            if (e.target === modal) modal.style.display = 'none';
        });
    });

    // Matrix Rain
    const canvas = document.getElementById('matrix-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
        window.addEventListener('resize', resize);
        resize();

        const characters = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$+-*/=%\"'#&_(),.;:?!\\|{}<>[]^~";
        const fontSize = 16;
        const columns = Math.floor(canvas.width / fontSize);
        const layers = [
            { drops: Array(columns).fill(1), color: 'rgba(0, 255, 255, 0.8)', font: 'bold 16px monospace', chance: 0.975 },
            { drops: Array(columns).fill(1), color: 'rgba(0, 255, 255, 0.3)', font: '12px monospace', chance: 0.99 },
            { drops: Array(columns).fill(1), color: 'rgba(188, 19, 254, 0.2)', font: '14px monospace', chance: 0.98 }
        ];

        const drawLayer = (layer) => {
            ctx.font = layer.font;
            for (let i = 0; i < layer.drops.length; i++) {
                const text = characters.charAt(Math.floor(Math.random() * characters.length));
                ctx.fillStyle = layer.color;
                if (layer.color.includes('0.8') && Math.random() > 0.9) {
                    ctx.fillStyle = '#fff';
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = '#fff';
                } else { ctx.shadowBlur = 0; }
                ctx.fillText(text, i * fontSize, layer.drops[i] * fontSize);
                if (layer.drops[i] * fontSize > canvas.height && Math.random() > layer.chance) layer.drops[i] = 0;
                layer.drops[i]++;
            }
        };

        const draw = () => {
            ctx.fillStyle = 'rgba(5, 5, 5, 0.1)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            layers.forEach(drawLayer);
        };
        setInterval(draw, 33);
    }

    // Cyber Clock
    const timeDisplay = document.getElementById('clock-time');
    const dateDisplay = document.getElementById('clock-date');
    const updateClock = () => {
        const now = new Date();
        const time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const date = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
        if (timeDisplay) timeDisplay.textContent = time;
        if (dateDisplay) dateDisplay.textContent = date;
    };
    setInterval(updateClock, 1000);
    updateClock();

    // Live Chat Support
    const chatBtn = document.getElementById('support-btn');
    const chatPanel = document.getElementById('live-chat-panel');
    const chatClose = document.getElementById('live-chat-close');
    const chatInput = document.getElementById('live-chat-input');
    const chatSend = document.getElementById('live-chat-send');
    const chatMessages = document.getElementById('live-chat-messages');

    if (chatBtn && chatPanel) {
        chatBtn.addEventListener('click', () => {
            const session = Security.secureStore.get('pxndas_logged_in');
            const prompt = document.getElementById('live-chat-login-prompt');
            if (!session) {
                if (prompt) {
                    prompt.style.display = 'flex';
                    chatPanel.classList.add('open');
                } else {
                    Security.toast.show('Log in to use live support.', 'warning');
                }
                return;
            }
            chatPanel.classList.toggle('open');
            if (chatPanel.classList.contains('open')) {
                chatInput.focus();
                loadLiveMessages(session.username);
            }
        });

        if (chatClose) {
            chatClose.addEventListener('click', () => chatPanel.classList.remove('open'));
        }

        // Send message
        const sendMsg = () => {
            const text = chatInput.value.trim();
            if (!text) return;
            const session = Security.secureStore.get('pxndas_logged_in');
            if (!session) return;
            const msgs = Security.secureStore.get('live_chat_messages') || [];
            msgs.push({ user: session.username, text, from: 'user', time: Date.now() });
            Security.secureStore.set('live_chat_messages', msgs);
            Security.auditLog('LIVE_CHAT_MSG', { user: session.username });
            chatInput.value = '';
            loadLiveMessages(session.username);
        };

        chatSend.addEventListener('click', sendMsg);
        chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMsg(); });

        // Typing indicator
        let typingTimer = null;
        chatInput.addEventListener('input', () => {
            const session = Security.secureStore.get('pxndas_logged_in');
            if (!session) return;
            const typing = Security.secureStore.get('live_chat_typing') || {};
            typing[session.username] = Date.now();
            Security.secureStore.set('live_chat_typing', typing);
            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => {
                const t = Security.secureStore.get('live_chat_typing') || {};
                delete t[session.username];
                Security.secureStore.set('live_chat_typing', t);
            }, 3000);
        });

        // Poll for new messages
        let lastCount = 0;
        setInterval(() => {
            const session = Security.secureStore.get('pxndas_logged_in');
            if (!session || !chatPanel.classList.contains('open')) return;
            const msgs = Security.secureStore.get('live_chat_messages') || [];
            const userMsgs = msgs.filter(m => m.user === session.username);
            if (userMsgs.length !== lastCount) {
                lastCount = userMsgs.length;
                loadLiveMessages(session.username);
            }
        }, 2000);

        // Click outside to close
        document.addEventListener('click', (e) => {
            if (chatPanel.classList.contains('open') && !chatPanel.contains(e.target) && e.target !== chatBtn && !chatBtn.contains(e.target)) {
                chatPanel.classList.remove('open');
            }
        });
    }

    const loadLiveMessages = (username) => {
        if (!chatMessages) return;
        const msgs = Security.secureStore.get('live_chat_messages') || [];
        const userMsgs = msgs.filter(m => m.user === username);
        chatMessages.innerHTML = '';
        if (!userMsgs.length) {
            chatMessages.innerHTML = '<div class="live-chat-msg system"><div class="bubble">Start a conversation! Ask about GTA accounts, orders, or anything.</div></div>';
            return;
        }
        userMsgs.forEach(m => {
            const div = document.createElement('div');
            div.className = 'live-chat-msg ' + (m.from === 'user' ? 'user' : 'admin');
            const label = m.from === 'user' ? 'You' : 'Support';
            const elapsed = Date.now() - m.time;
            let timeStr;
            if (elapsed < 60000) timeStr = 'just now';
            else if (elapsed < 3600000) timeStr = Math.floor(elapsed / 60000) + 'm ago';
            else if (elapsed < 86400000) timeStr = Math.floor(elapsed / 3600000) + 'h ago';
            else timeStr = new Date(m.time).toLocaleDateString();
            div.innerHTML = `<div class="bubble"><div class="sender-label">${label} · ${timeStr}</div>${Security.sanitize(m.text)}</div>`;
            chatMessages.appendChild(div);
        });
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };

    // Also keep the ticket form as fallback for async support

    // Smooth Scroll
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    const slideInKeyframes = `
        @keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    `;
    if (!document.querySelector('#slideInStyle')) {
        const s = document.createElement('style');
        s.id = 'slideInStyle';
        s.textContent = slideInKeyframes;
        document.head.appendChild(s);
    }
});
