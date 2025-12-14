// server.js
// Profoma CMS – aanvragen + offertes + admin login + exports

const express = require("express");
const cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

// ---------------- App ----------------
const app = express();

// Alleen /api open voor CORS (Wix)
app.use("/api", cors({ origin: "*", methods: ["GET", "POST", "PATCH"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "1mb" }));

// ---------------- DB ----------------
const db = new Database(path.join(__dirname, "profoma.db"));

// Aanvragen (housing)
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

// Offertes (nieuw)
db.prepare(`
  CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,                -- zakelijk / housing / particulier
    name TEXT,
    company TEXT,
    email TEXT,
    phone TEXT,
    location TEXT,            -- locatie(s) of adres
    startDate TEXT,
    details TEXT,             -- JSON-string met alle velden
    createdAt TEXT,
    status TEXT DEFAULT 'Nieuw'
  )
`).run();

// ---------------- ENV ----------------
const {
  ADMIN_USER,
  ADMIN_PASS,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  NOTIFY_TO,
  PUBLIC_BASE_URL
} = process.env;

const BASE_URL = PUBLIC_BASE_URL || "";

// ---------------- Mail ----------------
let mailTransport = null;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  mailTransport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT || 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  mailTransport.verify((err) => {
    if (err) console.error("SMTP verificatie mislukt:", err);
    else console.log("SMTP klaar om mails te versturen");
  });
} else {
  console.log("SMTP niet geconfigureerd – opslag werkt, mail niet.");
}

async function sendMailSafe({ to, subject, html }) {
  if (!mailTransport || !to || !SMTP_FROM) return;
  try {
    await mailTransport.sendMail({ from: SMTP_FROM, to, subject, html });
  } catch (e) {
    console.error("Mail verzenden mislukt:", e);
  }
}

// ---------------- Helpers ----------------
function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach(part => {
    const [k, ...v] = part.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(v.join("=") || "");
  });
  return out;
}

function setCookie(res, name, value, { httpOnly = true, maxAgeSeconds = 60 * 60 * 12 } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=/`,
    `Max-Age=${maxAgeSeconds}`,
    `SameSite=Lax`
  ];
  // Render draait achter https → Secure is ok
  parts.push("Secure");
  if (httpOnly) parts.push("HttpOnly");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly`);
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeIncluded(included) {
  if (Array.isArray(included)) return included.filter(Boolean);
  if (typeof included === "string" && included.trim()) return [included.trim()];
  return [];
}

// ---------------- Admin Auth (simpele login) ----------------
const sessions = new Map(); // token -> { createdAt }

function requireAdmin(req, res, next) {
  // Als ADMIN_USER/PASS niet gezet zijn: blokkeren
  if (!ADMIN_USER || !ADMIN_PASS) {
    return res.status(500).send("ADMIN_USER/ADMIN_PASS ontbreken in Render Environment.");
  }

  const cookies = parseCookies(req);
  const token = cookies.pf_admin || "";
  const session = sessions.get(token);

  if (!session) return res.status(401).redirect("/admin/login");
  next();
}

app.get("/admin/login", (req, res) => {
  res.type("html").send(`
<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Profoma Admin Login</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6faf9;margin:0}
    .wrap{max-width:420px;margin:70px auto;background:#fff;border:1px solid #e5eef0;border-radius:16px;box-shadow:0 14px 34px rgba(15,23,42,.06);padding:22px}
    h1{margin:0 0 8px;font-size:18px}
    p{margin:0 0 14px;color:#475569;font-size:13px}
    label{display:block;font-size:12px;margin:10px 0 6px;color:#0f172a;font-weight:600}
    input{width:100%;padding:10px 12px;border:1px solid #dbe7ea;border-radius:10px;outline:none}
    button{margin-top:14px;width:100%;border:0;border-radius:999px;padding:11px 14px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#00a3b4,#006b8f);color:#fff}
    .err{margin-top:10px;color:#b91c1c;font-size:12px;min-height:16px}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Admin login</h1>
    <p>Log in om aanvragen en offertes te beheren.</p>

    <form method="post" action="/admin/login">
      <label>Gebruikersnaam</label>
      <input name="user" autocomplete="username" required />

      <label>Wachtwoord</label>
      <input name="pass" type="password" autocomplete="current-password" required />

      <button type="submit">Inloggen</button>
    </form>

    <div class="err">${escapeHtml(req.query.err || "")}</div>
  </div>
</body>
</html>
  `);
});

app.use(express.urlencoded({ extended: false }));

app.post("/admin/login", (req, res) => {
  const user = String(req.body.user || "");
  const pass = String(req.body.pass || "");

  if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
    return res.redirect("/admin/login?err=" + encodeURIComponent("Onjuiste inloggegevens"));
  }

  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { createdAt: Date.now() });
  setCookie(res, "pf_admin", token, { maxAgeSeconds: 60 * 60 * 12 }); // 12 uur
  res.redirect("/admin");
});

app.get("/admin/logout", (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.pf_admin) sessions.delete(cookies.pf_admin);
  clearCookie(res, "pf_admin");
  res.redirect("/admin/login");
});

// Static public (NIET beveiligen)
app.use("/public", express.static(path.join(__dirname, "public")));

// Admin pagina (beveiligd)
app.get("/admin", requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ---------------- Health ----------------
app.get("/", (req, res) => res.send("Profoma CMS backend werkt!"));

// ---------------- API: REQUESTS (housing) ----------------
async function sendRequestMail(request) {
  const subject = `Nieuwe huisvestingsaanvraag – ${request.company || "Onbekend bedrijf"}`;
  const includedText = Array.isArray(request.included) ? request.included.join(", ") : "";

  const html = `
    <h2>Nieuwe huisvestingsaanvraag</h2>
    <table cellpadding="6" cellspacing="0" border="0">
      <tr><td><b>Bedrijf</b></td><td>${escapeHtml(request.company || "-")}</td></tr>
      <tr><td><b>Contactpersoon</b></td><td>${escapeHtml(request.contactPerson || "-")}</td></tr>
      <tr><td><b>E-mail</b></td><td>${escapeHtml(request.email || "-")}</td></tr>
      <tr><td><b>Telefoon</b></td><td>${escapeHtml(request.phone || "-")}</td></tr>
      <tr><td><b>Regio</b></td><td>${escapeHtml(request.region || "-")}</td></tr>
      <tr><td><b>Check-in</b></td><td>${escapeHtml(request.checkin || "-")}</td></tr>
      <tr><td><b>Duur</b></td><td>${escapeHtml(request.duration || "-")}</td></tr>
      <tr><td><b>Aantal personen</b></td><td>${escapeHtml(String(request.totalPersons ?? "-"))}</td></tr>
      <tr><td><b>Personen per kamer</b></td><td>${escapeHtml(request.personsPerRoom || "-")}</td></tr>
      <tr><td><b>Budget</b></td><td>${escapeHtml(request.budget || "-")}</td></tr>
      <tr><td><b>Inbegrepen</b></td><td>${escapeHtml(includedText || "-")}</td></tr>
      <tr><td><b>Opmerkingen</b></td><td>${escapeHtml(request.notes || "-")}</td></tr>
    </table>
  `;

  await sendMailSafe({ to: NOTIFY_TO, subject, html });
}

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

    // Meld-mail naar jullie
    await sendRequestMail({
      company, contactPerson, email, phone, region, checkin, duration,
      totalPersons, personsPerRoom, budget, included: includedArr, notes
    });

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error("DB fout bij opslaan request:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Admin: requests ophalen
app.get("/api/requests", requireAdmin, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT *
      FROM requests
      ORDER BY datetime(createdAt) DESC
    `).all();

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Fout bij ophalen aanvragen:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Admin: request status aanpassen
app.patch("/api/requests/:id/status", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ success: false, error: "Geen status" });

  try {
    db.prepare(`UPDATE requests SET status = ? WHERE id = ?`).run(status, id);
    res.json({ success: true });
  } catch (err) {
    console.error("Fout bij updaten request status:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// ---------------- API: OFFERS ----------------
function summarizeOffer(type, body) {
  // Voor admin-lijst: handige velden
  if (type === "particulier") {
    return {
      name: body.name || "",
      company: "",
      email: body.email || "",
      phone: body.phone || "",
      location: body.address || "",
      startDate: body.preferredDay || ""
    };
  }
  if (type === "housing") {
    return {
      name: body.contactPerson || "",
      company: body.company || "",
      email: body.email || "",
      phone: body.phone || "",
      location: body.housingLocations || "",
      startDate: body.startDate || ""
    };
  }
  // zakelijk
  return {
    name: body.contactPerson || "",
    company: body.company || "",
    email: body.email || "",
    phone: body.phone || "",
    location: body.locations || "",
    startDate: body.startDate || ""
  };
}

async function sendOfferNotifyMail({ type, summary, details }) {
  const subject = `Nieuwe offerteaanvraag – ${type}`;
  const html = `
    <h2>Nieuwe offerteaanvraag</h2>
    <p><b>Type:</b> ${escapeHtml(type)}</p>
    <table cellpadding="6" cellspacing="0" border="0">
      <tr><td><b>Naam</b></td><td>${escapeHtml(summary.name || "-")}</td></tr>
      <tr><td><b>Bedrijf</b></td><td>${escapeHtml(summary.company || "-")}</td></tr>
      <tr><td><b>Email</b></td><td>${escapeHtml(summary.email || "-")}</td></tr>
      <tr><td><b>Telefoon</b></td><td>${escapeHtml(summary.phone || "-")}</td></tr>
      <tr><td><b>Locatie</b></td><td>${escapeHtml(summary.location || "-")}</td></tr>
      <tr><td><b>Start</b></td><td>${escapeHtml(summary.startDate || "-")}</td></tr>
    </table>
    <h3>Details</h3>
    <pre style="background:#f6f7f9;border:1px solid #e5e7eb;padding:12px;border-radius:10px;white-space:pre-wrap;">${escapeHtml(JSON.stringify(details, null, 2))}</pre>
    ${BASE_URL ? `<p>Admin: ${escapeHtml(BASE_URL)}/admin</p>` : ""}
  `;
  await sendMailSafe({ to: NOTIFY_TO, subject, html });
}

async function sendOfferConfirmationMail({ toEmail, type }) {
  if (!toEmail) return;

  const subject = "We hebben je offerteaanvraag ontvangen – Profoma";
  const html = `
    <p>Bedankt voor je aanvraag. We hebben je gegevens goed ontvangen.</p>
    <p><b>Type aanvraag:</b> ${escapeHtml(type)}</p>
    <p>We nemen meestal binnen <b>1–2 werkdagen</b> contact met je op.</p>
    <p>Met vriendelijke groet,<br/>Profoma</p>
  `;
  await sendMailSafe({ to: toEmail, subject, html });
}

// Public endpoint (Wix) – offerte opslaan
app.post("/api/offer", async (req, res) => {
  const { type } = req.body || {};
  const offerType = String(type || "").trim(); // zakelijk / housing / particulier

  if (!["zakelijk", "housing", "particulier"].includes(offerType)) {
    return res.status(400).json({ success: false, error: "Ongeldig type" });
  }

  const createdAt = new Date().toISOString();
  const status = "Nieuw";

  try {
    const summary = summarizeOffer(offerType, req.body || {});
    const detailsString = JSON.stringify(req.body || {});

    const stmt = db.prepare(`
      INSERT INTO offers
      (type, name, company, email, phone, location, startDate, details, createdAt, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      offerType,
      summary.name || "",
      summary.company || "",
      summary.email || "",
      summary.phone || "",
      summary.location || "",
      summary.startDate || "",
      detailsString,
      createdAt,
      status
    );

    // 1) mail naar jullie
    await sendOfferNotifyMail({ type: offerType, summary, details: req.body || {} });

    // 2) bevestiging naar klant
    await sendOfferConfirmationMail({ toEmail: summary.email, type: offerType });

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error("DB fout bij opslaan offer:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Admin: offers ophalen
app.get("/api/offers", requireAdmin, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, type, name, company, email, phone, location, startDate, createdAt, status
      FROM offers
      ORDER BY datetime(createdAt) DESC
    `).all();
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Fout bij ophalen offers:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Admin: offer details ophalen
app.get("/api/offers/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  try {
    const row = db.prepare(`SELECT * FROM offers WHERE id = ?`).get(id);
    if (!row) return res.status(404).json({ success: false });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error("Fout bij ophalen offer:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// Admin: offer status
app.patch("/api/offers/:id/status", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ success: false, error: "Geen status" });

  try {
    db.prepare(`UPDATE offers SET status = ? WHERE id = ?`).run(status, id);
    res.json({ success: true });
  } catch (err) {
    console.error("Fout bij updaten offer status:", err);
    res.status(500).json({ success: false, error: "Database fout" });
  }
});

// ---------------- Exports (CSV) ----------------
function toCSV(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = String(v ?? "");
    if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map(h => esc(r[h])).join(","));
  return lines.join("\n");
}

app.get("/admin/export/requests.csv", requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT * FROM requests ORDER BY datetime(createdAt) DESC`).all();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=requests.csv");
  res.send(toCSV(rows));
});

app.get("/admin/export/offers.csv", requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT * FROM offers ORDER BY datetime(createdAt) DESC`).all();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=offers.csv");
  res.send(toCSV(rows));
});

// ---------------- Start ----------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log("Server draait op port " + PORT));
