const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const app = express();
const PORT = process.env.PORT || 8000;

// Rate limit state (in-memory)
const ipRequestCounts = new Map();

const rateLimit = (maxRequests, windowMs) => {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const now = Date.now();
        const key = ip + ':' + req.path;
        const entry = ipRequestCounts.get(key) || { count: 0, start: now };
        if (now - entry.start > windowMs) {
            entry.count = 0;
            entry.start = now;
        }
        entry.count++;
        ipRequestCounts.set(key, entry);
        if (entry.count > maxRequests) {
            return res.status(429).json({ ok: false, error: 'Too many requests. Slow down.' });
        }
        next();
    };
};

// Periodic cleanup of rate limit store
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of ipRequestCounts) {
        if (now - entry.start > 60000) ipRequestCounts.delete(key);
    }
}, 60000);

// Data directory
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Seed default data files on first run (survives Render redeploy)
const seedFile = (name, data) => {
    const fp = path.join(dataDir, name + '.json');
    if (!fs.existsSync(fp)) {
        fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`Seeded ${name}.json`);
    }
};
seedFile('pxnda_posts', []);
seedFile('store_accounts', []);
seedFile('pxndas_users', []);
seedFile('service_requests', []);
seedFile('support_tickets', []);
seedFile('live_chat_messages', []);

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Powered-By', 'pxndas');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    // HSTS (only in production with HTTPS)
    if (req.headers['x-forwarded-proto'] === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    next();
});

// CSP for HTML pages (only for non-API routes)
app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) {
        res.setHeader('Content-Security-Policy',
            "default-src 'self'; " +
            "script-src 'self' https://www.paypal.com https://www.paypalobjects.com https://fonts.googleapis.com https://fonts.gstatic.com 'unsafe-inline' 'unsafe-eval'; " +
            "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; " +
            "font-src 'self' https://fonts.gstatic.com; " +
            "img-src 'self' data: https://www.paypal.com; " +
            "frame-src https://www.paypal.com; " +
            "connect-src 'self' https://www.paypal.com https://openrouter.ai https://api.openai.com; " +
            "form-action 'self';"
        );
    }
    next();
});

// CORS — restrict to same-origin by default (no wildcard for write APIs)
const isSameOrigin = (req) => {
    const origin = req.headers.origin;
    const host = req.headers.host;
    // Missing origin is allowed for GET/read operations but NOT for writes
    if (!origin) return req.method === 'GET' || req.method === 'OPTIONS';
    try {
        const originUrl = new URL(origin);
        return originUrl.host === host || originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1';
    } catch { return false; }
};

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        // Only allow same-origin or localhost
        const host = req.headers.host;
        try {
            const originUrl = new URL(origin);
            if (originUrl.host === host || originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') {
                res.setHeader('Access-Control-Allow-Origin', origin);
            }
        } catch {}
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// Sanitize key to prevent path traversal
const safePath = (key) => {
    const safe = key.replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!safe) throw new Error('Invalid key');
    return path.join(dataDir, safe + '.json');
};

// --- API Proxy (rate limited) ---
app.post('/api/chat', rateLimit(30, 60000), async (req, res) => {
    let { provider, apiKey, model, query, context, history } = req.body;
    // If client sends __server__, use the server's env key
    if (apiKey === '__server__') {
        apiKey = process.env.AI_API_KEY || '';
    }
    if (!apiKey || !query) return res.status(400).json({ ok: false, error: 'Missing apiKey or query' });

    // Sanitize model name to prevent injection
    const safeModel = typeof model === 'string' ? model.replace(/[^a-zA-Z0-9_\-\/\.:]/g, '') : 'openai/gpt-4o-mini';

    try {
        let reply;
        if (provider === 'gemini') {
            if (!history || !Array.isArray(history)) {
                return res.status(400).json({ ok: false, error: 'Invalid history format' });
            }
            const msgs = [];
            let firstUser = true;
            let sanitizedContext = typeof context === 'string' ? context : '';
            for (const msg of history) {
                if (!msg || typeof msg !== 'object') continue;
                if (msg.role === 'system') {
                    if (firstUser) sanitizedContext = String(msg.content || '');
                } else if (msg.role === 'assistant') {
                    msgs.push({ role: 'model', parts: [{ text: String(msg.content || '') }] });
                } else if (msg.role === 'user') {
                    const text = firstUser && sanitizedContext ? `${sanitizedContext}\n\n${msg.content}` : String(msg.content || '');
                    msgs.push({ role: 'user', parts: [{ text }] });
                    firstUser = false;
                }
            }

            const gRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: msgs, generationConfig: { maxOutputTokens: 512, temperature: 0.7 } })
                }
            );
            if (!gRes.ok) {
                const errText = await gRes.text();
                throw new Error(`Gemini API ${gRes.status}`);
            }
            const gData = await gRes.json();
            reply = gData.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
        } else {
            // OpenRouter
            let msgs = history;
            if (!msgs || !Array.isArray(msgs) || msgs.length === 0) {
                msgs = [
                    { role: 'system', content: typeof context === 'string' ? context : '' },
                    { role: 'user', content: String(query) }
                ];
            }
            const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: safeModel,
                    messages: msgs,
                    max_tokens: 512,
                    temperature: 0.7
                })
            });
            if (!orRes.ok) {
                const errText = await orRes.text();
                throw new Error(`OpenRouter API ${orRes.status}`);
            }
            const orData = await orRes.json();
            reply = orData.choices?.[0]?.message?.content || 'No response';
        }

        return res.json({ ok: true, reply });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// --- Config API (no longer exposes API key to frontend) ---
app.get('/api/config', (req, res) => {
    res.json({
        ok: true,
        hasAiKey: !!process.env.AI_API_KEY,
        aiModel: process.env.AI_MODEL || 'openai/gpt-4o-mini',
        aiProvider: process.env.AI_PROVIDER || 'openrouter',
        hasSmtp: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
    });
});

// --- Email Receipt API ---
app.post('/api/send-receipt', rateLimit(10, 60000), async (req, res) => {
    try {
        const { email, orderId, items, total } = req.body;
        if (!email || !orderId) {
            return res.status(400).json({ ok: false, error: 'Missing email or orderId' });
        }
        const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_ADMIN_EMAIL } = process.env;
        if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
            return res.status(400).json({ ok: false, error: 'SMTP not configured' });
        }
        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: parseInt(SMTP_PORT || '587'),
            secure: SMTP_PORT === '465',
            auth: { user: SMTP_USER, pass: SMTP_PASS }
        });
        const from = SMTP_FROM || SMTP_USER;
        const date = new Date().toLocaleString();

        // Customer receipt
        await transporter.sendMail({
            from,
            to: email,
            subject: 'Purchase Confirmation — pxndas',
            html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;background:#0a0a1a;color:#c0c8d8;padding:2rem;margin:0}.card{max-width:560px;margin:auto;background:#12122a;border:1px solid rgba(0,255,255,0.2);border-radius:12px;padding:2rem;text-align:center}.logo{font-size:1.5rem;font-weight:800;color:#00ffff;letter-spacing:2px}.order-id{font-family:monospace;font-size:1.1rem;color:#ff0080;margin:0.5rem 0}.details{text-align:left;margin:1.5rem 0;padding:1rem;background:rgba(0,0,0,0.3);border-radius:8px}.details div{display:flex;justify-content:space-between;padding:0.3rem 0;border-bottom:1px solid rgba(255,255,255,0.05)}.total{font-size:1.3rem;color:#00ffff;font-weight:700;margin-top:1rem}.footer{font-size:0.75rem;color:rgba(255,255,255,0.3);margin-top:2rem}hr{border:none;border-top:1px solid rgba(0,255,255,0.1)}</style></head><body><div class="card"><div class="logo">PXNDAS</div><p style="color:rgba(255,255,255,0.5);font-size:0.85rem;">Purchase Confirmation</p><hr><p>Thank you for your order.</p><div class="order-id">${orderId}</div><div class="details"><div><span>Items</span><span>${items}</span></div><div><span>Total</span><span class="total">${total}</span></div><div><span>Date</span><span>${date}</span></div></div><p style="font-size:0.85rem;">Your account details will be delivered to this email within 24 hours.</p><hr><div class="footer">pxndas — premium GTA accounts</div></div></body></html>`
        });

        // Admin notification
        if (SMTP_ADMIN_EMAIL) {
            await transporter.sendMail({
                from,
                to: SMTP_ADMIN_EMAIL,
                subject: `New Order: ${orderId}`,
                html: `<p><strong>New purchase</strong></p><p>Order: ${orderId}<br>Email: ${email}<br>Items: ${items}<br>Total: ${total}<br>Date: ${date}</p>`
            });
        }

        res.json({ ok: true });
    } catch (e) {
        console.error('Email error:', e.message);
        res.status(500).json({ ok: false, error: 'Failed to send email' });
    }
});

// --- Data API (read is public, write requires same-origin) ---
app.get('/api/data/:key', rateLimit(120, 60000), (req, res) => {
    try {
        const filePath = safePath(req.params.key);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            return res.json({ ok: true, data: JSON.parse(content) });
        }
        return res.json({ ok: true, data: null });
    } catch { return res.status(400).json({ ok: false, error: 'Invalid key' }); }
});

app.post('/api/data/:key', rateLimit(30, 60000), (req, res) => {
    try {
        // Same-origin check for write operations
        if (!isSameOrigin(req)) {
            return res.status(403).json({ ok: false, error: 'Cross-origin write denied' });
        }
        const filePath = safePath(req.params.key);
        const data = req.body;
        if (data === null || data === undefined) {
            // Delete the file
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return res.json({ ok: true });
        }
        // Validate data is a plain object or array
        if (typeof data !== 'object' || data === null) {
            return res.status(400).json({ ok: false, error: 'Data must be an object or array' });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return res.json({ ok: true });
    } catch (e) {
        return res.status(400).json({ ok: false, error: 'Invalid JSON or key' });
    }
});

// --- File System API (for Pxnda AI code editing) - RESTRICTED ACCESS ---
const projectRoot = __dirname;

// Critical files that cannot be written/edited (protect server integrity)
const CRITICAL_FILES = new Set([
    'server.js', 'package.json', 'package-lock.json', '.env', '.gitignore',
    'Procfile', 'railway.json', 'start-server.bat', 'Dockerfile'
]);

// Sensitive files that cannot even be read
const SENSITIVE_FILES = new Set([
    '.env', '.gitignore', 'package-lock.json', 'Procfile', 'railway.json', 'start-server.bat', 'Dockerfile'
]);

// System directories that absolute paths cannot access
const BLOCKED_DIRS = [
    '/etc', '/var', '/sys', '/proc', '/dev', '/boot', '/lib', '/bin', '/sbin',
    '/usr/lib', '/usr/bin', '/usr/sbin', '/System', '/Library',
    'C:\\Windows', 'C:\\Program Files', 'C:\\ProgramData',
    'C:\\Windows\\System32', 'C:\\Windows\\SysWOW64',
    'C:\\$Recycle.Bin', 'C:\\System Volume Information'
];

// Only allow editing these file extensions
const ALLOWED_EXTENSIONS = new Set([
    '.html', '.css', '.js', '.json', '.md', '.txt', '.xml', '.svg',
    '.yaml', '.yml', '.toml', '.cfg', '.conf', '.ini', '.env.example'
]);

const safeFilePath = (userPath) => {
    if (typeof userPath !== 'string') return null;
    // Reject null bytes and control characters
    if (/[\x00-\x1f]/.test(userPath)) return null;
    // Reject empty paths
    if (!userPath.trim()) return null;
    const resolved = path.isAbsolute(userPath) ? path.resolve(userPath) : path.resolve(projectRoot, userPath);
    // Block access to critical system directories for absolute paths
    for (const dir of BLOCKED_DIRS) {
        if (resolved.toLowerCase().startsWith(dir.toLowerCase())) return null;
    }
    // Block node_modules and .git directories anywhere in the path
    const parts = resolved.split(path.sep);
    for (const part of parts) {
        if (part === 'node_modules' || part === '.git') return null;
    }
    return resolved;
};

// Authentication middleware for file operations (same-origin required)
const requireFileAuth = (req, res, next) => {
    if (isSameOrigin(req)) return next();
    return res.status(401).json({ ok: false, error: 'File operations require same-origin request' });
};

// List files in a directory
app.get('/api/files/list', rateLimit(30, 60000), requireFileAuth, (req, res) => {
    try {
        const dirPath = safeFilePath(req.query.dir || '.');
        if (!dirPath) return res.status(400).json({ ok: false, error: 'Invalid path' });
        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
            return res.status(404).json({ ok: false, error: 'Directory not found' });
        }
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const files = entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'dir' : 'file',
            size: e.isFile() ? fs.statSync(path.join(dirPath, e.name)).size : 0
        }));
        res.json({ ok: true, files });
    } catch { res.status(500).json({ ok: false, error: 'Error reading directory' }); }
});

// Read a file
app.get('/api/files/read', rateLimit(30, 60000), requireFileAuth, (req, res) => {
    try {
        const filePath = safeFilePath(req.query.path);
        if (!filePath) return res.status(400).json({ ok: false, error: 'Invalid path' });
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            return res.status(404).json({ ok: false, error: 'File not found' });
        }
        const ext = path.extname(filePath);
        const basename = path.basename(filePath);
        // Block reading sensitive files
        if (SENSITIVE_FILES.has(basename)) {
            return res.status(403).json({ ok: false, error: 'Cannot read sensitive file' });
        }
        // Only allow reading text-based files through this API
        if (!ALLOWED_EXTENSIONS.has(ext) && ext !== '') {
            return res.status(403).json({ ok: false, error: 'File type not readable through API' });
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        res.json({ ok: true, content, path: req.query.path, size: content.length, ext });
    } catch { res.status(500).json({ ok: false, error: 'Error reading file' }); }
});

// Write a file (create or overwrite)
app.post('/api/files/write', rateLimit(15, 60000), requireFileAuth, (req, res) => {
    try {
        const filePath = safeFilePath(req.body.path);
        if (!filePath) return res.status(400).json({ ok: false, error: 'Invalid path' });
        const content = req.body.content;
        if (typeof content !== 'string') return res.status(400).json({ ok: false, error: 'content must be a string' });
        if (content.length > 5000000) return res.status(413).json({ ok: false, error: 'File too large (max 5MB)' });

        const basename = path.basename(filePath);
        // Block writing to critical system files
        if (CRITICAL_FILES.has(basename)) {
            return res.status(403).json({ ok: false, error: 'Cannot modify critical system file: ' + basename });
        }

        const ext = path.extname(filePath);
        if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
            return res.status(403).json({ ok: false, error: 'File type not allowed' });
        }

        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`[FILE WRITE] ${req.body.path} (${content.length} chars)`);
        res.json({ ok: true, path: req.body.path, size: content.length });
    } catch (e) { res.status(500).json({ ok: false, error: 'Error writing file' }); }
});

// Edit a file (find and replace)
app.post('/api/files/edit', rateLimit(15, 60000), requireFileAuth, (req, res) => {
    try {
        const filePath = safeFilePath(req.body.path);
        if (!filePath) return res.status(400).json({ ok: false, error: 'Invalid path' });
        if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'File not found' });

        const basename = path.basename(filePath);
        if (CRITICAL_FILES.has(basename)) {
            return res.status(403).json({ ok: false, error: 'Cannot modify critical system file: ' + basename });
        }

        const { oldString, newString } = req.body;
        if (typeof oldString !== 'string' || typeof newString !== 'string') {
            return res.status(400).json({ ok: false, error: 'oldString and newString are required' });
        }

        let content = fs.readFileSync(filePath, 'utf-8');
        if (!content.includes(oldString)) {
            const lines = content.split('\n');
            const previewLines = lines.slice(0, 30).map((l, i) => `${i + 1}: ${l}`).join('\n');
            return res.status(400).json({
                ok: false,
                error: 'oldString not found in file',
                hint: 'Must match EXACTLY including whitespace.',
                preview: previewLines
            });
        }
        const count = content.split(oldString).length - 1;
        content = content.replace(oldString, newString);
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`[FILE EDIT] ${req.body.path} (${count} occurrence${count > 1 ? 's' : ''})`);
        res.json({ ok: true, path: req.body.path, replacements: count });
    } catch (e) { res.status(500).json({ ok: false, error: 'Error editing file' }); }
});

// --- Serve static files with caching headers ---
app.use(express.static(__dirname, {
    index: 'index.html',
    setHeaders: (res, filePath) => {
        const ext = path.extname(filePath);
        const mime = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon'
        };
        if (mime[ext]) res.setHeader('Content-Type', mime[ext]);
        // Cache static assets for 1 hour
        if (ext !== '.html') res.setHeader('Cache-Control', 'public, max-age=3600');
    }
}));

// Health check (minimal info)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// 404 handler (no path leakage)
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ ok: false, error: 'Unknown API endpoint' });
    } else {
        res.status(404).sendFile(path.join(__dirname, '404.html'));
    }
});

// Generic error handler (prevents stack trace leakage)
app.use((err, req, res, next) => {
    console.error('Server error:', err.message);
    res.status(500).json({ ok: false, error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`pxndas server at http://localhost:${PORT}/`);
});
