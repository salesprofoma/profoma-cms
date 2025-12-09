const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const cors = require("cors");

const app = express();

// CORS toestaan (zodat Wix mag praten met je server)
app.use(cors());
app.use(express.json());

// Database openen
const db = new sqlite3.Database(path.join(__dirname, "profoma.db"));

// Tabel aanmaken als hij nog niet bestaat
db.run(`
  CREATE TABLE IF NOT EXISTS housing_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT,
    contactPerson TEXT,
    email TEXT,
    phone TEXT,
    region TEXT,
    checkin TEXT,
    duration TEXT,
    totalPersons INTEGER,
    personsPerRoom TEXT,
    budget TEXT,
    included TEXT,
    notes TEXT,
    createdAt TEXT
  )
`);

// Test route
app.get("/", (req, res) => {
  res.send("Profoma Housing CMS werkt! 🚀");
});

// API: aanvraag opslaan
app.post("/api/request", (req, res) => {
  const {
    company,
    contactPerson,
    email,
    phone,
    region,
    checkin,
    duration,
    totalPersons,
    personsPerRoom,
    budget,
    included,
    notes,
  } = req.body;

  const createdAt = new Date().toISOString();
  const includedString = Array.isArray(included) ? included.join(",") : "";

  const stmt = db.prepare(`
    INSERT INTO housing_requests (
      company, contactPerson, email, phone,
      region, checkin, duration,
      totalPersons, personsPerRoom, budget,
      included, notes, createdAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    company || "",
    contactPerson || "",
    email || "",
    phone || "",
    region || "",
    checkin || "",
    duration || "",
    totalPersons || 0,
    personsPerRoom || "",
    budget || "",
    includedString,
    notes || "",
    createdAt,
    (err) => {
      if (err) {
        console.error("DB fout:", err);
        return res.status(500).json({ success: false, error: "DB error" });
      }
      res.json({ success: true });
    }
  );
});

// Server starten (BELANGRIJK VOOR RENDER)
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("Server draait op port " + PORT);
});
