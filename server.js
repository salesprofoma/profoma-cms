// server.js
// Profoma CMS – aanvragen + agenda/roosters

const express = require("express");
const cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");

// ---------- Express app ----------
const app = express();
app.use(cors());
app.use(express.json());

// ---------- Database ----------
const db = new Database(path.join(__dirname, "profoma.db"));

// Tabel: aanvragen personeelshuisvesting
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

// Tabel: medewerkers
db.prepare(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    role TEXT,
    loginCode TEXT,
    active INTEGER DEFAULT 1
  )
`).run();

// Tabel: opdrachten / jobs
db.prepare(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,          -- YYYY-MM-DD
    startTime TEXT,     -- HH:mm (optioneel)
    endTime TEXT,       -- HH:mm (optioneel)
    type TEXT,          -- schoonmaak / TD / oplevering etc.
    title TEXT,         -- korte titel
    location TEXT,      -- plaats / adres
    client TEXT,        -- klant / project
    status TEXT DEFAULT 'Nieuw',  -- Nieuw / Gepland / Gestart / Afgerond
    notes TEXT,
    createdAt TEXT
  )
`).run();

// Tabel: koppeling medewerker ↔ opdracht
db.prepare(`
  CREATE TABLE IF NOT EXISTS job_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jobId INTEGER,
    employeeId INTEGER
  )
`).run();

// Tabel: rapportage per opdracht
db.prepare(`
  CREATE TABLE IF NOT EXISTS job_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jobId INTEGER,
    employeeId INTEGER,
    startedAt TEXT,
    finishedAt TEXT,
    beforePhotos TEXT,   -- JSON-string met URLs
    afterPhotos TEXT,    -- JSON-string met URLs
    comments TEXT
  )
`).run();

// ---------- Environment & mail ----------

const {
  ADMIN_TOKEN,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  NOTIFY_TO
} = process.env;

let mailTransport = null;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  mailTransport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT || 587) === 465, // 465 = SSL, anders STARTTLS
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  mailTransport.verify((err) => {
    if (err) {
      console.error("SMTP verificatie mislukt:", err);
    } else {
      console.log("SMTP klaar om mails te versturen");
    }
  });
} else {
  console.log("SMTP niet geconfigureerd – aanvragen worden wel opgeslagen, maar niet gemaild.");
}

// Hulpfunctie: mail versturen bij nieuwe aanvraag
async function sendRequestMail(request) {
  if (!mailTransport || !NOTIFY_TO || !SMTP_FROM) return;

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
  } = request;

  const subject = `Nieuwe huisvestingsaanvraag – ${company || "Onbekend bedrijf"}`;
  const includedText = Array.isArray(included)
    ? included.join(", ")
    : (included || "");

  const html = `
    <h2>Nieuwe huisvestingsaanvraag</h2>
    <p>Er is een nieuwe aanvraag via het formulier binnengekomen.</p>
    <table border="0" cellpadding="4" cellspacing="0">
      <tr><td><b>Bedrijf</b></td><td>${company || "-"}</td></tr>
      <tr><td><b>Contactpersoon</b></td><td>${contactPerson || "-"}</td></tr>
      <tr><td><b>E-mail</b></td><td>${email || "-"}</td></tr>
      <tr><td><b>Telefoon</b></td><td>${phone || "-"}</td></tr>
      <tr><td><b>Regio</b></td><td>${region || "-"}</td></tr>
      <tr><td><b>Check-in</b></td><td>${checkin || "-"}</td></tr>
      <tr><td><b>Duur</b></td><td>${duration || "-"}</td></tr>
      <tr><td><b>Aantal personen</b></td><td>${totalPersons || "-"}</td></tr>
      <tr><td><b>Personen per kamer</b></td><td>${personsPerRoom || "-"}</td></tr>
      <tr><td><b>Budget p.p.p.w.</b></td><td>${budget || "-"}</td></tr>
      <tr><td><b>Inbegrepen</b></td><td>${includedText || "-"}</td></tr>
      <tr><td><b>Opmerkingen</b></td><td>${(notes || "").replace(/\n/g, "<br>")}</td></tr>
    </table>
  `;

  await mailTransport.sendMail({
    from: SMTP_FROM,
    to: NOTIFY_TO,
    subject,
    html
  });
}

// ---------- Routes ----------

// Health check
app.get("/", (req, res) => {
  res.send("Profoma CMS backend werkt! 🚀");
});

// ====== AANVRAGEN – PERSONEELSHUISVESTING ======

// POST: nieuwe aanvraag opslaan
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
  } = req.body || {};

  const createdAt = new Date().toISOString();
  const includedString = Array.isArray(included) ? included.join(", ") : (included || "");
  const status = "Nieuw";

  try {
    const stmt = db.prepare(`
  INSERT INTO requests
  (company, contactPerson, email, phone, region, checkin, duration, totalPersons, personsPerRoom, budget, included, notes, createdAt, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

    const result = stmt.run(
      company || "",
      contactPerson || "",
      email || "",
      phone || "",
      region || "",
      checkin || "",
      duration || "",
      Number(totalPersons || 0),
      personsPerRoom || "",
      budget || "",
      includedString,
      notes || "",
      createdAt,
      status
    );

    // Mail versturen (fouten vangen zodat opslaan altijd lukt)
    try {
      await sendRequestMail({
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
      });
    } catch (mailErr) {
      console.error("Mail verzenden mislukt:", mailErr);
    }

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error("DB fout bij opslaan request:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// GET: alle aanvragen (voor admin)
app.get("/api/requests", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
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
      ORDER BY datetime(createdAt) DESC
    `).all();

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Fout bij ophalen van aanvragen:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// PATCH: status van aanvraag aanpassen (Nieuw / In behandeling / Afgerond)
app.patch("/api/requests/:id/status", (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};

  if (!status) {
    return res.status(400).json({ success: false, error: "Geen status opgegeven" });
  }

  try {
    db.prepare(`UPDATE requests SET status = ? WHERE id = ?`).run(status, id);
    res.json({ success: true });
  } catch (err) {
    console.error("Fout bij updaten status:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// ====== MEDEWERKERS ======

// Admin: medewerker toevoegen (simpel). Dit kun je later via een klein formulier gebruiken.
app.post("/api/employees", (req, res) => {
  const { name, role, loginCode } = req.body || {};
  if (!name || !loginCode) {
    return res.status(400).json({ success: false, error: "Naam en loginCode zijn verplicht" });
  }

  try {
    const result = db.prepare(`
      INSERT INTO employees (name, role, loginCode, active)
      VALUES (?, ?, ?, 1)
    `).run(name, role || "", loginCode);

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error("Fout bij toevoegen medewerker:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Admin: alle medewerkers
app.get("/api/employees", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, name, role, active
      FROM employees
      ORDER BY name
    `).all();
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Fout bij ophalen medewerkers:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Medewerker login (naam + code)
app.post("/api/employee/login", (req, res) => {
  const { name, code } = req.body || {};
  if (!name || !code) {
    return res.json({ success: false });
  }

  try {
    const emp = db.prepare(`
      SELECT id, name, role
      FROM employees
      WHERE name = ? AND loginCode = ? AND active = 1
    `).get(name, code);

    if (!emp) return res.json({ success: false });

    // Simple token (voor nu alleen client-side gebruiken)
    const token = `emp_${emp.id}_${Date.now()}`;

    res.json({ success: true, employee: emp, token });
  } catch (err) {
    console.error("Fout bij login medewerker:", err);
    res.status(500).json({ success: false, error: "Server fout" });
  }
});

// ====== OPDRACHTEN / AGENDA ======

// Admin: nieuwe opdracht aanmaken
app.post("/api/jobs", (req, res) => {
  const {
    date,
    startTime,
    endTime,
    type,
    title,
    location,
    client,
    status,
    notes,
    employeeIds = []   // array met employeeId's voor rooster
  } = req.body || {};

  if (!date) {
    return res.status(400).json({ success: false, error: "Datum is verplicht" });
  }

  const createdAt = new Date().toISOString();

  try {
    const insertJob = db.prepare(`
      INSERT INTO jobs
      (date, startTime, endTime, type, title, location, client, status, notes, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertJob.run(
      date,
      startTime || "",
      endTime || "",
      type || "",
      title || "",
      location || "",
      client || "",
      status || "Gepland",
      notes || "",
      createdAt
    );

    const jobId = result.lastInsertRowid;

    const insertAssign = db.prepare(`
      INSERT INTO job_assignments (jobId, employeeId) VALUES (?, ?)
    `);
    (employeeIds || []).forEach((empId) => {
      if (empId) insertAssign.run(jobId, empId);
    });

    res.json({ success: true, id: jobId });
  } catch (err) {
    console.error("Fout bij aanmaken job:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Admin: alle opdrachten (voor agenda)
app.get("/api/jobs", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT 
        j.*,
        GROUP_CONCAT(e.name, ', ') AS employees
      FROM jobs j
      LEFT JOIN job_assignments ja ON ja.jobId = j.id
      LEFT JOIN employees e ON e.id = ja.employeeId
      GROUP BY j.id
      ORDER BY j.date, j.startTime
    `).all();

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Fout bij ophalen jobs:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Medewerker: eigen opdrachten
app.get("/api/employee/jobs", (req, res) => {
  const employeeId = Number(req.query.employeeId);
  if (!employeeId) {
    return res.status(400).json({ success: false, error: "employeeId ontbreekt" });
  }

  try {
    const rows = db.prepare(`
      SELECT j.*
      FROM jobs j
      JOIN job_assignments ja ON ja.jobId = j.id
      WHERE ja.employeeId = ?
      ORDER BY j.date, j.startTime
    `).all(employeeId);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Fout bij employee jobs:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Medewerker: rapportage / start / afronden + before/after links
app.post("/api/jobs/:id/report", (req, res) => {
  const jobId = Number(req.params.id);
  const {
    employeeId,
    action,          // 'start' of 'finish'
    comments,
    beforePhotos = [],
    afterPhotos = []
  } = req.body || {};

  if (!employeeId || !action) {
    return res.status(400).json({ success: false, error: "employeeId en action zijn verplicht" });
  }

  try {
    // Bestaand report?
    let report = db.prepare(`
      SELECT * FROM job_reports
      WHERE jobId = ? AND employeeId = ?
    `).get(jobId, employeeId);

    const now = new Date().toISOString();

    if (!report) {
      db.prepare(`
        INSERT INTO job_reports
        (jobId, employeeId, startedAt, finishedAt, beforePhotos, afterPhotos, comments)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        jobId,
        employeeId,
        action === "start" ? now : null,
        action === "finish" ? now : null,
        JSON.stringify(beforePhotos || []),
        JSON.stringify(afterPhotos || []),
        comments || ""
      );
    } else {
      const existingBefore = report.beforePhotos ? JSON.parse(report.beforePhotos) : [];
      const existingAfter = report.afterPhotos ? JSON.parse(report.afterPhotos) : [];

      const mergedBefore = (beforePhotos && beforePhotos.length)
        ? beforePhotos
        : existingBefore;

      const mergedAfter = (afterPhotos && afterPhotos.length)
        ? afterPhotos
        : existingAfter;

      const newStartedAt = report.startedAt || (action === "start" ? now : null);
      const newFinishedAt = report.finishedAt || (action === "finish" ? now : null);

      db.prepare(`
        UPDATE job_reports
        SET startedAt = ?, finishedAt = ?, beforePhotos = ?, afterPhotos = ?, comments = ?
        WHERE id = ?
      `).run(
        newStartedAt,
        newFinishedAt,
        JSON.stringify(mergedBefore),
        JSON.stringify(mergedAfter),
        comments || report.comments || "",
        report.id
      );
    }

    // Status van job bijwerken
    const newStatus = action === "start" ? "Gestart" : "Afgerond";
    db.prepare(`UPDATE jobs SET status = ? WHERE id = ?`).run(newStatus, jobId);

    res.json({ success: true });
  } catch (err) {
    console.error("Fout bij job report:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Admin: rapportage per opdracht ophalen
app.get("/api/jobs/:id/report", (req, res) => {
  const jobId = Number(req.params.id);

  try {
    const reports = db.prepare(`
      SELECT r.*, e.name AS employeeName
      FROM job_reports r
      LEFT JOIN employees e ON e.id = r.employeeId
      WHERE r.jobId = ?
    `).all(jobId);

    res.json({ success: true, data: reports });
  } catch (err) {
    console.error("Fout bij ophalen job report:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// ---------- Server start ----------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("Server draait op port " + PORT);
});
