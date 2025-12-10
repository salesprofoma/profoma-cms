const express = require("express");
const cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// Database openen
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

// Nodemailer transporter (Gmail)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,          // smtp.gmail.com
  port: Number(process.env.SMTP_PORT) || 465, // 465
  secure: true,                         // verplicht bij 465
  auth: {
    user: process.env.SMTP_USER,        // sales@profoma.nl
    pass: process.env.SMTP_PASS         // app password
  }
});

// Test route
app.get("/", (req, res) => {
  res.send("Profoma CMS backend werkt! 🚀");
});

// POST → aanvraag opslaan + mail
app.post("/api/request", async (req, res) => {
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
    // In DB opslaan
    const stmt = db.prepare(`
      INSERT INTO requests
      (company, contactPerson, email, phone, region, checkin, duration,
       totalPersons, personsPerRoom, budget, included, notes, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    // Mail sturen (maar fout in mail mag de API niet laten falen)
    try {
      const to = process.env.NOTIFY_TO || process.env.SMTP_USER;

      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject: `Nieuwe huisvestingsaanvraag – ${company || "onbekend bedrijf"}`,
        text:
          `Er is een nieuwe huisvestingsaanvraag binnengekomen.\n\n` +
          `Bedrijf: ${company || "-"}\n` +
          `Contactpersoon: ${contactPerson || "-"}\n` +
          `E-mail: ${email || "-"}\n` +
          `Telefoon: ${phone || "-"}\n` +
          `Regio: ${region || "-"}\n` +
          `Check-in: ${checkin || "-"}\n` +
          `Duur: ${duration || "-"}\n` +
          `Totaal personen: ${totalPersons || "-"}\n` +
          `Personen per kamer: ${personsPerRoom || "-"}\n` +
          `Budget: ${budget || "-"}\n` +
          `Inbegrepen: ${includedString || "-"}\n\n` +
          `Opmerkingen:\n${notes || "-"}\n`
      });

      console.log("Mail verzonden naar", to);
    } catch (mailErr) {
      console.error("Mail verzenden mislukt:", mailErr);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DB fout:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Overzicht van alle aanvragen (admin)
app.get("/api/requests", (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT
           id,
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
           createdAt
         FROM requests
         ORDER BY datetime(createdAt) DESC`
      )
      .all();

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Fout bij ophalen van aanvragen:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Server starten
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("Server draait op port " + PORT);
});
