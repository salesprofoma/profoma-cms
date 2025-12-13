// server.js
// Profoma CMS – aanvragen + offertes + agenda/roosters

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

// ✅ NIEUW: Tabel: offertes (zakelijk / housing / particulier)
db.prepare(`
  CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    typeAanvraag TEXT,      -- zakelijk / housing / particulier
    dataJson TEXT,          -- volledige payload als JSON-string
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
    date TEXT,
    startTime TEXT,
    endTime TEXT,
    type TEXT,
    title TEXT,
    location TEXT,
    client TEXT,
    status TEXT DEFAULT 'Nieuw',
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
    beforePhotos TEXT,
    afterPhotos TEXT,
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
    secure: Number(SMTP_PORT || 587) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  mailTransport.verify((err) => {
    if (err) console.error("SMTP verificatie mislukt:", err);
    else console.log("SMTP klaar om mails te versturen");
  });
} else {
  console.log("SMTP niet geconfigureerd – wordt opgeslagen maar niet gemaild.");
}

function normalizeIncluded(included) {
  if (Array.isArray(included)) return included.filter(Boolean);
  if (typeof included === "string" && included.trim()) return [included.trim()];
  return [];
}

// Mail versturen bij nieuwe aanvraag (housing)
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

  const subject = `Nieuwe aanvraag – ${company || "Onbekend"}`;

  let includedArr = [];
  if (Array.isArray(included)) includedArr = included;
  else if (typeof included === "string") {
    try {
      const parsed = JSON.parse(included);
      includedArr = Array.isArray(parsed) ? parsed : [String(parsed)];
    } catch (_) {
      includedArr = included.split(",").map(s => s.trim()).filter(Boolean);
    }
  }

  const includedText = includedArr.length ? includedArr.join(", ") : "";

  const html = `
    <h2>Nieuwe aanvraag</h2>
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
      <tr><td><b>Budget</b></td><td>${budget || "-"}</td></tr>
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

// ✅ NIEUW: mail voor offerte (compact en generiek)
async function sendOfferMail(typeAanvraag, data) {
  if (!mailTransport || !NOTIFY_TO || !SMTP_FROM) return;

  const subject = `Nieuwe offerteaanvraag – ${typeAanvraag}`;
  const pretty = (obj) =>
    Object.entries(obj || {})
      .map(([k, v]) => `<tr><td><b>${k}</b></td><td>${Array.isArray(v) ? v.join(", ") : (v ?? "")}</td></tr>`)
      .join("");

  const html = `
    <h2>Nieuwe offerteaanvraag</h2>
    <p><b>Type:</b> ${typeAanvraag}</p>
    <table border="0" cellpadding="4" cellspacing="0">
      ${pretty(data)}
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
  res.send("Profoma CMS backend werkt!");
});

// ====== AANVRAGEN – PERSONEELSHUISVESTING ======
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
  const status = "Nieuw";

  const includedArr = normalizeIncluded(included);
  const includedString = JSON.stringify(includedArr);

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

    try {
      await sendRequestMail({
        company, contactPerson, email, phone, region, checkin, duration,
        totalPersons, personsPerRoom, budget,
        included: includedArr,
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

app.get("/api/requests", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM requests
      ORDER BY datetime(createdAt) DESC
    `).all();
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Fout bij ophalen aanvragen:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

app.patch("/api/requests/:id/status", (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ success: false, error: "Geen status opgegeven" });

  try {
    db.prepare(`UPDATE requests SET status = ? WHERE id = ?`).run(status, id);
    res.json({ success: true });
  } catch (err) {
    console.error("Fout bij updaten request status:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// ====== ✅ OFFERTES ======
app.post("/api/offerte", async (req, res) => {
  const { typeAanvraag, data } = req.body || {};
  const createdAt = new Date().toISOString();
  const status = "Nieuw";

  if (!typeAanvraag || !data) {
    return res.status(400).json({ success: false, error: "typeAanvraag en data zijn verplicht" });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO offers (typeAanvraag, dataJson, createdAt, status)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(
      String(typeAanvraag),
      JSON.stringify(data),
      createdAt,
      status
    );

    try {
      await sendOfferMail(typeAanvraag, data);
    } catch (mailErr) {
      console.error("Mail (offerte) verzenden mislukt:", mailErr);
    }

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error("DB fout bij opslaan offerte:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

app.get("/api/offertes", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, typeAanvraag, dataJson, createdAt, status
      FROM offers
      ORDER BY datetime(createdAt) DESC
    `).all();

    // parse JSON netjes terug
    const data = rows.map(r => ({
      ...r,
      data: (() => { try { return JSON.parse(r.dataJson || "{}"); } catch (_) { return {}; } })()
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error("Fout bij ophalen offertes:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

app.patch("/api/offertes/:id/status", (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ success: false, error: "Geen status opgegeven" });

  try {
    db.prepare(`UPDATE offers SET status = ? WHERE id = ?`).run(status, id);
    res.json({ success: true });
  } catch (err) {
    console.error("Fout bij updaten offerte status:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// ====== MEDEWERKERS ======
app.post("/api/employees", (req, res) => {
  const { name, role, loginCode } = req.body || {};
  if (!name || !loginCode) return res.status(400).json({ success: false, error: "Naam en loginCode zijn verplicht" });

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

app.get("/api/employees", (req, res) => {
  try {
    const rows = db.prepare(`SELECT id, name, role, active FROM employees ORDER BY name`).all();
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Fout bij ophalen medewerkers:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

app.post("/api/employee/login", (req, res) => {
  const { name, code } = req.body || {};
  if (!name || !code) return res.json({ success: false });

  try {
    const emp = db.prepare(`
      SELECT id, name, role
      FROM employees
      WHERE name = ? AND loginCode = ? AND active = 1
    `).get(name, code);

    if (!emp) return res.json({ success: false });

    const token = `emp_${emp.id}_${Date.now()}`;
    res.json({ success: true, employee: emp, token });
  } catch (err) {
    console.error("Fout bij login medewerker:", err);
    res.status(500).json({ success: false, error: "Server fout" });
  }
});

// ====== OPDRACHTEN / AGENDA ======
app.post("/api/jobs", (req, res) => {
  const {
    date, startTime, endTime, type, title, location, client, status, notes, employeeIds = []
  } = req.body || {};

  if (!date) return res.status(400).json({ success: false, error: "Datum is verplicht" });

  const createdAt = new Date().toISOString();

  try {
    const result = db.prepare(`
      INSERT INTO jobs
      (date, startTime, endTime, type, title, location, client, status, notes, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
    const insertAssign = db.prepare(`INSERT INTO job_assignments (jobId, employeeId) VALUES (?, ?)`);
    (employeeIds || []).forEach((empId) => { if (empId) insertAssign.run(jobId, empId); });

    res.json({ success: true, id: jobId });
  } catch (err) {
    console.error("Fout bij aanmaken job:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

app.get("/api/jobs", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT j.*, GROUP_CONCAT(e.name, ', ') AS employees
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

app.get("/api/employee/jobs", (req, res) => {
  const employeeId = Number(req.query.employeeId);
  if (!employeeId) return res.status(400).json({ success: false, error: "employeeId ontbreekt" });

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

app.post("/api/jobs/:id/report", (req, res) => {
  const jobId = Number(req.params.id);
  const { employeeId, action, comments, beforePhotos = [], afterPhotos = [] } = req.body || {};
  if (!employeeId || !action) return res.status(400).json({ success: false, error: "employeeId en action zijn verplicht" });

  try {
    let report = db.prepare(`SELECT * FROM job_reports WHERE jobId = ? AND employeeId = ?`).get(jobId, employeeId);
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

      const mergedBefore = (beforePhotos && beforePhotos.length) ? beforePhotos : existingBefore;
      const mergedAfter = (afterPhotos && afterPhotos.length) ? afterPhotos : existingAfter;

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

    const newStatus = action === "start" ? "Gestart" : "Afgerond";
    db.prepare(`UPDATE jobs SET status = ? WHERE id = ?`).run(newStatus, jobId);

    res.json({ success: true });
  } catch (err) {
    console.error("Fout bij job report:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

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
