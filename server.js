const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const app = express();
const PORT = Number.parseInt(process.env.PORT || "3789", 10);
const COMPILE_TOKEN = (process.env.COMPILE_TOKEN || "").trim();
const OUTPUT_TTL_HOURS = Number.parseInt(process.env.OUTPUT_TTL_HOURS || "24", 10);
const MAX_UPLOAD_MB = Number.parseInt(process.env.MAX_UPLOAD_MB || "100", 10);

app.disable("x-powered-by");

const uploadDir = path.join(__dirname, "tmp-uploads");
const outDir = path.join(__dirname, "web-output");
const webDir = path.join(__dirname, "web");

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 1024 * 1024 * MAX_UPLOAD_MB,
    files: 10,
  },
});

function sanitizeSkillName(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanupUploaded(files) {
  for (const f of files || []) {
    if (f && f.path) {
      try {
        fs.unlinkSync(f.path);
      } catch (_) {
        // Ignore cleanup errors.
      }
    }
  }
}

function runCompile(args) {
  return new Promise((resolve, reject) => {
    execFile("node", args, { cwd: __dirname, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || stdout || error.message || "Compile failed").trim()));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function cleanupOldOutputs(rootDir, ttlHours) {
  const ttlMs = Math.max(1, ttlHours) * 60 * 60 * 1000;
  const now = Date.now();

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs <= ttlMs) {
        continue;
      }
      if (entry.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
    } catch (_) {
      // Ignore cleanup failures.
    }
  }
}

function isPdfFile(file) {
  const name = String(file.originalname || "").toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();
  return name.endsWith(".pdf") && mime.includes("pdf");
}

function authGuard(req, res, next) {
  if (!COMPILE_TOKEN) {
    next();
    return;
  }

  const candidate = String(req.headers["x-compile-token"] || req.query.token || "").trim();
  if (!candidate || candidate !== COMPILE_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

app.use(express.static(webDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/compile", authGuard, upload.array("pdfs", 10), async (req, res) => {
  const files = req.files || [];

  cleanupOldOutputs(outDir, OUTPUT_TTL_HOURS);

  if (files.length === 0) {
    res.status(400).json({ error: "Please upload at least one PDF file." });
    return;
  }

  for (const file of files) {
    if (!isPdfFile(file)) {
      cleanupUploaded(files);
      res.status(400).json({ error: `Invalid file type: ${file.originalname}. Only PDF is allowed.` });
      return;
    }
  }

  const rawName = req.body.name || "pdf-skill-pack";
  const skillName = sanitizeSkillName(rawName);
  const lang = ["auto", "zh", "en"].includes(String(req.body.lang || "auto"))
    ? String(req.body.lang || "auto")
    : "auto";

  const maxChunks = Number.parseInt(req.body.maxChunks || "24", 10);
  const minScore = Number.parseInt(req.body.minScore || "55", 10);

  if (!skillName) {
    cleanupUploaded(files);
    res.status(400).json({ error: "Skill name is invalid." });
    return;
  }

  const inputArg = files.map((f) => path.resolve(f.path)).join(",");
  const args = [
    "index.js",
    "--input",
    inputArg,
    "--name",
    skillName,
    "--outdir",
    outDir,
    "--lang",
    lang,
    "--max-chunks",
    Number.isFinite(maxChunks) ? String(maxChunks) : "24",
    "--min-score",
    Number.isFinite(minScore) ? String(minScore) : "55",
  ];

  try {
    await runCompile(args);
    const zipPath = path.join(outDir, `${skillName}.zip`);

    if (!fs.existsSync(zipPath)) {
      throw new Error("Compilation finished but ZIP file was not generated.");
    }

    res.download(zipPath, `${skillName}.zip`, () => {
      cleanupUploaded(files);
    });
  } catch (err) {
    cleanupUploaded(files);
    res.status(500).json({ error: err.message || "Compile failed" });
  }
});

app.listen(PORT, () => {
  process.stdout.write(`pdf2skill-lite web server running: http://localhost:${PORT}\n`);
});
