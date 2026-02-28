require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const os = require('os');
const webpush = require('web-push');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { pool, initDB, queries } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return 'localhost';
}

// ─── Auth Config ─────────────────────────────────────────────────────────────
const MAINTENANCE_PIN = process.env.MAINTENANCE_PIN || '1234';
const activeSessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000;

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Cloudinary storage for Multer
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'machine_alerts',
        allowed_formats: ['jpeg', 'jpg', 'png', 'gif', 'webp']
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure Web Push VAPID keys
webpush.setVapidDetails(
    'mailto:test@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

// ─── AUTH API ────────────────────────────────────────────────────────────────
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function cleanExpiredSessions() {
    const now = Date.now();
    for (const [token, session] of activeSessions) {
        if (now - session.createdAt > SESSION_TTL) activeSessions.delete(token);
    }
}

function requireAuth(req, res, next) {
    const token = req.headers['x-auth-token'] || req.query.token;
    if (!token || !activeSessions.has(token)) {
        return res.status(401).json({ error: 'Unauthorized — maintenance PIN required' });
    }
    req.sessionContext = activeSessions.get(token);
    cleanExpiredSessions();
    next();
}

app.post('/api/auth/login', (req, res) => {
    const { pin } = req.body;
    if (pin === MAINTENANCE_PIN) {
        // Grant everyone with the maintenance PIN the 'admin' role so they can delete machines
        const role = 'admin';
        const token = generateToken();
        activeSessions.set(token, { createdAt: Date.now(), role });
        console.log(`🔐 Login successful as ${role} (${activeSessions.size} active sessions)`);
        return res.json({ success: true, token, role });
    }
    res.status(401).json({ error: 'Invalid PIN' });
});

app.get('/api/auth/check', (req, res) => {
    const token = req.headers['x-auth-token'] || req.query.token;
    if (token && activeSessions.has(token)) {
        const session = activeSessions.get(token);
        return res.json({ authenticated: true, role: session.role });
    }
    res.json({ authenticated: false });
});

app.post('/api/auth/logout', (req, res) => {
    const token = req.headers['x-auth-token'];
    if (token) activeSessions.delete(token);
    res.json({ success: true });
});

// ─── HEALTH CHECK API (Keeps Server & DB Awake) ──────────────────────────────
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).send('OK');
    } catch (e) {
        console.error('Health check failed:', e);
        res.status(500).send('Error');
    }
});



// ─── SSE (Server-Sent Events) ───────────────────────────────────────────────
const sseClients = new Set();

app.get('/api/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });
    res.write('\n');

    sseClients.add(res);
    console.log(`📡 SSE client connected (${sseClients.size} total)`);

    req.on('close', () => {
        sseClients.delete(res);
        console.log(`📡 SSE client disconnected (${sseClients.size} total)`);
    });
});

function broadcastEvent(eventName, data) {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        client.write(payload);
    }
}

// ─── WEB PUSH API ────────────────────────────────────────────────────────────

app.get('/api/vapidPublicKey', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/subscribe', async (req, res) => {
    try {
        const { endpoint, keys } = req.body;
        if (!endpoint || !keys) {
            return res.status(400).json({ error: 'Invalid subscription object' });
        }
        await queries.saveSubscription(endpoint, keys.p256dh, keys.auth);
        res.status(201).json({ success: true });
    } catch (e) {
        console.error('Failed to save subscription:', e);
        res.status(500).json({ error: 'Failed to subscribe' });
    }
});

app.post('/api/unsubscribe', async (req, res) => {
    try {
        const { endpoint } = req.body;
        if (!endpoint) return res.status(400).json({ error: 'Endpoint required' });
        await queries.deleteSubscription(endpoint);
        res.json({ success: true });
    } catch (e) {
        console.error('Failed to delete subscription:', e);
        res.status(500).json({ error: 'Failed to unsubscribe' });
    }
});

// Helper to broadcast Web Push natively
async function broadcastPushNotification(payload) {
    try {
        const subs = await queries.getAllSubscriptions();
        for (const sub of subs) {
            const pushConfig = {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth }
            };
            try {
                await webpush.sendNotification(pushConfig, JSON.stringify(payload));
            } catch (err) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await queries.deleteSubscription(sub.endpoint);
                } else {
                    console.error('Push error endpoint:', sub.endpoint, err);
                }
            }
        }
    } catch (e) {
        console.error('Error broadcasting push notification:', e);
    }
}

// ─── MACHINES API ────────────────────────────────────────────────────────────
app.get('/api/machines', requireAuth, async (req, res) => {
    try {
        const machines = await queries.getAllMachines();
        res.json(machines);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

// Public: operator gets machine list (for dropdown when no QR scan)
app.get('/api/machines/list', async (req, res) => {
    try {
        const list = await queries.getAllMachines();
        const machines = list.map(m => ({
            id: m.id, name: m.name, location: m.location, department: m.department,
        }));
        res.json(machines);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

// Public: operator gets basic machine info (from QR scan)
app.get('/api/machines/:id/info', async (req, res) => {
    try {
        const machine = await queries.getMachineById(req.params.id);
        if (!machine) return res.status(404).json({ error: 'Machine not found' });
        res.json({ id: machine.id, name: machine.name, location: machine.location, department: machine.department });
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

app.get('/api/machines/:id', requireAuth, async (req, res) => {
    try {
        const machine = await queries.getMachineById(req.params.id);
        if (!machine) return res.status(404).json({ error: 'Machine not found' });
        res.json(machine);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

app.post('/api/machines', requireAuth, async (req, res) => {
    try {
        const { name, location, department } = req.body;
        if (!name || !location) return res.status(400).json({ error: 'Name and location are required' });
        const machine = await queries.addMachine(name, location, department || 'General');
        res.status(201).json(machine);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

app.delete('/api/machines/:id', requireAuth, async (req, res) => {
    try {
        if (req.sessionContext?.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden — Admin only' });
        }
        const machine = await queries.getMachineById(req.params.id);
        if (!machine) return res.status(404).json({ error: 'Machine not found' });
        await queries.deleteMachine(req.params.id);
        console.log(`🏭 Machine deleted: ${machine.name}`);
        res.json({ success: true });
    } catch (e) { console.error('Error deleting machine:', e); res.status(500).json({ error: 'DB Error' }); }
});

// ─── QR CODE API ─────────────────────────────────────────────────────────────
app.get('/api/machines/:id/qrcode', requireAuth, async (req, res) => {
    try {
        const machine = await queries.getMachineById(req.params.id);
        if (!machine) return res.status(404).json({ error: 'Machine not found' });

        let host = process.env.RENDER_EXTERNAL_URL ? process.env.RENDER_EXTERNAL_URL.replace(/^https?:\/\//, '') : req.get('host');
        if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
            const port = host.split(':')[1] || PORT;
            host = `${getLocalIP()}:${port}`;
        }
        const protocol = process.env.RENDER_EXTERNAL_URL ? 'https' : req.protocol;
        const reportUrl = `${protocol}://${host}/report.html?machine_id=${machine.id}`;

        try {
            const format = req.query.format || 'svg';
            if (format === 'svg') {
                const svg = await QRCode.toString(reportUrl, { type: 'svg', width: 300, margin: 2 });
                res.json({ machine, qr_svg: svg, url: reportUrl });
            } else {
                const dataUrl = await QRCode.toDataURL(reportUrl, { width: 300, margin: 2 });
                res.json({ machine, qr_data_url: dataUrl, url: reportUrl });
            }
        } catch (err) {
            res.status(500).json({ error: 'Failed to generate QR code' });
        }
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

// ─── STAFF API ───────────────────────────────────────────────────────────────
app.get('/api/staff', requireAuth, async (req, res) => {
    try {
        const staff = await queries.getAllStaff();
        res.json(staff);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

app.post('/api/staff', requireAuth, async (req, res) => {
    try {
        const { name, phone, email, role } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });
        const member = await queries.addStaff(name, phone || null, email || null, role || 'Technician');
        console.log(`👷 Staff added: ${name}`);
        res.status(201).json(member);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

app.delete('/api/staff/:id', requireAuth, async (req, res) => {
    try {
        const existing = await queries.getStaffById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Staff not found' });
        await queries.deactivateStaff(req.params.id);
        console.log(`👷 Staff deactivated: ${existing.name}`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

// ─── REPORTS API ─────────────────────────────────────────────────────────────
app.post('/api/reports', upload.single('photo'), async (req, res) => {
    try {
        const { machine_id, error_message, description, priority, reported_by } = req.body;

        if (!machine_id || !error_message) {
            return res.status(400).json({ error: 'machine_id and error_message are required' });
        }

        const machine = await queries.getMachineById(machine_id);
        if (!machine) return res.status(404).json({ error: 'Machine not found' });

        // Multer with Cloudinary configuration populates 'path' with the Cloudinary URL
        const photoPath = req.file ? req.file.path : null;

        const reportInsert = await queries.createReport(
            machine_id,
            error_message,
            description || null,
            priority || 'medium',
            photoPath,
            reported_by || 'Operator'
        );

        const report = await queries.getReportById(reportInsert.id);

        broadcastEvent('new_report', report);

        // Also fire off native push notifications to all subscribed devices
        broadcastPushNotification({
            title: `🚨 Machine Alert: ${report.machine_name}`,
            body: report.error_message,
            url: '/dashboard.html',
            icon: '/icons/icon-192x192.png'
        });

        console.log(`🚨 New report #${report.id} for ${report.machine_name}: ${error_message}`);

        res.status(201).json(report);
    } catch (e) { console.error(e); res.status(500).json({ error: 'DB Error' }); }
});

app.get('/api/reports', requireAuth, async (req, res) => {
    try {
        const { status } = req.query;
        let reports;
        if (status && ['open', 'in_progress', 'resolved'].includes(status)) {
            reports = await queries.getReportsByStatus(status);
        } else {
            reports = await queries.getAllReports();
        }
        res.json(reports);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

app.get('/api/reports/:id', async (req, res) => {
    try {
        const report = await queries.getReportById(req.params.id);
        if (!report) return res.status(404).json({ error: 'Report not found' });
        res.json(report);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

// Assign a report to a staff member
app.post('/api/reports/:id/assign', requireAuth, async (req, res) => {
    try {
        const { staff_id } = req.body;
        if (!staff_id) return res.status(400).json({ error: 'staff_id is required' });

        const existing = await queries.getReportById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Report not found' });

        const staff = await queries.getStaffById(staff_id);
        if (!staff) return res.status(404).json({ error: 'Staff member not found' });

        await queries.assignReport(staff.id, staff.name, req.params.id);
        const updated = await queries.getReportById(req.params.id);

        broadcastEvent('report_updated', updated);
        console.log(`📋 Report #${updated.id} assigned to ${staff.name}`);

        res.json(updated);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

app.patch('/api/reports/:id', requireAuth, async (req, res) => {
    try {
        const { status, resolved_by } = req.body;

        if (!status || !['open', 'in_progress', 'resolved'].includes(status)) {
            return res.status(400).json({ error: 'Valid status required (open, in_progress, resolved)' });
        }

        const existing = await queries.getReportById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Report not found' });

        await queries.updateReportStatus(status, resolved_by || null, req.params.id);
        const updated = await queries.getReportById(req.params.id);

        broadcastEvent('report_updated', updated);
        console.log(`📋 Report #${updated.id} updated to ${status}`);

        res.json(updated);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

app.delete('/api/reports/:id', requireAuth, async (req, res) => {
    try {
        if (req.sessionContext?.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden — Admin only' });
        }
        const existing = await queries.getReportById(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Report not found' });

        await queries.deleteReport(req.params.id);

        broadcastEvent('report_deleted', { id: existing.id });
        console.log(`📋 Report #${existing.id} deleted`);

        res.json({ success: true });
    } catch (e) { console.error('Error deleting report:', e); res.status(500).json({ error: 'DB Error' }); }
});

// ─── STATS API ───────────────────────────────────────────────────────────────
app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const stats = await queries.getStats();
        res.json(stats);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

app.get('/api/stats/monthly', requireAuth, async (req, res) => {
    try {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
        const stats = await queries.getMonthlyStats(year, month);
        res.json({ year, month, data: stats });
    } catch (e) { console.error('Error fetching monthly stats:', e); res.status(500).json({ error: 'DB Error' }); }
});

// ─── START SERVER ────────────────────────────────────────────────────────────
initDB().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        const ip = getLocalIP();
        const externalUrl = process.env.RENDER_EXTERNAL_URL || `http://${ip}:${PORT}`;

        console.log(`\n🏭 Machine Alert System is LIVE!\n`);
        if (process.env.RENDER_EXTERNAL_URL) {
            console.log(`   ☁️  Cloud URL:         ${externalUrl}`);
            console.log(`   📱 Operator Report:   ${externalUrl}/report.html`);
            console.log(`   📊 Dashboard:         ${externalUrl}/dashboard.html`);
            console.log(`   🏷️  QR Codes:          ${externalUrl}/qrcodes.html`);
        } else {
            console.log(`   🌐 Network URL:       http://${ip}:${PORT}`);
            console.log(`   🏠 Local URL:         http://localhost:${PORT}`);
            console.log(`   📱 Operator Report:   http://${ip}:${PORT}/report.html`);
            console.log(`   📊 Dashboard:         http://${ip}:${PORT}/dashboard.html`);
            console.log(`   🏷️  QR Codes:          http://${ip}:${PORT}/qrcodes.html`);
        }
        console.log(`   🔐 PIN:               ${MAINTENANCE_PIN}`);
        console.log(`\n   ☝️  Share the ${process.env.RENDER_EXTERNAL_URL ? 'Cloud' : 'Network'} URL with your team!\n`);
    });
}).catch(err => {
    console.error("Failed to connect to Supabase Postgres:", err);
    process.exit(1);
});
