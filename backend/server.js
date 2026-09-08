const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// --- Database Setup ---
const db = new sqlite3.Database('./satellite_bridge.db', (err) => {
    if (err) console.error('Database opening error: ', err);
    console.log('Connected to SQLite database.');
});

db.serialize(() => {
    // 1. Reference Population Table (The "Source of Truth")
    // Added is_cleared and cleared_at for manual evacuation details
    db.run(`CREATE TABLE IF NOT EXISTS reference_population (
        sector_id TEXT PRIMARY KEY,
        sector_name TEXT,
        total_expected INTEGER,
        is_cleared BOOLEAN DEFAULT 0,
        cleared_at DATETIME
    )`);

    // 2. Real-time Detection Table (Tracking by Drones)
    db.run(`CREATE TABLE IF NOT EXISTS detected_population (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sector_id TEXT,
        count INTEGER,
        drone_id TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(sector_id) REFERENCES reference_population(sector_id)
    )`);

    // Seed reference data if empty
    db.get("SELECT count(*) as count FROM reference_population", (err, row) => {
        if (row.count === 0) {
            const stmt = db.prepare("INSERT INTO reference_population (sector_id, sector_name, total_expected) VALUES (?, ?, ?)");
            stmt.run('SEC-A', 'North Residential', 150);
            stmt.run('SEC-B', 'Industrial Zone', 45);
            stmt.run('SEC-C', 'Central Market', 300);
            stmt.run('SEC-D', 'South Waterfront', 80);
            stmt.finalize();
            console.log('Reference population data seeded.');
        }
    });
});

// --- API Endpoints ---

// Update detection: When a drone finds people
app.post('/api/detection', (req, res) => {
    const { sector_id, count, drone_id } = req.body;
    if (!sector_id || count === undefined) {
        return res.status(400).json({ error: 'Missing sector_id or count' });
    }

    const sql = `INSERT INTO detected_population (sector_id, count, drone_id) VALUES (?, ?, ?)`;
    db.run(sql, [sector_id, count, drone_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'success', id: this.lastID });
    });
});

// Mark Sector as Cleared: Manual override for ground teams
app.post('/api/clear-sector', (req, res) => {
    const { sector_id } = req.body;
    if (!sector_id) return res.status(400).json({ error: 'Missing sector_id' });

    const sql = `UPDATE reference_population SET is_cleared = 1, cleared_at = CURRENT_TIMESTAMP WHERE sector_id = ?`;
    db.run(sql, [sector_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'success' });
    });
});

// Get Evacuation Status: Compare Reference vs Detected + Manual Clearance
app.get('/api/evacuation-status', (req, res) => {
    const sql = `
        SELECT 
            r.sector_id,
            r.sector_name, 
            r.total_expected, 
            r.is_cleared,
            r.cleared_at,
            IFNULL(SUM(d.count), 0) as total_detected,
            (r.total_expected - IFNULL(SUM(d.count), 0)) as remaining
        FROM reference_population r
        LEFT JOIN detected_population d ON r.sector_id = d.sector_id
        GROUP BY r.sector_id
    `;
    
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// General Telemetry (Legacy)
app.get('/api/telemetry', (req, res) => {
    res.json({ status: 'online', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`\n🚀 Satellite Bridge Backend running at http://localhost:${PORT}`);
    console.log(`📊 Population DB enabled. Evacuation API live at /api/evacuation-status`);
});
