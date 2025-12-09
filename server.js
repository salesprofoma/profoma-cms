const express = require("express");
const cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// Database openen (Render + lokaal compatibel)
const db = new Database(path.join(__dirname, "profoma.db"));

// Tabel maken (eenmalig)
db.prepare(`
  CREATE TABLE IF NOT EXISTS requests (
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
`).run();

// TEST ROUTE
app.get("/", (req, res) => {
  res.send("Profoma CMS backend werkt! 🚀");
});

// POST → bewaren aanvraag
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
    notes
  } = req.body;

  const createdAt = new Date().toISOString();
  const includedString = Array.isArray(included) ? included.join(", ") : "";

  try {
    const stmt = db.prepare(`
      INSERT INTO requests
      (company, contactPerson, email, phone, region, checkin, duration, totalPersons, personsPerRoom, budget, included, notes, createdAt)
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
      createdAt
    );

    res.json({ success: true });

  } catch (err) {
    console.error("DB fout:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// SERVER START (Render gebruikt proces.env.PORT)
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("Server draait op port " + PORT);
});
// 👉 Overzicht van alle aanvragen
app.get("/api/requests", (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT 
          id,
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
          created_at
        FROM requests
        ORDER BY created_at DESC`
      )
      .all();

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Fout bij ophalen van aanvragen:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});
