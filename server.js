// server.js
// Profoma CMS – Housing aanvragen + Offertes + Admin

const express = require("express");
const cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");

// ================== APP ==================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ================== DATABASE ==================
const db = new Database(path.join(__dirname, "profoma.db"));

// ---------- HOUSING REQUESTS ----------
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

// ---------- OFFERTES ----------
db.prepare(`
  CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    typeAanvraag TEXT,
    dataJson TEXT,
    createdAt TEXT,
    status TEXT DEFAULT 'Nieuw'
  )
`).run();

// ================== ENV ==================
const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  NOTIFY_TO,
  ADMIN_TOKEN
} = process.env;

// ================== ADMIN AUTH ==================
function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next(); // open als geen token

  const token =
    req.headers["x-admin-token"] ||
    req.query.admin_token ||
    "";

  if (String(token) !== String(ADMIN_TOKEN)) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  next();
}

// ================== MAIL ==================
let mailTransport = null;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  mailTransport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

// ================== HELPERS ==================
function normalizeIncluded(val) {
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === "string" && val.trim()) return [val.trim()];
  return [];
}

async function sendMail(subject, html) {
  if (!mailTransport || !SMTP_FROM || !NOTIFY_TO) return;
  await mailTransport.sendMail({
    from: SMTP_FROM,
    to: NOTIFY_TO,
    subject,
    html
  });
}

// ================== ROUTES ==================

app.get("/", (req, res) => {
  res.send("Profoma backend draait 🚀");
});

// ---------- HOUSING AANVRAAG ----------
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
  const includedArr = normalizeIncluded(included);

  try {
    const result = db.prepare(`
      INSERT INTO requests
      (company, contactPerson, email, phone, region, checkin, duration,
       totalPersons, personsPerRoom, budget, included, notes, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
      JSON.stringify(includedArr),
      notes || "",
      createdAt
    );

    await sendMail(
      `Nieuwe housing aanvraag – ${company || "Onbekend"}`,
      `<pre>${JSON.stringify(req.body, null, 2)}</pre>`
    );

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// ---------- OFFERTES ----------
app.post("/api/offerte", async (req, res) => {
  const { type_aanvraag, ...data } = req.body || {};
  const createdAt = new Date().toISOString();

  if (!type_aanvraag) {
    return res.status(400).json({ success: false, error: "type_aanvraag ontbreekt" });
  }

  try {
    const result = db.prepare(`
      INSERT INTO offers (typeAanvraag, dataJson, createdAt)
      VALUES (?, ?, ?)
    `).run(
      type_aanvraag,
      JSON.stringify(data || {}),
      createdAt
    );

    await sendMail(
      `Nieuwe offerte – ${type_aanvraag}`,
      `<pre>${JSON.stringify(req.body, null, 2)}</pre>`
    );

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// ---------- ADMIN: AANVRAGEN ----------
app.get("/api/requests", requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM requests
    ORDER BY datetime(createdAt) DESC
  `).all();
  res.json({ success: true, data: rows });
});

app.patch("/api/requests/:id/status", requireAdmin, (req, res) => {
  const { status } = req.body || {};
  db.prepare(`UPDATE requests SET status = ? WHERE id = ?`)
    .run(status, Number(req.params.id));
  res.json({ success: true });
});

// ---------- ADMIN: OFFERTES ----------
app.get("/api/offertes", requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM offers
    ORDER BY datetime(createdAt) DESC
  `).all();

  const parsed = rows.map(r => ({
    ...r,
    data: (() => {
      try { return JSON.parse(r.dataJson); }
      catch { return {}; }
    })()
  }));

  res.json({ success: true, data: parsed });
});

app.patch("/api/offertes/:id/status", requireAdmin, (req, res) => {
  const { status } = req.body || {};
  db.prepare(`UPDATE offers SET status = ? WHERE id = ?`)
    .run(status, Number(req.params.id));
  res.json({ success: true });
});

// ---------- ADMIN PAGE ----------
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ================== START ==================
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server draait op poort ${PORT}`);
});
