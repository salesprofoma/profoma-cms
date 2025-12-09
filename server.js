const express = require("express");
const cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");

// ====== CONFIG ======
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "ZET_HIER_EEN_STERKE_GEHEIME_CODE"; 
// Zet in Render > Environment een veilige ADMIN_TOKEN en haal deze fallback weg.

// ====== EXPRESS APP ======
const app = express();
app.use(cors());
app.use(express.json());

// ====== DATABASE ======
const db = new Database(path.join(__dirname, "profoma.db"));

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

// ====== HELPER: ADMIN AUTH ======
function adminAuth(req, res, next) {
  const token =
    req.headers["x-admin-token"] ||
    req.query.token;

  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  next();
}

// ====== HELPER: MAIL TRANSPORTER ======
// Vul deze waardes in of zet ze in environment variables op Render.
const transporter =
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || "587", 10),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      })
    : null;

// ====== ROUTES ======
app.get("/", (req, res) => {
  res.send("Profoma CMS backend werkt! 🚀");
});

// Nieuwe aanvraag opslaan
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
    notes,
  } = req.body;

  const createdAt = new Date().toISOString();
  const includedString = Array.isArray(included) ? included.join(", ") : "";

  try {
    const stmt = db.prepare(`
      INSERT INTO requests
      (company, contactPerson, email, phone, region, checkin, duration, totalPersons, personsPerRoom, budget, included, notes, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
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

    // Optioneel: mail sturen bij nieuwe aanvraag
    if (transporter) {
      try {
        await transporter.sendMail({
          from: `"Profoma CMS" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
          to: process.env.NOTIFY_TO || "info@profoma.nl",
          subject: `Nieuwe aanvraag personeelshuisvesting - ${company || "Onbekend"}`,
          text: `
Nieuwe aanvraag personeelshuisvesting:

Bedrijf: ${company || "-"}
Contactpersoon: ${contactPerson || "-"}
E-mail: ${email || "-"}
Telefoon: ${phone || "-"}
Regio: ${region || "-"}
Check-in: ${checkin || "-"}
Duur: ${duration || "-"}
Totaal personen: ${totalPersons || 0}
Personen per kamer: ${personsPerRoom || "-"}
Budget p.p.p.w.: ${budget || "-"}
Inclusief: ${includedString || "-"}
Opmerkingen:
${notes || "-"}

Aangemaakt op: ${createdAt}
          `.trim(),
        });
      } catch (mailErr) {
        console.error("Mail verzenden mislukt:", mailErr);
        // Niet falen op mail: aanvraag is gewoon opgeslagen
      }
    }

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error("DB fout:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Overzicht van aanvragen (beschermd)
app.get("/api/requests", adminAuth, (req, res) => {
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

// Verwijderen van een aanvraag (beschermd)
app.delete("/api/requests/:id", adminAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) {
    return res.status(400).json({ success: false, error: "Ongeldig id" });
  }
  try {
    const stmt = db.prepare("DELETE FROM requests WHERE id = ?");
    const info = stmt.run(id);
    res.json({ success: true, deleted: info.changes });
  } catch (err) {
    console.error("Fout bij verwijderen aanvraag:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// SERVER START
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("Server draait op port " + PORT);
});
