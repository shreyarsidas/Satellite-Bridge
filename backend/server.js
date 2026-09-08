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
    // Reset schema to ensure absolute consistency
    db.run("DROP TABLE IF EXISTS detected_population");
    db.run("DROP TABLE IF EXISTS reference_population");

    db.run(`CREATE TABLE reference_population (
        sector_id TEXT PRIMARY KEY,
        sector_name TEXT,
        total_expected INTEGER,
        is_cleared BOOLEAN DEFAULT 0,
        cleared_at DATETIME
    )`);

    db.run(`CREATE TABLE detected_population (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sector_id TEXT,
        count INTEGER,
        drone_id TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(sector_id) REFERENCES reference_population(sector_id)
    )`);

    // Seed reference data
    const sectors = [
        ['SEC-A', 'North Residential', 150],
        ['SEC-B', 'Industrial Zone', 45],
        ['SEC-C', 'Central Market', 300],
        ['SEC-D', 'South Waterfront', 80]
    ];
    const refStmt = db.prepare("INSERT INTO reference_population (sector_id, sector_name, total_expected) VALUES (?, ?, ?)");
    sectors.forEach(s => refStmt.run(...s));
    refStmt.finalize();

    // SEED INITIAL APPROXIMATE DETECTIONS (So table isn't empty on first load)
    const detStmt = db.prepare("INSERT INTO detected_population (sector_id, count, drone_id) VALUES (?, ?, ?)");
    sectors.forEach(s => {
        // Generate a random initial "approximate" detection (30% to 70% of expected)
        const approx = Math.floor(s[2] * (0.3 + Math.random() * 0.4));
        detStmt.run(s[0], approx, 'SATELLITE-SCAN-01');
    });
    detStmt.finalize();
    
    console.log('Database reset, reference data seeded, and initial approximate detections generated.');
});

// --- API Endpoints ---

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

app.post('/api/clear-sector', (req, res) => {
    const { sector_id } = req.body;
    if (!sector_id) return res.status(400).json({ error: 'Missing sector_id' });

    const sql = `UPDATE reference_population SET is_cleared = 1, cleared_at = CURRENT_TIMESTAMP WHERE sector_id = ?`;
    db.run(sql, [sector_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'success' });
    });
});

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

app.get('/api/telemetry', (req, res) => {
    res.json({ status: 'online', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`\n🚀 Satellite Bridge Backend running at http://localhost:${PORT}`);
    console.log(`📊 Population DB active with initial approx data. API: /api/evacuation-status`);
});
