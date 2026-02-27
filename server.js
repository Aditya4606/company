const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { queries } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
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
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
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
app.get('/api/machines', (req, res) => {
    const machines = queries.getAllMachines.all();
    res.json(machines);
});

app.get('/api/machines/:id', (req, res) => {
    const machine = queries.getMachineById.get(req.params.id);
    if (!machine) return res.status(404).json({ error: 'Machine not found' });
    res.json(machine);
});

app.post('/api/machines', (req, res) => {
    const { name, location, department } = req.body;
    if (!name || !location) return res.status(400).json({ error: 'Name and location are required' });
    const result = queries.addMachine.run(name, location, department || 'General');
    const machine = queries.getMachineById.get(result.lastInsertRowid);
    res.status(201).json(machine);
});

// ─── QR CODE API ─────────────────────────────────────────────────────────────
app.get('/api/machines/:id/qrcode', async (req, res) => {
    const machine = queries.getMachineById.get(req.params.id);
    if (!machine) return res.status(404).json({ error: 'Machine not found' });

    // Build the URL that the QR code will point to
    const host = req.get('host');
    const protocol = req.protocol;
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

// ─── REPORTS API ─────────────────────────────────────────────────────────────
app.post('/api/reports', upload.single('photo'), (req, res) => {
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

    // Broadcast to all maintenance dashboard clients
    broadcastEvent('new_report', report);
    console.log(`🚨 New report #${report.id} for ${report.machine_name}: ${error_message}`);

    res.status(201).json(report);
});

app.get('/api/reports', (req, res) => {
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

app.patch('/api/reports/:id', (req, res) => {
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
app.get('/api/stats', (req, res) => {
    const stats = queries.getStats.get();
    res.json(stats);
});

// ─── START SERVER ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🏭 Machine Alert System running at http://localhost:${PORT}`);
    console.log(`   📱 Operator Report:      http://localhost:${PORT}/report.html`);
    console.log(`   📊 Maintenance Dashboard: http://localhost:${PORT}/dashboard.html`);
    console.log(`   🏷️  QR Code Generator:    http://localhost:${PORT}/qrcodes.html\n`);
});
