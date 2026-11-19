const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dbFile = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) console.error('خطأ في الاتصال بقاعدة البيانات:', err.message);
    else console.log('تم الاتصال بنجاح بقاعدة بيانات SQLite.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT,
        field1 TEXT,
        field2 TEXT,
        facility TEXT,
        start_date TEXT,
        end_date TEXT
    )`);
});

app.get('/api/records/:type', (req, res) => {
    const { type } = req.params;
    db.all(`SELECT * FROM records WHERE type = ? ORDER BY id DESC`, [type], (err, rows) => {
        if (err) res.status(500).json({ error: err.message });
        else res.json(rows);
    });
});

app.post('/api/records', (req, res) => {
    const { type, field1, field2, facility, start_date, end_date } = req.body;
    const query = `INSERT INTO records (type, field1, field2, facility, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(query, [type, field1, field2, facility, start_date, end_date], function(err) {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ id: this.lastID, success: true });
    });
});

app.delete('/api/records/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM records WHERE id = ?`, [id], function(err) {
        if (err) res.status(500).json({ error: err.message });
        else res.json({ deleted: this.changes, success: true });
    });
});

app.listen(PORT, () => {
    console.log(`الخادم يعمل حالياً على الرابط: http://localhost:${PORT}`);
});