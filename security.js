// Security utilities for pxndas

const Security = (() => {
    // HTML entity encoding to prevent XSS
    const sanitize = (str) => {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    };

    // Sanitize an array of objects by specified keys
    const sanitizeObject = (obj, keys) => {
        const safe = { ...obj };
        keys.forEach(key => {
            if (safe[key]) safe[key] = sanitize(safe[key]);
        });
        return safe;
    };

    // Generate a cryptographically random token
    const generateToken = (length = 32) => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);
        return Array.from(array, byte => chars[byte % chars.length]).join('');
    };

    // Simple XOR + Base64 encoding for localStorage (not true encryption, just obfuscation)
    const encode = (data) => {
        try {
            const json = JSON.stringify(data);
            const key = 'pxndas_secure_2026';
            let result = '';
            for (let i = 0; i < json.length; i++) {
                result += String.fromCharCode(json.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return btoa(unescape(encodeURIComponent(result)));
        } catch {
            return '';
        }
    };

    const decode = (encoded) => {
        try {
            const decoded = decodeURIComponent(escape(atob(encoded)));
            const key = 'pxndas_secure_2026';
            let result = '';
            for (let i = 0; i < decoded.length; i++) {
                result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return JSON.parse(result);
        } catch {
            return null;
        }
    };

    // Server mode when running on HTTP(S) — file:// falls back to localStorage
    const isServerMode = () => window.location.protocol === 'http:' || window.location.protocol === 'https:';

    // Keys that are per-user and stay in localStorage
    const localKeys = new Set(['pxndas_logged_in', 'theme', 'pxndas_ai_key', 'pxndas_ai_model', 'pxndas_ai_provider', 'pxndas_idle_timeout']);

    const serverGet = (key) => {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/data/' + encodeURIComponent(key), false);
            xhr.send();
            if (xhr.status >= 200 && xhr.status < 300) {
                const resp = JSON.parse(xhr.responseText);
                if (resp && resp.ok) return resp.data;
            }
        } catch {}
        return null;
    };

    const serverSet = (key, value) => {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/data/' + encodeURIComponent(key), false);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify(value));
            return xhr.status >= 200 && xhr.status < 300;
        } catch { return false; }
    };

    // Migrate existing localStorage data to server on first access
    const migrateIfNeeded = (key) => {
        if (!isServerMode() || localKeys.has(key)) return;
        const raw = localStorage.getItem(key);
        if (!raw) return;
        // Check if server already has data (treat empty arrays as no data)
        const serverVal = serverGet(key);
        const hasData = serverVal !== null && serverVal !== undefined && !(Array.isArray(serverVal) && !serverVal.length);
        if (hasData) return;
        // Try to decode and migrate
        try {
            const decoded = decode(raw);
            if (decoded !== null && decoded !== undefined) {
                serverSet(key, decoded);
            }
        } catch {}
    };

    // Secure localStorage wrapper with server API + client-side backup
    const BAK_PREFIX = '__bak_';
    const secureStore = {
        set(key, value) {
            if (isServerMode() && !localKeys.has(key)) {
                serverSet(key, value);
                // Keep a backup copy in localStorage so data survives server resets
                localStorage.setItem(BAK_PREFIX + key, encode(value));
                return;
            }
            localStorage.setItem(key, encode(value));
        },
        get(key) {
            if (isServerMode() && !localKeys.has(key)) {
                migrateIfNeeded(key);
                const serverVal = serverGet(key);
                // If server returned empty, try restoring from backup or raw localStorage
                if (serverVal === null || serverVal === undefined || (Array.isArray(serverVal) && !serverVal.length)) {
                    // Check backup first (created by recent set() calls)
                    let bak = localStorage.getItem(BAK_PREFIX + key);
                    // Fallback to raw localStorage key (from older sessions)
                    if (!bak) bak = localStorage.getItem(key);
                    if (bak) {
                        try {
                            const decoded = decode(bak);
                            if (decoded !== null && decoded !== undefined) {
                                serverSet(key, decoded);
                                return decoded;
                            }
                        } catch {}
                    }
                }
                return serverVal;
            }
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            return decode(raw);
        },
        remove(key) {
            if (isServerMode() && !localKeys.has(key)) {
                serverSet(key, null);
                localStorage.removeItem(BAK_PREFIX + key);
                return;
            }
            localStorage.removeItem(key);
        },
        clear() {
            if (isServerMode()) {
                const shared = ['pxndas_users', 'service_requests', 'store_accounts', 'pxnda_posts', 'support_tickets', 'live_chat_messages'];
                shared.forEach(k => {
                    serverSet(k, null);
                    localStorage.removeItem(BAK_PREFIX + k);
                });
            }
            const safe = ['theme', 'pxndas_ai_key', 'pxndas_ai_model', 'pxndas_ai_provider', 'pxndas_has_server_key'];
            const keep = new Set(safe);
            Object.keys(localStorage).forEach(k => {
                if (!keep.has(k) && !k.startsWith(BAK_PREFIX)) localStorage.removeItem(k);
            });
        }
    };

    // Rate limiter for login attempts
    const createRateLimiter = (maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
        const attempts = new Map();

        return {
            check(identifier) {
                const now = Date.now();
                const record = attempts.get(identifier);

                if (!record) {
                    attempts.set(identifier, { count: 1, start: now, blocked: false, blockedUntil: 0 });
                    return { allowed: true, remaining: maxAttempts - 1 };
                }

                if (record.blocked && now < record.blockedUntil) {
                    const waitMs = Math.ceil((record.blockedUntil - now) / 1000);
                    return { allowed: false, remaining: 0, waitMs };
                }

                if (record.blocked && now >= record.blockedUntil) {
                    attempts.set(identifier, { count: 1, start: now, blocked: false, blockedUntil: 0 });
                    return { allowed: true, remaining: maxAttempts - 1 };
                }

                if (now - record.start > windowMs) {
                    attempts.set(identifier, { count: 1, start: now, blocked: false, blockedUntil: 0 });
                    return { allowed: true, remaining: maxAttempts - 1 };
                }

                record.count++;
                if (record.count >= maxAttempts) {
                    record.blocked = true;
                    record.blockedUntil = now + (60 * 60 * 1000); // 1 hour ban
                    return { allowed: false, remaining: 0, waitMs: 3600 };
                }

                return { allowed: true, remaining: maxAttempts - record.count };
            },

            getRemaining(identifier) {
                const record = attempts.get(identifier);
                if (!record) return maxAttempts;
                if (record.blocked) return 0;
                return Math.max(0, maxAttempts - record.count);
            },

            reset(identifier) {
                attempts.delete(identifier);
            }
        };
    };

    // Password strength checker
    const checkPasswordStrength = (password) => {
        const checks = {
            minLength: password.length >= 8,
            hasUpper: /[A-Z]/.test(password),
            hasLower: /[a-z]/.test(password),
            hasDigit: /\d/.test(password),
            hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(password)
        };

        const score = Object.values(checks).filter(Boolean).length;
        let strength = 'weak';
        let label = 'Weak';

        if (score >= 5) { strength = 'strong'; label = 'Strong'; }
        else if (score >= 3) { strength = 'medium'; label = 'Medium'; }

        return { score, strength, label, checks };
    };

    // Validate email format
    const isValidEmail = (email) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    };

    // Validate username (alphanumeric + underscores, 3-20 chars)
    const isValidUsername = (username) => {
        return /^[a-zA-Z0-9_]{3,20}$/.test(username);
    };

    // Sanitize a string for use in HTML attributes
    const sanitizeAttr = (str) => {
        return sanitize(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    // Idle session timeout tracker
    const createIdleTracker = (timeoutMs = 15 * 60 * 1000, onTimeout) => {
        let timer;

        const reset = () => {
            clearTimeout(timer);
            timer = setTimeout(onTimeout, timeoutMs);
        };

        const start = () => {
            const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];
            events.forEach(e => document.addEventListener(e, reset));
            reset();
        };

        const stop = () => {
            clearTimeout(timer);
        };

        return { start, stop, reset };
    };

    // Audit logger for security events
    const auditLog = (event, details = {}) => {
        const logs = secureStore.get('pxndas_audit_log') || [];
        logs.unshift({
            event,
            details,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent.substring(0, 100)
        });
        if (logs.length > 100) logs.length = 100;
        secureStore.set('pxndas_audit_log', logs);
    };

    // Toast notification system
    let toastContainer = null;
    const ensureContainer = () => {
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
            document.body.appendChild(toastContainer);
        }
        return toastContainer;
    };

    const showToast = (message, type = 'info', duration = 4000) => {
        const container = ensureContainer();
        const colors = {
            success: { bg: 'rgba(16,185,129,0.95)', border: '#10b981', glow: 'rgba(16,185,129,0.4)' },
            error: { bg: 'rgba(239,68,68,0.95)', border: '#ef4444', glow: 'rgba(239,68,68,0.4)' },
            warning: { bg: 'rgba(245,158,11,0.95)', border: '#f59e0b', glow: 'rgba(245,158,11,0.4)' },
            info: { bg: 'rgba(0,255,255,0.9)', border: '#00ffff', glow: 'rgba(0,255,255,0.3)' }
        };
        const c = colors[type] || colors.info;
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `background:${c.bg};color:#000;padding:12px 20px;border-radius:10px;font-size:0.85rem;font-weight:700;border:1px solid ${c.border};box-shadow:0 8px 30px ${c.glow};pointer-events:auto;cursor:pointer;animation:slideInRight 0.3s ease forwards;max-width:380px;font-family:'Inter',sans-serif;letter-spacing:0.3px;`;
        toast.addEventListener('click', () => {
            toast.style.animation = 'slideOutRight 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        });
        container.appendChild(toast);
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.animation = 'slideOutRight 0.3s ease forwards';
                setTimeout(() => toast.remove(), 300);
            }
        }, duration);
    };

    // Inject toast animations once
    (() => {
        if (document.getElementById('toast-animations')) return;
        const style = document.createElement('style');
        style.id = 'toast-animations';
        style.textContent = `
            @keyframes slideInRight { from { opacity:0; transform:translateX(80px); } to { opacity:1; transform:translateX(0); } }
            @keyframes slideOutRight { from { opacity:1; transform:translateX(0); } to { opacity:0; transform:translateX(80px); } }
        `;
        document.head.appendChild(style);
    })();

    return {
        sanitize,
        sanitizeObject,
        generateToken,
        secureStore,
        createRateLimiter,
        checkPasswordStrength,
        isValidEmail,
        isValidUsername,
        sanitizeAttr,
        createIdleTracker,
        auditLog,
        toast: { show: showToast }
    };
})();
