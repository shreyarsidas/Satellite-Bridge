const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// Mock API for telemetry data
app.get('/api/telemetry', (req, res) => {
    res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        drones: [
            { id: 'Drone Blue', lat: 12.9716, lon: 80.2209, batt: 98 },
            { id: 'Drone Red', lat: 12.9720, lon: 80.2215, batt: 95 }
        ]
    });
});

// Mock API for disaster events
app.get('/api/events', (req, res) => {
    res.json([
        { type: 'Wildfire', icon: '🔥', lat: 12.9750, lon: 80.2240, confidence: 0.92 },
        { type: 'Flooding', icon: '🌊', lat: 12.9780, lon: 80.2260, confidence: 0.88 }
    ]);
});

app.listen(PORT, () => {
    console.log(`Satellite Bridge Backend running at http://localhost:${PORT}`);
    console.log(`Frontend accessible at http://localhost:${PORT}/index.html`);
});
