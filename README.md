# pdf2skill-lite

Local MVP that compiles a PDF into a Claude/OpenCode skill pack.

## Features

- Extract text from PDF
- Split into semantic chunks
- Generate `SKILL.md`, `skills/index.md`, and atomic `skills/skill-xxx.md`
- Extract step lists and IF/ELSE style branch conditions
- Build keyword-based routing scores
- Build dependency graph (Mermaid)
- Accept multiple PDF inputs in one compile
- Language-aware keyword extraction (`--lang auto|zh|en`)
- Export both folder output and `skills.zip`

## Install

```bash
npm install
```

## Web Mode

Start website:

```bash
npm run web
```

Then open:

- `http://localhost:3789`

Web supports:

- Multi-PDF upload
- `name/lang/maxChunks/minScore` configuration
- One-click compile and ZIP download

### Security env vars (recommended)

- `COMPILE_TOKEN`: enable API token auth for `/api/compile`
- `MAX_UPLOAD_MB`: max single file upload size (default `100`)
- `OUTPUT_TTL_HOURS`: auto cleanup old artifacts in `web-output` (default `24`)

Example:

```bash
COMPILE_TOKEN=change-me MAX_UPLOAD_MB=50 OUTPUT_TTL_HOURS=12 npm run web
```

When token is set, call API with header:

```txt
x-compile-token: <COMPILE_TOKEN>
```

## Free Platform Deploy

### Render

- This repo already includes `Dockerfile` and `render.yaml`.
- Push to GitHub, then create Render Web Service from the repo.
- Render will build and run automatically.

Recommended Render env vars:

- `PORT=3789`
- `COMPILE_TOKEN=<strong-random-token>`
- `MAX_UPLOAD_MB=50`
- `OUTPUT_TTL_HOURS=12`

## Usage

```bash
node index.js --input "D:/path/to/book.pdf" --name "game-design" --outdir "D:/output" --max-chunks 24 --min-score 55 --lang auto
```

Multi-file compile:

```bash
node index.js --input "D:/books/a.pdf,D:/books/b.pdf" --name "merged-knowledge" --outdir "D:/output" --lang zh
```

## Output

If `--name game-design` and `--outdir D:/output`:

- Folder: `D:/output/game-design/`
- Zip: `D:/output/game-design.zip`

Generated metadata includes:

- `skills/routes.json` (routing scores + keywords + deps)
- `skills/dependency-graph.md` (Mermaid graph)

## Flags

- `--input`: one PDF path, multiple `--input` flags, or comma-separated paths
- `--lang`: `auto` (default), `zh`, or `en`
- `--min-score`: routing score cutoff written to metadata

## Import

Claude Code:

```bash
unzip "D:/output/game-design.zip" -d ~/.claude/skills/game-design/
```

OpenCode:

```bash
unzip "D:/output/game-design.zip" -d ~/.config/opencode/skills/game-design/
```
