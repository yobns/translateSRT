import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

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

    // If in production and no remote Python backend is configured, fail fast with a helpful error.
    // In production the Next runtime usually doesn't have Python or the translator pipeline available,
    // so attempting to run it here will fail; require a remote backend and proxy to it instead.
    if (!backend && process.env.NODE_ENV === "production") {
      console.error("PY_BACKEND_URL is not set in production. Set PY_BACKEND_URL to your backend URL (eg https://translatesrt.onrender.com)");
      return new Response(JSON.stringify({ error: "Backend not configured. Set PY_BACKEND_URL in frontend environment to your Python backend URL." }), { status: 502 });
    }

    // If a remote Python backend is configured (for Vercel), proxy the request.
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
      // Stream the backend response instead of buffering it. This allows the browser to
      // receive progress events and streaming bytes in production where buffering can hide progress.
      let resp: Response;
      try {
        resp = await fetch(url, { method: "POST", body: fd });
      } catch (err: any) {
        console.error("Error proxying to backend:", err);
        return new Response(JSON.stringify({ error: "Proxy error", details: String(err?.message || err) }), { status: 502 });
      }

      // Build forwarded headers, filtering hop-by-hop headers per RFC.
      const hopByHop = new Set([
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
      ]);
      const outHeaders = new Headers();
      for (const [k, v] of resp.headers.entries()) {
        if (!hopByHop.has(k.toLowerCase())) {
          outHeaders.set(k, v as string);
        }
      }
      // Ensure content-disposition and cache-control exist for the client
      if (!outHeaders.has("content-disposition")) {
        outHeaders.set("content-disposition", `attachment; filename="output_${target}.srt"`);
      }
      outHeaders.set("cache-control", "no-store");

      // Normalize the body: Node fetch (or platform) may return a Node Readable stream which
      // is not directly consumable by the Web Response in some runtimes. Convert Node streams
      // to Web ReadableStream when necessary so the browser/client can consume it reliably.
      let body: any = resp.body;
      try {
        // Heuristic: Node Readable streams typically have a `pipe` method.
        if (body && typeof (body as any).pipe === "function") {
          // If `toWeb` exists (Node 17+), use it; otherwise wrap manually.
          if (typeof (body as any).toWeb === "function") {
            body = (body as any).toWeb();
          } else {
            // Wrap a Node Readable into a Web ReadableStream
            body = new ReadableStream({
              start(controller) {
                (body as any).on("data", (chunk: Buffer) => {
                  try {
                    controller.enqueue(new Uint8Array(chunk));
                  } catch (err) {
                    controller.error(err);
                  }
                });
                (body as any).on("end", () => controller.close());
                (body as any).on("error", (err: any) => controller.error(err));
              },
              cancel(reason) {
                try {
                  (body as any).destroy && (body as any).destroy();
                } catch (e) {}
              },
            });
          }
        }
      } catch (e) {
        // If anything goes wrong normalizing, fall back to passing resp.body directly.
      }

      return new Response(body, {
        status: resp.status,
        headers: outHeaders,
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

    const { code, stdout, stderr } = await runPythonTranslate(translateDir, env);

    const lowerOut = (stdout + "\n" + stderr).toLowerCase();
    if (code !== 0) {
      console.error("Python translate failed", { code, stdout, stderr });
      return new Response(JSON.stringify({ error: "Translation failed", details: stderr || stdout }), { status: 500 });
    }
    // Map common pipeline errors to 400s where appropriate
    if (lowerOut.includes("error opening srt file")) {
      return new Response(JSON.stringify({ error: "Invalid SRT file format" }), { status: 400 });
    }
    if (lowerOut.includes("no srt file found")) {
      return new Response(JSON.stringify({ error: "SRT could not be read" }), { status: 400 });
    }

    const outPath = path.join(path.dirname(inPath), `${baseName}_${target}.srt`);
    let data: Buffer;
    try {
      data = await fs.readFile(outPath);
    } catch (e) {
      console.error("Output SRT not found", e, { outPath, stdout, stderr });
      return new Response(JSON.stringify({ error: "Translation failed", details: stdout || String(e) }), { status: 500 });
    }

    // Best-effort cleanup
    try { await fs.unlink(inPath); } catch {}
    try { await fs.unlink(outPath); } catch {}
    try { await fs.rm(dir, { recursive: true, force: true }); } catch {}

    const ab = (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    return new Response(ab, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}_${target}.srt"`,
        "Content-Length": String(data.byteLength || 0),
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("Unexpected error in /api/translate", err);
    return new Response(JSON.stringify({ error: "Server error", details: String(err?.message || err) }), { status: 500 });
  }
}
