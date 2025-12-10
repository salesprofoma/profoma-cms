// server.js
// Profoma CMS backend – aanvragen + adminoverzicht + agenda (jobs) + personeel

const express = require("express");
const cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");

// ====== ENV VARS ======
const {
  ADMIN_TOKEN,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  NOTIFY_TO,
} = process.env;

// ====== EXPRESS APP ======
const app = express();
app.use(cors());
app.use(express.json());

// ====== DATABASE ======
const db = new Database(path.join(__dirname, "profoma.db"));

// --- Tabel: aanvragen (requests) ---
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
    createdAt TEXT,
    status TEXT DEFAULT 'Nieuw'
  )
`).run();

try {
  db.prepare("ALTER TABLE requests ADD COLUMN status TEXT DEFAULT 'Nieuw'").run();
} catch (e) {
  // kolom bestaat al → negeren
}

// --- Tabel: jobs (agenda) ---
db.prepare(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    title TEXT,
    location TEXT,
    type TEXT,
    client TEXT,
    status TEXT,
    notes TEXT,
    createdAt TEXT
  )
`).run();

// --- Tabel: staff (medewerkers) ---
db.prepare(`
  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT,
    email TEXT,
    role TEXT,
    active INTEGER DEFAULT 1
  )
`).run();

// --- Tabel: job_staff (koppeling job ↔ medewerker) ---
db.prepare(`
  CREATE TABLE IF NOT EXISTS job_staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jobId INTEGER,
    staffId INTEGER,
    startTime TEXT,
    endTime TEXT,
    notes TEXT
  )
`).run();

// ====== MAIL TRANSPORT ======
let mailTransporter = null;

if (SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM && NOTIFY_TO) {
  mailTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 465,
    secure: (Number(SMTP_PORT) || 465) === 465, // 465 = SSL
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
  console.log("Mail-transporter geconfigureerd");
} else {
  console.log("⚠️ Mail niet geconfigureerd (env vars ontbreken)");
}

async function sendNotificationMail(request) {
  if (!mailTransporter) return;

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
  } = request;

  const subject = `Nieuwe aanvraag personeels­huisvesting - ${company || "Onbekend bedrijf"}`;

  const plainText = `
Nieuwe aanvraag personeels­huisvesting

Bedrijf:        ${company || "-"}
Contactpersoon: ${contactPerson || "-"}
E-mail:         ${email || "-"}
Telefoon:       ${phone || "-"}
Regio:          ${region || "-"}
Check-in:       ${checkin || "-"}
Duur:           ${duration || "-"}
Aantal personen: ${totalPersons || "-"}
Personen per kamer: ${personsPerRoom || "-"}
Budget p.p.p.w.: ${budget || "-"}
Inclusief:      ${included || "-"}
Opmerkingen:    ${notes || "-"}

Deze mail is automatisch verstuurd door profoma-cms.
  `.trim();

  const html = `
    <h2>Nieuwe aanvraag personeels­huisvesting</h2>
    <p><strong>Bedrijf:</strong> ${company || "-"}</p>
    <p><strong>Contactpersoon:</strong> ${contactPerson || "-"}</p>
    <p><strong>E-mail:</strong> ${email || "-"}</p>
    <p><strong>Telefoon:</strong> ${phone || "-"}</p>
    <p><strong>Regio:</strong> ${region || "-"}</p>
    <p><strong>Check-in:</strong> ${checkin || "-"}</p>
    <p><strong>Duur:</strong> ${duration || "-"}</p>
    <p><strong>Aantal personen:</strong> ${totalPersons || "-"}</p>
    <p><strong>Personen per kamer:</strong> ${personsPerRoom || "-"}</p>
    <p><strong>Budget p.p.p.w.:</strong> ${budget || "-"}</p>
    <p><strong>Inclusief:</strong> ${included || "-"}</p>
    <p><strong>Opmerkingen / speciale wensen:</strong><br>${(notes || "-")
      .replace(/\n/g, "<br>")}</p>
    <hr>
    <p>Deze mail is automatisch verstuurd door het Profoma CMS.</p>
  `;

  try {
    await mailTransporter.sendMail({
      from: SMTP_FROM,
      to: NOTIFY_TO,
      subject,
      text: plainText,
      html,
    });
    console.log("Mail verzonden naar", NOTIFY_TO);
  } catch (err) {
    console.error("Mail verzenden mislukt:", err);
  }
}

// ====== MIDDLEWARE ADMIN AUTH ======
function checkAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  next();
}

// ====== ROUTES ======

// Test route
app.get("/", (req, res) => {
  res.send("Profoma CMS backend werkt! 🚀");
});

// --- Housing aanvraag opslaan ---
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
  const status = "Nieuw";

  try {
    const stmt = db.prepare(`
      INSERT INTO requests
      (company, contactPerson, email, phone, region, checkin, duration,
       totalPersons, personsPerRoom, budget, included, notes, createdAt, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
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
      status
    );

    // Mail sturen (niet blokkerend)
    sendNotificationMail({
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
      included: includedString,
      notes,
    });

    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error("DB fout:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Housing aanvragen overzicht ---
app.get("/api/requests", checkAdmin, (req, res) => {
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
          createdAt,
          status
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

// --- Housing status updaten ---
app.post("/api/update-status", checkAdmin, (req, res) => {
  const { id, status } = req.body;

  if (!id || !status) {
    return res
      .status(400)
      .json({ success: false, error: "id en status zijn verplicht" });
  }

  try {
    db.prepare("UPDATE requests SET status = ? WHERE id = ?").run(status, id);
    res.json({ success: true });
  } catch (err) {
    console.error("Status update fout:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// ====== AGENDA / JOBS ======

// Job aanmaken
app.post("/api/jobs", checkAdmin, (req, res) => {
  const {
    date,
    title,
    location,
    type,
    client,
    status,
    notes,
  } = req.body;

  if (!date || !title) {
    return res
      .status(400)
      .json({ success: false, error: "Datum en titel zijn verplicht" });
  }

  const createdAt = new Date().toISOString();
  const finalStatus = status || "Gepland";

  try {
    const stmt = db.prepare(`
      INSERT INTO jobs
      (date, title, location, type, client, status, notes, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      date,
      title || "",
      location || "",
      type || "",
      client || "",
      finalStatus,
      notes || "",
      createdAt
    );

    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error("DB fout (jobs):", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Jobs lijst met gekoppelde medewerkers (staffNames)
app.get("/api/jobs", checkAdmin, (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT
          j.id,
          j.date,
          j.title,
          j.location,
          j.type,
          j.client,
          j.status,
          j.notes,
          j.createdAt,
          IFNULL(GROUP_CONCAT(s.name, ', '), '') AS staffNames
        FROM jobs j
        LEFT JOIN job_staff js ON j.id = js.jobId
        LEFT JOIN staff s ON s.id = js.staffId
        GROUP BY j.id
        ORDER BY j.date ASC, datetime(j.createdAt) ASC`
      )
      .all();

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Fout bij ophalen van jobs:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Job-status updaten
app.post("/api/jobs/update-status", checkAdmin, (req, res) => {
  const { id, status } = req.body;

  if (!id || !status) {
    return res
      .status(400)
      .json({ success: false, error: "id en status zijn verplicht" });
  }

  try {
    db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, id);
    res.json({ success: true });
  } catch (err) {
    console.error("Job-status update fout:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// ====== STAFF (MEDEWERKERS) ======

// Medewerker toevoegen
app.post("/api/staff", checkAdmin, (req, res) => {
  const { name, phone, email, role } = req.body;

  if (!name) {
    return res
      .status(400)
      .json({ success: false, error: "Naam is verplicht" });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO staff (name, phone, email, role, active)
      VALUES (?, ?, ?, ?, 1)
    `);

    const info = stmt.run(
      name,
      phone || "",
      email || "",
      role || ""
    );

    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error("DB fout (staff):", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Lijst medewerkers (alleen active)
app.get("/api/staff", checkAdmin, (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT id, name, phone, email, role, active
         FROM staff
         WHERE active = 1
         ORDER BY name ASC`
      )
      .all();

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Fout bij ophalen staff:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Medewerker aan job koppelen
app.post("/api/jobs/assign-staff", checkAdmin, (req, res) => {
  const { jobId, staffId, startTime, endTime, notes } = req.body;

  if (!jobId || !staffId) {
    return res
      .status(400)
      .json({ success: false, error: "jobId en staffId zijn verplicht" });
  }

  try {
    // simpele INSERT, geen dubbele checks nu
    const stmt = db.prepare(`
      INSERT INTO job_staff (jobId, staffId, startTime, endTime, notes)
      VALUES (?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      jobId,
      staffId,
      startTime || "",
      endTime || "",
      notes || ""
    );

    res.json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    console.error("DB fout (job_staff):", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// ====== SERVER STARTEN ======
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("Server draait op port " + PORT);
});
