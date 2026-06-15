const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8000;

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

// CORS
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
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

// --- API Proxy ---
app.post('/api/chat', async (req, res) => {
    const { provider, apiKey, model, query, context, history } = req.body;
    if (!apiKey || !query) return res.status(400).json({ ok: false, error: 'Missing apiKey or query' });

    try {
        let reply;
        if (provider === 'gemini') {
            const msgs = [];
            let firstUser = true;
            if (history) {
                for (const msg of history) {
                    if (msg.role === 'system') {
                        if (firstUser) context = msg.content;
                    } else if (msg.role === 'assistant') {
                        msgs.push({ role: 'model', parts: [{ text: msg.content }] });
                    } else if (msg.role === 'user') {
                        const text = firstUser && context ? `${context}\n\n${msg.content}` : msg.content;
                        msgs.push({ role: 'user', parts: [{ text }] });
                        firstUser = false;
                    }
                }
            } else {
                msgs.push({ parts: [{ text: `${context}\n\nAdmin: ${query}` }] });
            }

            const gRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: msgs, generationConfig: { maxOutputTokens: 1024, temperature: 0.7 } })
                }
            );
            if (!gRes.ok) {
                const err = await gRes.text();
                throw new Error(`Gemini API ${gRes.status}: ${err}`);
            }
            const gData = await gRes.json();
            reply = gData.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
        } else {
            // OpenRouter
            let msgs = history;
            if (!msgs || msgs.length === 0) {
                msgs = [
                    { role: 'system', content: context },
                    { role: 'user', content: query }
                ];
            }
            const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    messages: msgs,
                    max_tokens: 1024,
                    temperature: 0.7
                })
            });
            if (!orRes.ok) {
                const err = await orRes.text();
                throw new Error(`OpenRouter API ${orRes.status}: ${err}`);
            }
            const orData = await orRes.json();
            reply = orData.choices?.[0]?.message?.content || 'No response';
        }

        return res.json({ ok: true, reply });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// --- Config API (exposes env vars to frontend) ---
app.get('/api/config', (req, res) => {
    res.json({
        ok: true,
        aiKey: process.env.AI_API_KEY || '',
        aiModel: process.env.AI_MODEL || 'openai/gpt-4o-mini',
        aiProvider: process.env.AI_PROVIDER || 'openrouter'
    });
});

// --- Data API ---
app.get('/api/data/:key', (req, res) => {
    try {
        const filePath = safePath(req.params.key);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            return res.json({ ok: true, data: JSON.parse(content) });
        }
        return res.json({ ok: true, data: null });
    } catch { return res.status(400).json({ ok: false, error: 'Invalid key' }); }
});

app.post('/api/data/:key', (req, res) => {
    try {
        const filePath = safePath(req.params.key);
        const data = req.body;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return res.json({ ok: true });
    } catch (e) {
        return res.status(400).json({ ok: false, error: 'Invalid JSON or key' });
    }
});

// --- File System API (for Pxnda AI code editing) ---
const projectRoot = __dirname;

const safeFilePath = (userPath) => {
    const resolved = path.resolve(projectRoot, userPath);
    if (!resolved.startsWith(projectRoot)) return null;
    return resolved;
};

// List files in a directory
app.get('/api/files/list', (req, res) => {
    try {
        const dirPath = safeFilePath(req.query.dir || '.');
        if (!dirPath) return res.status(403).json({ ok: false, error: 'Access denied' });
        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
            return res.status(404).json({ ok: false, error: 'Directory not found' });
        }
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const files = entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'dir' : 'file',
            size: e.isFile() ? fs.statSync(path.join(dirPath, e.name)).size : 0
        }));
        res.json({ ok: true, files, path: req.query.dir || '.' });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Read a file
app.get('/api/files/read', (req, res) => {
    try {
        const filePath = safeFilePath(req.query.path);
        if (!filePath) return res.status(403).json({ ok: false, error: 'Access denied' });
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            return res.status(404).json({ ok: false, error: 'File not found' });
        }
        const ext = path.extname(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        res.json({ ok: true, content, path: req.query.path, size: content.length, ext });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Write a file (create or overwrite)
app.post('/api/files/write', (req, res) => {
    try {
        const filePath = safeFilePath(req.body.path);
        if (!filePath) return res.status(403).json({ ok: false, error: 'Access denied' });
        const content = req.body.content;
        if (typeof content !== 'string') return res.status(400).json({ ok: false, error: 'content must be a string' });
        // Ensure parent directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`[FILE WRITE] ${req.body.path} (${content.length} chars)`);
        res.json({ ok: true, path: req.body.path, size: content.length });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Edit a file (find and replace)
app.post('/api/files/edit', (req, res) => {
    try {
        const filePath = safeFilePath(req.body.path);
        if (!filePath) return res.status(403).json({ ok: false, error: 'Access denied' });
        if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'File not found' });
        const { oldString, newString } = req.body;
        if (typeof oldString !== 'string' || typeof newString !== 'string') {
            return res.status(400).json({ ok: false, error: 'oldString and newString are required' });
        }
        let content = fs.readFileSync(filePath, 'utf-8');
        if (!content.includes(oldString)) {
            return res.status(400).json({ ok: false, error: 'oldString not found in file' });
        }
        const count = content.split(oldString).length - 1;
        content = content.replace(oldString, newString);
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`[FILE EDIT] ${req.body.path} (${count} occurrence${count > 1 ? 's' : ''})`);
        res.json({ ok: true, path: req.body.path, replacements: count });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// --- Serve static files ---
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
    }
}));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', cwd: process.cwd(), dir: __dirname, files: fs.readdirSync(__dirname).slice(0, 30) });
});

// 404 handler
app.use((req, res) => {
    res.status(404).send('Not Found - ' + req.path + ' (server running)');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`pxndas server at http://localhost:${PORT}/`);
});
