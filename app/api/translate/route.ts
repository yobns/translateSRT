import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

export const runtime = "nodejs";

function sanitizeName(name: string): string {
  const base = path.basename(name);
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "input.srt";
}

async function saveTempFile(file: File): Promise<{ dir: string; inPath: string; outPath: string; baseName: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "srt-"));
  const origName = file.name || "input.srt";
  const safeName = sanitizeName(origName);
  const baseName = path.parse(safeName).name;
  const inPath = path.join(tmpDir, safeName);
  await fs.writeFile(inPath, buffer);
  // outPath is determined later once we know target code
  return { dir: tmpDir, inPath, outPath: "", baseName };
}

function runPythonTranslate(cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }>
{ return new Promise((resolve) => {
    const pyCmd = process.env.PYTHON_CMD || "python3";
    const child = spawn(pyCmd, ["run_deep.py"], { cwd, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

function runPythonValidate(cwd: string, filePath: string): Promise<{ code: number; stdout: string; stderr: string }>
{ return new Promise((resolve) => {
    const pyCmd = process.env.PYTHON_CMD || "python3";
    const child = spawn(pyCmd, ["scripts/validate_srt.py", filePath], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

// ...crypto and runtime already imported above

type JobRecord = {
  dir: string;
  inPath: string;
  baseName: string;
  status: "running" | "done" | "error";
  outPath?: string;
  stderr?: string;
};

const JOBS: Map<string, JobRecord> = new Map();

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return new Response(JSON.stringify({ error: "Missing SRT file" }), { status: 400 });
    }
    // Enforce .srt extension
    if (!/\.srt$/i.test(file.name || "")) {
      return new Response(JSON.stringify({ error: "Only .srt files are supported" }), { status: 400 });
    }
    const target = String(form.get("target") || "fr").toLowerCase();
    const source = String(form.get("source") || "auto").toLowerCase();
    const backend = (process.env.PY_BACKEND_URL || "").trim();

    // If a remote Python backend is configured, proxy synchronously (existing behavior)
    if (backend) {
      const fd = new FormData();
      fd.append("file", file, file.name);
      fd.append("target", target);
      fd.append("source", source);
      if (form.get("group_deep")) fd.append("group_deep", String(form.get("group_deep")));
      const base = backend.replace(/\/$/, "");
      // Preflight validate for faster feedback
      try {
        const v = await fetch(base + "/validate", { method: "POST", body: fd });
        if (!v.ok) {
          const t = (await v.text()) || "Invalid SRT file";
          let msg = t;
          const mArrow = t.match(/invalid timecode syntax at line (\d+)/i);
          const mMissing = t.match(/missing text after timecode at line (\d+)/i);
          if (mArrow) msg = `Invalid SRT at line ${mArrow[1]}: expected '-->' between timestamps.`;
          else if (mMissing) msg = `Invalid SRT at line ${mMissing[1]}: missing subtitle text after timecode.`;
          else if (/no valid timecode lines found/i.test(t)) msg = "Invalid SRT: no valid timecode lines found.";
          else if (/timecodes out of order/i.test(t)) msg = "Invalid SRT: timecodes appear out of order.";
          else if (/empty srt/i.test(t)) msg = "Invalid SRT: file is empty.";
          return new Response(JSON.stringify({ error: msg }), { status: 400 });
        }
      } catch {}
      const url = base + "/translate";
      const resp = await fetch(url, { method: "POST", body: fd });
      const ab = await resp.arrayBuffer();
      // Pass-through headers we care about
      const cd = resp.headers.get("content-disposition") || `attachment; filename="output_${target}.srt"`;
      const cl = resp.headers.get("content-length") || String(ab.byteLength || 0);
      return new Response(ab, {
        status: resp.status,
        headers: {
          "Content-Type": resp.headers.get("content-type") || "text/plain; charset=utf-8",
          "Content-Disposition": cd,
          "Content-Length": cl,
          "Cache-Control": "no-store",
        },
      });
    }

  const { dir, inPath, baseName } = await saveTempFile(file);
    // Quick format sanity check: try to detect at least one timecode line
    try {
      const text = await fs.readFile(inPath, "utf-8");
      const hasTimecode = /\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/.test(text);
      if (!hasTimecode) {
        return new Response(JSON.stringify({ error: "Invalid SRT: timecode lines not found" }), { status: 400 });
      }
    } catch {}
    const translateDir = path.resolve(process.cwd(), "translate");

  // Strong validation with pysrt before processing
    try {
      const v = await runPythonValidate(translateDir, inPath);
      if (v.code !== 0) {
        let msg = "Invalid SRT file";
        try {
          const j = JSON.parse(v.stdout || v.stderr || "{}");
          if (j.error) {
            const raw = String(j.error);
            // Map to friendly messages
            const mArrow = raw.match(/invalid timecode syntax at line (\d+)/i);
            const mMissing = raw.match(/missing text after timecode at line (\d+)/i);
            if (mArrow) msg = `Invalid SRT at line ${mArrow[1]}: expected '-->' between timestamps.`;
            else if (mMissing) msg = `Invalid SRT at line ${mMissing[1]}: missing subtitle text after timecode.`;
            else if (/no valid timecode lines found/i.test(raw)) msg = "Invalid SRT: no valid timecode lines found.";
            else if (/timecodes out of order/i.test(raw)) msg = "Invalid SRT: timecodes appear out of order.";
            else if (/empty srt/i.test(raw)) msg = "Invalid SRT: file is empty.";
            else msg = `Invalid SRT: ${raw}`;
          }
        } catch {}
        return new Response(JSON.stringify({ error: msg }), { status: 400 });
      }
    } catch {}

    const env: any = {
      INPUT_SRT: inPath,
      TARGET_LANG: target,
      SOURCE_LANG: source,
      OFFER_DOWNLOAD: "0",
      AUTO_DOWNLOAD: "0",
      TRANSLATE_CACHE_PATH: path.join(dir, ".translate_cache.sqlite"),
      GROUP_DEEP: String(form.get("group_deep") ?? "1"),
    } as unknown as NodeJS.ProcessEnv;

    // If the client wants progress updates, create a PROGRESS_PATH inside the temp dir
    const progressPath = path.join(dir, "progress.json");
    env.PROGRESS_PATH = progressPath;

    // Always-on fast mode: speed + context by grouping more lines safely
    env.FAST_MODE = "1";
    env.USE_DOMINANT_FOR_GROUP = env.USE_DOMINANT_FOR_GROUP || "1";
    env.ALLOW_GROUP_AUTO = env.ALLOW_GROUP_AUTO || "1";
    // Defaults tuned for good quality and speed; can be overridden by server env if needed
    env.GROUP_MAX_CHARS = env.GROUP_MAX_CHARS || "2200";
    env.GROUP_MAX_BLOCKS = env.GROUP_MAX_BLOCKS || "12";
    env.GROUP_MAX_GAP_MS = env.GROUP_MAX_GAP_MS || "3000";
    env.CACHE_GROUP_THRESHOLD = env.CACHE_GROUP_THRESHOLD || "0.4";
    env.TRANSLATE_CONCURRENCY = env.TRANSLATE_CONCURRENCY || "6";

    // Start a background job and return a job id so the frontend can poll progress.
    const jobId = crypto.randomUUID();
    JOBS.set(jobId, { dir, inPath, baseName, status: "running" });

    // Spawn the translator in background
    const { code, stdout, stderr } = await (async () => {
      // Use spawn like runPythonTranslate but don't block the event loop while waiting to update JOBS on completion
      const child = spawn(env.PYTHON_CMD || "python3", ["run_deep.py"], { cwd: translateDir, env: { ...process.env, ...env } });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => { out += d.toString(); });
      child.stderr.on("data", (d) => { err += d.toString(); });
      child.on("close", (c) => {
        const outPath = path.join(path.dirname(inPath), `${baseName}_${target}.srt`);
        const rec = JOBS.get(jobId);
        if (rec) {
          rec.status = c === 0 ? "done" : "error";
          rec.outPath = outPath;
          rec.stderr = err;
          JOBS.set(jobId, rec);
        }
      });
      // Return a small wrapper promise that resolves immediately (we don't wait here)
      return { code: 0, stdout: "", stderr: "" };
    })();

    return new Response(JSON.stringify({ jobId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error("Unexpected error in /api/translate", err);
    return new Response(JSON.stringify({ error: "Server error", details: String(err?.message || err) }), { status: 500 });
  }
}

// Status endpoint: GET /api/translate/status?job=JOBID
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const job = url.searchParams.get("job");
  const action = url.searchParams.get("action") || "status";
  if (!job) return new Response(JSON.stringify({ error: "missing job id" }), { status: 400 });
  const rec = JOBS.get(job);
  if (!rec) return new Response(JSON.stringify({ error: "unknown job" }), { status: 404 });

  // If client asked for download
  if (action === "download") {
    if (rec.status !== "done" || !rec.outPath) return new Response(JSON.stringify({ error: "not ready" }), { status: 404 });
    try {
      const data = await fs.readFile(rec.outPath);
      return new Response(data, { status: 200, headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${path.basename(rec.outPath)}"`,
        "Content-Length": String(data.byteLength || 0),
      }});
    } catch (e: any) {
      return new Response(JSON.stringify({ error: "file not found", details: String(e) }), { status: 500 });
    }
  }

  // Default: return status and any progress info from progress.json
  let progress = null;
  try {
    const progRaw = await fs.readFile(path.join(rec.dir, "progress.json"), "utf-8");
    progress = JSON.parse(progRaw);
  } catch {}

  return new Response(JSON.stringify({ status: rec.status, progress }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
