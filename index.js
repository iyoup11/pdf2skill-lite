#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const pdfParse = require("pdf-parse");

function printHelp() {
  const help = [
    "pdf2skill-lite",
    "",
    "Usage:",
    "  pdf2skill-lite --input <file.pdf[,file2.pdf]> --name <skill-name> [--outdir <dir>] [--max-chunks <n>] [--min-score <n>] [--lang <auto|zh|en>]",
    "",
    "Options:",
    "  --input, -i       Path to source PDF (repeatable or comma-separated)",
    "  --name, -n        Skill name (slug recommended)",
    "  --outdir, -o      Output directory (default: current directory)",
    "  --max-chunks      Max generated atomic skills (default: 24)",
    "  --min-score       Minimum routing score cutoff (default: 55)",
    "  --lang            Language mode: auto|zh|en (default: auto)",
    "  --help, -h        Show help",
  ].join("\n");

  process.stdout.write(`${help}\n`);
}

function parseArgs(argv) {
  const args = { outdir: process.cwd(), maxChunks: 24, minScore: 55, lang: "auto", inputs: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];

    if (key === "--help" || key === "-h") {
      args.help = true;
      return args;
    }
    if (key === "--input" || key === "-i") {
      args.inputs.push(val);
      i += 1;
      continue;
    }
    if (key === "--name" || key === "-n") {
      args.name = val;
      i += 1;
      continue;
    }
    if (key === "--outdir" || key === "-o") {
      args.outdir = val;
      i += 1;
      continue;
    }
    if (key === "--max-chunks") {
      args.maxChunks = Number.parseInt(val, 10);
      i += 1;
      continue;
    }
    if (key === "--min-score") {
      args.minScore = Number.parseInt(val, 10);
      i += 1;
      continue;
    }
    if (key === "--lang") {
      args.lang = String(val || "auto").toLowerCase();
      i += 1;
      continue;
    }
  }
  args.inputs = args.inputs
    .flatMap((x) => String(x).split(","))
    .map((x) => x.trim())
    .filter(Boolean);
  return args;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "your", "when", "where", "what", "which", "will",
  "are", "is", "to", "of", "on", "in", "by", "or", "as", "an", "a", "be", "at", "it", "if", "else", "then",
  "我们", "你们", "他们", "可以", "需要", "进行", "以及", "通过", "一个", "一种", "这些", "那些", "为了", "相关",
  "使用", "方法", "步骤", "说明", "内容", "处理", "系统", "模块", "结果", "生成", "分析", "执行", "支持", "包括",
]);

const STOPWORDS_EN = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "your", "when", "where", "what", "which", "will",
  "are", "is", "to", "of", "on", "in", "by", "or", "as", "an", "a", "be", "at", "it", "if", "else", "then",
  "can", "should", "could", "would", "using", "used", "use", "also", "such", "than", "been", "was", "were",
]);

const STOPWORDS_ZH = new Set([
  "我们", "你们", "他们", "可以", "需要", "进行", "以及", "通过", "一个", "一种", "这些", "那些", "为了", "相关",
  "使用", "方法", "步骤", "说明", "内容", "处理", "系统", "模块", "结果", "生成", "分析", "执行", "支持", "包括",
  "实现", "进行中", "提供", "根据", "其中", "如何", "什么", "为什么", "然后", "否则", "如果", "当", "并且",
]);

const CONDITIONAL_PATTERNS = [
  /\bif\b.+\bthen\b/gi,
  /\bif\b.+/gi,
  /\bwhen\b.+/gi,
  /\bunless\b.+/gi,
  /\belse\b.+/gi,
  /如果.+/g,
  /若.+/g,
  /当.+/g,
  /否则.+/g,
  /异常.+/g,
];

const STEP_PATTERNS = [
  /^\s*(\d+[.)、]|[-*])\s+(.+)/,
  /^\s*(第[一二三四五六七八九十0-9]+步)\s*[：:、]?\s*(.+)$/,
];

function slugify(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function toTitle(line, index) {
  const clean = line
    .replace(/^[-*#\d.\s]+/, "")
    .replace(/[。.!?；;:：]+$/, "")
    .trim();
  if (!clean) {
    return `skill-${String(index + 1).padStart(3, "0")}`;
  }
  return clean.length > 42 ? clean.slice(0, 42) : clean;
}

function normalizeText(text) {
  return text
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ \u00A0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSemanticBlocks(text) {
  const blocks = text
    .split(/\n\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.replace(/\s+/g, "").length >= 40);

  return blocks;
}

function chunkBlocks(blocks, maxChunks) {
  const chunks = [];
  let current = [];
  let currentWords = 0;
  const targetMinWords = 140;
  const targetMaxWords = 280;

  for (const block of blocks) {
    const words = block.split(/\s+/).filter(Boolean).length;
    if (
      current.length > 0 &&
      (currentWords + words > targetMaxWords || currentWords >= targetMinWords)
    ) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentWords = 0;
    }
    current.push(block);
    currentWords += words;
  }
  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }

  if (chunks.length <= maxChunks) {
    return chunks;
  }

  const ratio = Math.ceil(chunks.length / maxChunks);
  const reduced = [];
  for (let i = 0; i < chunks.length; i += ratio) {
    reduced.push(chunks.slice(i, i + ratio).join("\n\n"));
  }
  return reduced.slice(0, maxChunks);
}

function detectLanguage(text) {
  const zhCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const enCount = (text.match(/[A-Za-z]/g) || []).length;
  if (zhCount === 0 && enCount === 0) {
    return "auto";
  }
  return zhCount >= enCount ? "zh" : "en";
}

function tokenize(text, langMode) {
  const selectedLang = langMode === "auto" ? detectLanguage(text) : langMode;
  if (selectedLang === "zh") {
    const zhTokens = (text.match(/[\u4e00-\u9fa5]{2,}/g) || []).filter((x) => !STOPWORDS_ZH.has(x));
    if (zhTokens.length > 0) {
      return zhTokens;
    }
    return (text.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((x) => !STOPWORDS_EN.has(x));
  }
  if (selectedLang === "en") {
    const enTokens = (text.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((x) => !STOPWORDS_EN.has(x));
    if (enTokens.length > 0) {
      return enTokens;
    }
    return (text.match(/[\u4e00-\u9fa5]{2,}/g) || []).filter((x) => !STOPWORDS_ZH.has(x));
  }
  return (text.toLowerCase().match(/[a-z0-9]{3,}|[\u4e00-\u9fa5]{2,}/g) || [])
    .filter((x) => !STOPWORDS.has(x));
}

function topKeywords(text, limit = 10, langMode = "auto") {
  const freq = new Map();
  for (const token of tokenize(text, langMode)) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

function extractSteps(text) {
  const lines = text.split("\n");
  const out = [];
  for (const line of lines) {
    for (const p of STEP_PATTERNS) {
      const m = line.match(p);
      if (m) {
        const val = (m[2] || m[1] || "").trim();
        if (val && val.length > 4) {
          out.push(val);
        }
        break;
      }
    }
  }
  return out.slice(0, 8);
}

function extractConditions(text) {
  const found = [];
  for (const p of CONDITIONAL_PATTERNS) {
    const matches = text.match(p) || [];
    for (const m of matches) {
      const clean = m.replace(/\s+/g, " ").trim();
      if (clean.length >= 8 && clean.length <= 100) {
        found.push(clean);
      }
    }
  }
  return Array.from(new Set(found)).slice(0, 8);
}

function estimateRoutingScore(item, queryTokens) {
  if (!queryTokens || queryTokens.length === 0) {
    return 60;
  }
  const kw = new Set(item.keywords);
  const overlap = queryTokens.filter((x) => kw.has(x)).length;
  const density = Math.min(25, Math.round((item.keywords.length / 12) * 25));
  const conditionBonus = Math.min(20, item.conditions.length * 4);
  const stepBonus = Math.min(15, item.steps.length * 3);
  const overlapScore = Math.min(40, overlap * 8);
  return Math.max(0, Math.min(100, overlapScore + density + conditionBonus + stepBonus));
}

function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const x of sa) {
    if (sb.has(x)) {
      inter += 1;
    }
  }
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function buildDependencies(items) {
  const deps = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = 0; j < items.length; j += 1) {
      if (i === j) {
        continue;
      }
      const score = jaccard(items[i].keywords, items[j].keywords);
      if (score >= 0.22) {
        deps.push({
          from: items[i].id,
          to: items[j].id,
          weight: Number(score.toFixed(2)),
        });
      }
    }
  }

  const dedup = new Map();
  for (const d of deps) {
    const key = `${d.from}->${d.to}`;
    dedup.set(key, d);
  }
  return Array.from(dedup.values());
}

function buildMainSkillMd(skillName, description, chunkCount) {
  return [
    "---",
    `name: ${skillName}`,
    `description: ${description}`,
    "version: 0.1.0",
    "---",
    "",
    `# ${skillName}`,
    "",
    "This skill pack is auto-compiled from a source PDF.",
    "",
    "## How it works",
    "",
    "- Claude/OpenCode reads `skills/index.md` to route sub-skills.",
    "- Each `skills/skill-xxx.md` contains one atomic capability unit.",
    "- Use this pack when user intent matches a topic in the source book/manual.",
    "",
    "## Routing",
    "",
    "When request includes concepts, methods, procedures, troubleshooting, or checklist",
    "from this domain, select the most relevant atomic skill in `skills/index.md`.",
    "",
    `## Stats\n\n- Generated atomic skills: ${chunkCount}`,
    "- Routing metadata: `skills/routes.json`",
    "- Dependency graph: `skills/dependency-graph.md`",
  ].join("\n");
}

function buildAtomicSkillMd(index, title, content, keywords, steps, conditions) {
  const id = `skill-${String(index + 1).padStart(3, "0")}`;
  return [
    "---",
    `name: ${id}`,
    `description: ${title}`,
    "---",
    "",
    `# ${title}`,
    "",
    "## Trigger",
    "",
    `Use this skill when the user asks about: ${title}`,
    "",
    `**Keywords**: ${keywords.join(", ")}`,
    "",
    "## Input",
    "",
    "- User objective",
    "- Current constraints and context",
    "",
    "## Procedure",
    "",
    "1. Extract the user's concrete target.",
    "2. Map target to the applicable rules/methods below.",
    "3. Output a concise, actionable plan.",
    "",
    "## Extracted Steps",
    "",
    ...(steps.length > 0 ? steps.map((s, idx2) => `${idx2 + 1}. ${s}`) : ["1. No explicit numbered steps found in source."]),
    "",
    "## Conditions / Branches",
    "",
    ...(conditions.length > 0 ? conditions.map((c) => `- ${c}`) : ["- No explicit IF/ELSE style branch found in source."]),
    "",
    "## Knowledge",
    "",
    content,
  ].join("\n");
}

function buildIndexMd(items, minScore) {
  const lines = [
    "# Skill Index",
    "",
    "This file routes user requests to atomic skills.",
    "",
    `Routing score cutoff: ${minScore}`,
    "",
    "| Skill ID | Topic | Trigger Hint | Base Score |",
    "|---|---|---|---|",
  ];

  for (const item of items) {
    lines.push(`| ${item.id} | ${item.title} | ${item.trigger} | ${item.baseScore} |`);
  }
  return lines.join("\n");
}

function buildDependencyGraphMd(items, deps) {
  const lines = [
    "# Dependency Graph",
    "",
    "```mermaid",
    "graph LR",
  ];
  for (const item of items) {
    lines.push(`  ${item.id}["${item.id}: ${item.title.replace(/"/g, "'")}"]`);
  }
  for (const d of deps) {
    lines.push(`  ${d.from} -->|${d.weight}| ${d.to}`);
  }
  lines.push("```");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- Edge weight is keyword-overlap similarity (Jaccard).", "- Use stronger links first when composing multi-skill answers.");
  return lines.join("\n");
}

function buildRoutesJson(items, deps, minScore) {
  return JSON.stringify(
    {
      version: "0.2.0",
      minScore,
      skills: items.map((x) => ({
        id: x.id,
        title: x.title,
        trigger: x.trigger,
        baseScore: x.baseScore,
        keywords: x.keywords,
      })),
      dependencies: deps,
    },
    null,
    2
  );
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function writeZip(zipPath, files) {
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.relativePath.replace(/\\/g, "/"), f.content);
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  fs.writeFileSync(zipPath, buffer);
}

function writePlainFiles(baseDir, files) {
  for (const f of files) {
    const abs = path.join(baseDir, f.relativePath);
    ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, f.content, "utf8");
  }
}

async function run() {
  const args = parseArgs(process.argv);
  if (args.help || args.inputs.length === 0 || !args.name) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const langMode = ["auto", "zh", "en"].includes(args.lang) ? args.lang : "auto";

  const inputPaths = args.inputs.map((x) => path.resolve(x));
  for (const inputPath of inputPaths) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input PDF not found: ${inputPath}`);
    }
  }

  const skillName = slugify(args.name);
  const outRoot = path.resolve(args.outdir, skillName);
  ensureDir(outRoot);

  const extracted = [];
  for (const inputPath of inputPaths) {
    const dataBuffer = fs.readFileSync(inputPath);
    const parsed = await pdfParse(dataBuffer);
    const normalizedSingle = normalizeText(parsed.text || "");
    if (normalizedSingle) {
      extracted.push(`## Source: ${path.basename(inputPath)}\n\n${normalizedSingle}`);
    }
  }
  const normalized = normalizeText(extracted.join("\n\n"));

  if (!normalized) {
    throw new Error("Failed to extract text from PDF (empty output)");
  }

  const blocks = splitSemanticBlocks(normalized);
  const chunks = chunkBlocks(blocks, Number.isFinite(args.maxChunks) ? args.maxChunks : 24);
  const clippedChunks = chunks.filter((x) => x.replace(/\s+/g, "").length > 80);

  if (clippedChunks.length === 0) {
    throw new Error("No meaningful semantic chunks extracted from PDF");
  }

  const skillItems = clippedChunks.map((chunk, idx) => {
    const firstLine = chunk.split("\n")[0] || "";
    const title = toTitle(firstLine, idx);
    const id = `skill-${String(idx + 1).padStart(3, "0")}`;
    const keywords = topKeywords(chunk, 12, langMode);
    const steps = extractSteps(chunk);
    const conditions = extractConditions(chunk);
    const baseScore = estimateRoutingScore({ keywords, steps, conditions }, keywords.slice(0, 5));
    return {
      id,
      title,
      trigger: title.length > 24 ? `${title.slice(0, 24)}...` : title,
      content: chunk,
      keywords,
      steps,
      conditions,
      baseScore,
    };
  });

  const dependencies = buildDependencies(skillItems);

  const desc = `Auto-compiled from ${inputPaths.length} PDF file(s). Includes ${skillItems.length} atomic skills.`;

  const files = [];
  files.push({
    relativePath: `SKILL.md`,
    content: buildMainSkillMd(skillName, desc, skillItems.length),
  });

  files.push({
    relativePath: `README.md`,
    content: [
      `# ${skillName}`,
      "",
      "Generated by pdf2skill-lite.",
      "",
      `Language mode: ${langMode}`,
      `Input files: ${inputPaths.length}`,
      "",
      "## Files",
      "",
      "- `SKILL.md`: entry skill",
      "- `skills/index.md`: router index",
      "- `skills/skill-xxx.md`: atomic skills",
      "- `references/source_excerpt.md`: extracted source text",
      "",
      "## Install",
      "",
      "Copy this folder to your skill directory.",
    ].join("\n"),
  });

  files.push({
    relativePath: `skills/index.md`,
    content: buildIndexMd(skillItems, args.minScore),
  });

  files.push({
    relativePath: `skills/dependency-graph.md`,
    content: buildDependencyGraphMd(skillItems, dependencies),
  });

  files.push({
    relativePath: `skills/routes.json`,
    content: buildRoutesJson(skillItems, dependencies, args.minScore),
  });

  for (const item of skillItems) {
    files.push({
      relativePath: `skills/${item.id}.md`,
      content: buildAtomicSkillMd(
        Number(item.id.slice(-3)) - 1,
        item.title,
        item.content,
        item.keywords,
        item.steps,
        item.conditions
      ),
    });
  }

  files.push({
      relativePath: `references/source_excerpt.md`,
    content: normalized.slice(0, 120000),
  });

  writePlainFiles(outRoot, files);

  const zipPath = path.resolve(args.outdir, `${skillName}.zip`);
  await writeZip(zipPath, files);

  process.stdout.write(
    [
      "pdf2skill-lite done",
      `- input files: ${inputPaths.join("; ")}`,
      `- language mode: ${langMode}`,
      `- skill folder: ${outRoot}`,
      `- zip: ${zipPath}`,
      `- generated skills: ${skillItems.length}`,
      `- dependency edges: ${dependencies.length}`,
    ].join("\n") + "\n"
  );
}

run().catch((err) => {
  process.stderr.write(`pdf2skill-lite failed: ${err.message}\n`);
  process.exit(1);
});
