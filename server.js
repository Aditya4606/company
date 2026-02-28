const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const os = require('os');
const { queries } = require('./database');

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

// Ensure uploads directory exists (use persistent disk path if provided)
const dataDir = process.env.RENDER_DISK_PATH || __dirname;
const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer config for photo uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        cb(null, ext && mime);
    },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

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
    cleanExpiredSessions();
    next();
}

app.post('/api/auth/login', (req, res) => {
    const { pin } = req.body;
    if (pin === MAINTENANCE_PIN) {
        const token = generateToken();
        activeSessions.set(token, { createdAt: Date.now() });
        console.log(`🔐 Maintenance login successful (${activeSessions.size} active sessions)`);
        return res.json({ success: true, token });
    }
    res.status(401).json({ error: 'Invalid PIN' });
});

app.get('/api/auth/check', (req, res) => {
    const token = req.headers['x-auth-token'] || req.query.token;
    if (token && activeSessions.has(token)) {
        return res.json({ authenticated: true });
    }
    res.json({ authenticated: false });
});

app.post('/api/auth/logout', (req, res) => {
    const token = req.headers['x-auth-token'];
    if (token) activeSessions.delete(token);
    res.json({ success: true });
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

// ─── MACHINES API ────────────────────────────────────────────────────────────
app.get('/api/machines', requireAuth, (req, res) => {
    const machines = queries.getAllMachines.all();
    res.json(machines);
});

// Public: operator gets machine list (for dropdown when no QR scan)
app.get('/api/machines/list', (req, res) => {
    const machines = queries.getAllMachines.all().map(m => ({
        id: m.id, name: m.name, location: m.location, department: m.department,
    }));
    res.json(machines);
});

// Public: operator gets basic machine info (from QR scan)
app.get('/api/machines/:id/info', (req, res) => {
    const machine = queries.getMachineById.get(req.params.id);
    if (!machine) return res.status(404).json({ error: 'Machine not found' });
    res.json({ id: machine.id, name: machine.name, location: machine.location, department: machine.department });
});

app.get('/api/machines/:id', requireAuth, (req, res) => {
    const machine = queries.getMachineById.get(req.params.id);
    if (!machine) return res.status(404).json({ error: 'Machine not found' });
    res.json(machine);
});

app.post('/api/machines', requireAuth, (req, res) => {
    const { name, location, department } = req.body;
    if (!name || !location) return res.status(400).json({ error: 'Name and location are required' });
    const result = queries.addMachine.run(name, location, department || 'General');
    const machine = queries.getMachineById.get(result.lastInsertRowid);
    res.status(201).json(machine);
});

// ─── QR CODE API ─────────────────────────────────────────────────────────────
app.get('/api/machines/:id/qrcode', requireAuth, async (req, res) => {
    const machine = queries.getMachineById.get(req.params.id);
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
});

// ─── STAFF API ───────────────────────────────────────────────────────────────
app.get('/api/staff', requireAuth, (req, res) => {
    const staff = queries.getAllStaff.all();
    res.json(staff);
});

app.post('/api/staff', requireAuth, (req, res) => {
    const { name, phone, email, role } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const result = queries.addStaff.run(name, phone || null, email || null, role || 'Technician');
    const member = queries.getStaffById.get(result.lastInsertRowid);
    console.log(`👷 Staff added: ${name}`);
    res.status(201).json(member);
});

app.delete('/api/staff/:id', requireAuth, (req, res) => {
    const existing = queries.getStaffById.get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Staff not found' });
    queries.deactivateStaff.run(req.params.id);
    console.log(`👷 Staff deactivated: ${existing.name}`);
    res.json({ success: true });
});

// ─── REPORTS API ─────────────────────────────────────────────────────────────
app.post('/api/reports', upload.single('photo'), async (req, res) => {
    const { machine_id, error_message, description, priority, reported_by } = req.body;

    if (!machine_id || !error_message) {
        return res.status(400).json({ error: 'machine_id and error_message are required' });
    }

    const machine = queries.getMachineById.get(machine_id);
    if (!machine) return res.status(404).json({ error: 'Machine not found' });

    const photoPath = req.file ? `/uploads/${req.file.filename}` : null;

    const result = queries.createReport.run(
        machine_id,
        error_message,
        description || null,
        priority || 'medium',
        photoPath,
        reported_by || 'Operator'
    );

    const report = queries.getReportById.get(result.lastInsertRowid);

    broadcastEvent('new_report', report);
    console.log(`🚨 New report #${report.id} for ${report.machine_name}: ${error_message}`);

    res.status(201).json(report);
});

app.get('/api/reports', requireAuth, (req, res) => {
    const { status } = req.query;
    let reports;
    if (status && ['open', 'in_progress', 'resolved'].includes(status)) {
        reports = queries.getReportsByStatus.all(status);
    } else {
        reports = queries.getAllReports.all();
    }
    res.json(reports);
});

app.get('/api/reports/:id', (req, res) => {
    const report = queries.getReportById.get(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
});

// Assign a report to a staff member
app.post('/api/reports/:id/assign', requireAuth, (req, res) => {
    const { staff_id } = req.body;
    if (!staff_id) return res.status(400).json({ error: 'staff_id is required' });

    const existing = queries.getReportById.get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Report not found' });

    const staff = queries.getStaffById.get(staff_id);
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });

    queries.assignReport.run(staff_id, staff.name, req.params.id);
    const updated = queries.getReportById.get(req.params.id);

    broadcastEvent('report_updated', updated);
    console.log(`📋 Report #${updated.id} assigned to ${staff.name}`);

    res.json(updated);
});

app.patch('/api/reports/:id', requireAuth, (req, res) => {
    const { status, resolved_by } = req.body;

    if (!status || !['open', 'in_progress', 'resolved'].includes(status)) {
        return res.status(400).json({ error: 'Valid status required (open, in_progress, resolved)' });
    }

    const existing = queries.getReportById.get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Report not found' });

    queries.updateReportStatus.run(status, resolved_by || null, status, req.params.id);
    const updated = queries.getReportById.get(req.params.id);

    broadcastEvent('report_updated', updated);
    console.log(`📋 Report #${updated.id} updated to ${status}`);

    res.json(updated);
});

// ─── STATS API ───────────────────────────────────────────────────────────────
app.get('/api/stats', requireAuth, (req, res) => {
    const stats = queries.getStats.get();
    res.json(stats);
});

// ─── START SERVER ────────────────────────────────────────────────────────────
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
