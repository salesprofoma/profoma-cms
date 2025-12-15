import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const prisma = new PrismaClient();

/**
 * CORS
 * - Wix formulier post vanaf profoma.nl (ander domein)
 * - Admin draait op dezelfde Render service (zelfde origin)
 */
app.use(
  cors({
    origin: "*", // oké voor nu; later kunnen we stricter maken
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Token"],
  })
);
app.options("*", cors());

app.use(express.json({ limit: "1mb" }));

/**
 * Static files (admin.html)
 * Zorg dat je bestand staat op: server/src/public/admin.html
 */
app.use(express.static(path.join(__dirname, "public")));

// Handige shortcuts
app.get("/admin", (req, res) => res.redirect("/admin.html"));

/**
 * Health
 */
app.get("/health", (req, res) => res.json({ status: "ok" }));

/**
 * Token helper
 * - Als ADMIN_TOKEN bestaat: gebruik die (makkelijkst).
 * - Anders: maak vaste token op basis van ADMIN_USER + ADMIN_PASS (sha256).
 */
function getExpectedAdminToken() {
  const explicit = (process.env.ADMIN_TOKEN || "").trim();
  if (explicit) return explicit;

  const u = (process.env.ADMIN_USER || "admin").trim();
  const p = (process.env.ADMIN_PASS || "").trim();
  if (!p) return ""; // geen pass = geen veilige token

  return crypto.createHash("sha256").update(`${u}:${p}`).digest("hex");
}

/**
 * Admin login
 * POST /admin/login
 * Body: { username, password }
 * -> { success: true, token }
 */
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body || {};

  const u = (process.env.ADMIN_USER || "admin").trim();
  const p = (process.env.ADMIN_PASS || "").trim();

  if (!p) {
    return res.status(500).json({
      success: false,
      error: "ADMIN_PASS ontbreekt in environment variables",
    });
  }

  if ((username || "").trim() === u && (password || "").trim() === p) {
    return res.json({ success: true, token: getExpectedAdminToken() });
  }

  return res.status(401).json({ success: false, error: "Onjuiste inloggegevens" });
});

/**
 * requireAdmin middleware
 * Verwacht:
 * - X-Admin-Token: <token>
 *   of
 * - Authorization: Bearer <token>
 */
function requireAdmin(req, res, next) {
  const expected = getExpectedAdminToken();
  if (!expected) {
    return res.status(500).json({
      success: false,
      error: "Admin auth niet geconfigureerd (ADMIN_TOKEN of ADMIN_PASS ontbreekt).",
    });
  }

  const auth = String(req.headers.authorization || "");
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const xToken = String(req.headers["x-admin-token"] || "").trim();

  const token = bearer || xToken;

  if (!token || token !== expected) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  return next();
}

/**
 * GET /api/offers
 * Haal alle offerte-aanvragen op (nieuwste eerst)
 */
app.get("/api/offers", requireAdmin, async (req, res) => {
  try {
    const rows = await prisma.offerRequest.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("GET /api/offers error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch offers" });
  }
});

/**
 * PATCH /api/offers/:id/status
 * Body: { status: "Nieuw" | "In behandeling" | "Offerte verstuurd" | "Afgerond" | "Afgewezen" }
 *
 * Let op: id is STRING (cuid) volgens jouw Prisma schema.
 */
app.patch("/api/offers/:id/status", requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const status = String(req.body?.status || "").trim();

    const allowed = ["Nieuw", "In behandeling", "Offerte verstuurd", "Afgerond", "Afgewezen"];

    if (!id) return res.status(400).json({ success: false, error: "Invalid id" });
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid status" });
    }

    const updated = await prisma.offerRequest.update({
      where: { id },
      data: { status },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error("PATCH /api/offers/:id/status error:", err);
    // Prisma “not found” wat netter teruggeven:
    if (String(err?.code || "") === "P2025") {
      return res.status(404).json({ success: false, error: "Offer not found" });
    }
    res.status(500).json({ success: false, error: "Failed to update status" });
  }
});

/**
 * POST /api/offer
 * Jouw Wix formulier post hierheen.
 * (Publiek, geen admin token nodig)
 */
app.post("/api/offer", async (req, res) => {
  try {
    const type = String(req.body?.type || "").trim() || "onbekend";

    const created = await prisma.offerRequest.create({
      data: {
        type,
        payload: req.body,
        // status default moet in prisma schema staan: status String @default("Nieuw")
      },
    });

    res.json({ success: true, id: created.id });
  } catch (err) {
    console.error("POST /api/offer error:", err);
    res.status(500).json({ success: false, error: "Failed to store offer" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
