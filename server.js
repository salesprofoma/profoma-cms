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

// Tabel (LET OP: kolomnamen in camelCase)
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

// Kleine helpers om rare waardes van Wix veilig te maken
function safe(v) {
  return v === undefined || v === null ? "" : String(v);
}
function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Mailtransporter (Gmail)
let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// Test route
app.get("/", (req, res) => {
  res.send("Profoma CMS backend werkt! 🚀");
});

// 👉 Aanvraag opslaan
app.post("/api/request", async (req, res) => {
  try {
    // Zowel camelCase als snake_case accepteren (voor de zekerheid)
    const company = safe(req.body.company);
    const contactPerson = safe(
      req.body.contactPerson || req.body.contact_person
    );
    const email = safe(req.body.email);
    const phone = safe(req.body.phone);
    const region = safe(req.body.region);
    const checkin = safe(req.body.checkin);
    const duration = safe(req.body.duration);
    const totalPersons = safeNumber(
      req.body.totalPersons || req.body.total_persons
    );
    const personsPerRoom = safe(
      req.body.personsPerRoom || req.body.persons_per_room
    );
    const budget = safe(req.body.budget);
    const notes = safe(req.body.notes);

    const includedRaw =
      req.body.included !== undefined ? req.body.included : [];
    const includedString = Array.isArray(includedRaw)
      ? includedRaw.join(", ")
      : safe(includedRaw);

    const createdAt = new Date().toISOString();

    // ⚠️ LET OP: 13 kolommen, 13 waardes (geen 14 meer!)
    const stmt = db.prepare(`
      INSERT INTO requests
      (company, contactPerson, email, phone, region, checkin, duration, totalPersons, personsPerRoom, budget, included, notes, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
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
      includedString,
      notes,
      createdAt
    );

    // Mail sturen (maar als dat faalt, blijft de aanvraag gewoon bewaard)
    if (mailer && process.env.NOTIFY_TO) {
      try {
        await mailer.sendMail({
          to: process.env.NOTIFY_TO,
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          subject: `Nieuwe huisvestingsaanvraag – ${company || "Onbekend bedrijf"}`,
          text: `
Er is een nieuwe huisvestingsaanvraag binnengekomen.

Bedrijf:        ${company}
Contactpersoon: ${contactPerson}
E-mail:        ${email}
Telefoon:      ${phone}

Regio:         ${region}
Check-in:      ${checkin}
Duur:          ${duration}

Aantal personen totaal:   ${totalPersons}
Personen per kamer:       ${personsPerRoom}
Budget p.p.p.w.:          ${budget}
Inbegrepen:               ${includedString}

Opmerkingen:
${notes || "-"}

Verzonden op: ${createdAt}
          `.trim(),
        });
      } catch (mailErr) {
        console.error("Mail verzenden mislukt:", mailErr);
        // Geen res.status(500) hier, want de aanvraag staat al in de database
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DB fout bij POST /api/request:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// 👉 Overzicht voor de adminpagina
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

// Server start
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("Server draait op port " + PORT);
});
