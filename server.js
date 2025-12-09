const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();

// CORS toestaan (zodat Wix -> jouw laptop mag praten)
app.use(cors());

// JSON body parsing
app.use(express.json());

// Database openen (bestand wordt automatisch aangemaakt)
const db = new sqlite3.Database(path.join(__dirname, "profoma.db"));

// Tabel aanmaken (1x, daarna bestaat hij gewoon)
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS housing_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT (datetime('now')),
      company TEXT,
      contact_person TEXT,
      email TEXT,
      phone TEXT,
      region TEXT,
      checkin TEXT,
      duration TEXT,
      total_persons INTEGER,
      persons_per_room TEXT,
      budget TEXT,
      included TEXT,
      notes TEXT
    )
  `);
});

// Test route
app.get("/", (req, res) => {
  res.send("Profoma Housing CMS werkt! 🚀");
});

// API-endpoint waar jouw Wix-formulier naartoe POST
app.post("/api/request", (req, res) => {
  const {
    company,
    contact_person,
    email,
    phone,
    region,
    checkin,
    duration,
    total_persons,
    persons_per_room,
    budget,
    included,
    notes,
  } = req.body || {};

  const stmt = db.prepare(
    `
    INSERT INTO housing_requests
    (company, contact_person, email, phone, region, checkin, duration,
     total_persons, persons_per_room, budget, included, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  );

  stmt.run(
    company,
    contact_person,
    email,
    phone,
    region,
    checkin,
    duration,
    total_persons || null,
    persons_per_room,
    budget,
    Array.isArray(included) ? included.join(",") : null,
    notes,
    function (err) {
      if (err) {
        console.error("DB-fout bij INSERT:", err);
        return res.status(500).json({ success: false, error: "db_error" });
      }

      // Succes terug naar de browser
      res.json({ success: true, id: this.lastID });
    }
  );

  stmt.finalize();
});

// Server starten
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("Server draait op port " + PORT);
});
