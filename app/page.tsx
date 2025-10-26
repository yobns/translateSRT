"use client";
import { useCallback, useRef, useState } from "react";

const LANG_OPTIONS = [
  { code: "auto", label: "Auto", flag: "🌐" },
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "pt", label: "Português", flag: "🇵🇹" },
  { code: "ar", label: "العربية", flag: "🇸🇦" },
  { code: "he", label: "עברית", flag: "🇮🇱" },
  { code: "ja", label: "日本語", flag: "🇯🇵" },
  { code: "ko", label: "한국어", flag: "🇰🇷" },
  { code: "zh-cn", label: "中文(简体)", flag: "🇨🇳" },
  { code: "zh-tw", label: "中文(繁體)", flag: "🇹🇼" },
];

export default function Home() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState("auto");
  const [target, setTarget] = useState("fr");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<"idle" | "preparing" | "processing" | "downloading" | "done" | "error">("idle");
  const [downloaded, setDownloaded] = useState(0);
  const [totalSize, setTotalSize] = useState<number | null>(null);
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const [readyName, setReadyName] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const formatBytes = (n: number) => {
    if (!Number.isFinite(n)) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  };

  const pickFile = () => fileRef.current?.click();

  const handleFiles = useCallback((f?: File) => {
    const chosen = f ?? fileRef.current?.files?.[0] ?? null;
    if (!chosen) return;
    const valid = /\.srt$/i.test(chosen.name);
    if (!valid) {
      setError("Invalid file. Please select a .srt file");
      setFile(null);
      return;
    }
    setError(null);
    setFile(chosen);
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (readyUrl) {
      URL.revokeObjectURL(readyUrl);
      setReadyUrl(null);
      setReadyName(null);
    }
    const f = file ?? fileRef.current?.files?.[0] ?? null;
    if (!f) {
      setError("Please select a .srt file");
      return;
    }
    setBusy(true);
    setPhase("preparing");
    setDownloaded(0);
    setTotalSize(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("source", source);
      fd.append("target", target);
    fd.append("group_deep", "1");
      setPhase("processing");
      const res = await fetch("/api/translate", { method: "POST", body: fd });
      setPhase("downloading");
      if (!res.ok) {
        const txt = await res.text();
        let message = txt.trim();
        try {
          const j = JSON.parse(txt);
          message = String(j.error || message);
        } catch {}
        const generic = "Something went wrong. Please try again.";
        const lower = message.toLowerCase();
        const simple = res.status === 400 && (lower.includes("invalid srt") || lower.includes("srt"))
          ? "SRT formatting error"
          : generic;
        setError(simple);
        setPhase("error");
        return;
      }
      let blob: Blob;
      const lenHeader = res.headers.get("content-length");
      const total = lenHeader ? parseInt(lenHeader, 10) : NaN;
      if (res.body && !Number.isNaN(total)) {
        setTotalSize(total);
        try {
          const reader = res.body.getReader();
          const chunks: Uint8Array[] = [];
          let received = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              received += value.byteLength;
              setDownloaded(received);
            }
          }
          const all = new Uint8Array(received);
          let offset = 0;
          for (const ch of chunks) {
            all.set(ch, offset);
            offset += ch.byteLength;
          }
          blob = new Blob([all], { type: res.headers.get("content-type") || "text/plain; charset=utf-8" });
        } catch (e) {
          try {
            blob = await res.blob();
            if (blob && typeof blob.size === "number") {
              setTotalSize(blob.size);
              setDownloaded(blob.size);
            }
          } catch (err) {
            throw err;
          }
        }
      } else {
        blob = await res.blob();
        if (blob && typeof blob.size === "number") {
          setTotalSize(blob.size);
          setDownloaded(blob.size);
        }
      }
      const url = URL.createObjectURL(blob);
      const name = (f.name.replace(/\.srt$/i, "") || "subtitles") + `_${target}.srt`;
      setReadyUrl(url);
      setReadyName(name);
      if (total && !Number.isNaN(total)) {
        setDownloaded(total);
      }
    } catch (err: any) {
      setError(err?.message || String(err));
      setPhase("error");
    } finally {
      setBusy(false);
    }
  };

  const triggerDownload = () => {
    if (!readyUrl || !readyName) return;
    const a = document.createElement("a");
    a.href = readyUrl;
    a.download = readyName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setPhase("downloading");
    showToast("Downloaded!");
  };

  const resetAll = () => {
    if (readyUrl) {
      URL.revokeObjectURL(readyUrl);
    }
    setReadyUrl(null);
    setReadyName(null);
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    setDownloaded(0);
    setTotalSize(null);
    setError(null);
    setBusy(false);
    setPhase("idle");
  };

  return (
  <div className="relative min-h-screen w-full overflow-x-hidden bg-linear-to-b from-white via-zinc-50 to-zinc-100 text-zinc-900 antialiased dark:from-neutral-950 dark:via-neutral-950 dark:to-neutral-900 dark:text-zinc-100">
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-50 mx-auto w-fit rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-lg dark:border-neutral-800 dark:bg-neutral-900 dark:text-zinc-100">
          {toast}
        </div>
      )}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_60rem_at_120%_10%,rgba(14,165,233,0.08),transparent_40%),radial-gradient(40rem_40rem_at_-10%_-10%,rgba(139,92,246,0.08),transparent_40%)]" />
  <div className="mx-auto max-w-3xl px-6 pt-8 pb-16 min-w-0">
        <header className="mb-10 text-center">
          <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-zinc-300">
            <span>🤖 AI‑powered SRT Translation</span>
          </div>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Translate your subtitles with
            <span className="ml-3 inline-block bg-gradient-to-r from-indigo-500 via-pink-500 to-amber-400 bg-clip-text text-transparent font-extrabold tracking-tight text-4xl sm:text-5xl text-glow">AI</span>
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-pretty text-zinc-600 dark:text-zinc-400">Upload your .srt file, pick a target language, and download high‑quality, AI‑powered translations with context‑aware grouping. Simple, fast, free.</p>
        </header>

        <form onSubmit={onSubmit} className="rounded-2xl border border-zinc-200 bg-white/80 p-6 shadow-xl backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-950/80">
          <div className="mb-6">
            <div className="grid grid-cols-3 items-center gap-2 text-center text-xs font-medium text-zinc-600 dark:text-zinc-400">
              <div className={`${phase !== "idle" ? "text-zinc-900 dark:text-zinc-200" : ""}`}>1. Upload</div>
              <div className={`${(phase === "processing" || phase === "downloading" || phase === "done") ? "text-zinc-900 dark:text-zinc-200" : ""}`}>2. Process</div>
              <div className={`${(phase === "downloading" || phase === "done") ? "text-zinc-900 dark:text-zinc-200" : ""}`}>3. Download</div>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-neutral-800">
              {phase === "downloading" && totalSize && totalSize > 0 ? (
                <div
                  className="h-full rounded-full bg-zinc-900 transition-[width] dark:bg-neutral-100"
                  style={{ width: `${Math.min(100, Math.round((downloaded / totalSize) * 100))}%` }}
                />
              ) : phase !== "idle" && phase !== "done" && phase !== "error" ? (
                <div className="h-full w-1/2 animate-pulse rounded-full bg-zinc-900 dark:bg-neutral-100" />
              ) : (
                <div className="h-full w-0" />
              )}
            </div>
            <div className="mt-2 flex items-center justify-end text-[11px] text-zinc-600 dark:text-zinc-400">
              {phase === "downloading" && totalSize && totalSize > 0 ? (
                <span>
                  {Math.round((downloaded / totalSize) * 100)}% ({formatBytes(downloaded)} / {formatBytes(totalSize)})
                </span>
              ) : phase === "downloading" ? (
                <span>Downloading…</span>
              ) : phase === "processing" ? (
                <span>Processing…</span>
              ) : null}
            </div>
            {phase === "processing" && (
              <div className="mt-3 flex items-center justify-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                <svg className="h-4 w-4 animate-spin text-zinc-600 dark:text-zinc-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
                <span>Processing… this can take a few moments. The download will appear automatically once ready.</span>
              </div>
            )}
            {phase === "downloading" && readyUrl && (
              <div className="mt-3 flex items-center justify-center text-sm text-zinc-700 dark:text-zinc-300">
                <span>
                  Your translation is ready — click <strong className="font-semibold">Download file</strong> to save it.
                  {readyName ? (<span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">({readyName}{totalSize ? ` • ${formatBytes(totalSize)}` : ""})</span>) : null}
                </span>
              </div>
            )}
          </div>
          <div className="grid gap-6">
            {phase === "idle" && (
              <div>
                <div
                  onClick={pickFile}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer?.files?.[0];
                    if (f) handleFiles(f);
                  }}
                  className={[
                    "group flex w-full min-w-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition",
                    dragOver ? "border-zinc-900 bg-zinc-50/70 dark:border-neutral-200 dark:bg-neutral-900/60" : "border-zinc-300 hover:bg-zinc-50/60 dark:border-neutral-700 dark:hover:bg-neutral-900/50",
                  ].join(" ")}
                >
                  {file ? (
                    <div className="flex w-full flex-col items-center gap-3">
                        <div className="flex w-full flex-col sm:flex-row items-start sm:items-center gap-3 rounded-md bg-zinc-100 px-4 py-3 text-sm text-zinc-700 dark:bg-neutral-800 dark:text-zinc-200 overflow-hidden">
                          <svg className="hidden sm:block h-6 w-6 text-zinc-600 dark:text-zinc-300 self-center sm:self-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                        </svg>
                          <div className="flex-1 min-w-0 w-full sm:max-w-[calc(100%-6rem)] flex flex-col items-start">
                            <span title={file.name} className="font-medium truncate text-left w-full">{file.name}</span>
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">{formatBytes(file.size)}</span>
                          </div>
                          <button
                            type="button"
                            aria-label="Clear selected file"
                            onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
                            className="ml-0 sm:ml-4 rounded p-1 hover:bg-zinc-200 dark:hover:bg-neutral-700 self-center sm:self-auto"
                            title="Remove"
                          >
                            ✕
                          </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <svg
                        className={[
                          "h-16 w-16 text-zinc-400 transition-transform dark:text-zinc-500",
                          dragOver ? "scale-110" : "group-hover:scale-105"
                        ].join(" ")}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
                        />
                      </svg>
                      <div className="text-sm">
                        <span className="font-medium">Drag & drop</span> your .srt here, or <span className="font-medium underline">click to choose</span>
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">AI‑powered machine translation</div>
                    </>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".srt,text/plain"
                  className="hidden"
                  onChange={() => handleFiles()}
                />
              </div>
            )}

            {phase === "idle" && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium">Source language</label>
                  <select value={source} onChange={(e) => setSource(e.target.value)} className="w-full rounded-md border border-zinc-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                    <option value="auto">🌐 Auto</option>
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium">Target language</label>
                  <select value={target} onChange={(e) => setTarget(e.target.value)} className="w-full rounded-md border border-zinc-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                    {LANG_OPTIONS.filter((l) => l.code !== "auto").map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.flag} {l.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Fast mode is now always enabled server-side for best speed and context. */}

            {error && phase !== "downloading" && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="flex flex-col-reverse items-center gap-3 sm:flex-row sm:items-center sm:justify-center">
              {(phase === "downloading" || phase === "processing") ? (
                <div className="flex items-center gap-3 justify-center flex-wrap">
                  <button
                    type="button"
                    onClick={triggerDownload}
                    disabled={!readyUrl}
                    className="inline-flex w-full sm:w-auto items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                  >
                    {readyUrl ? "Download file" : (
                      <>
                        <svg className="-ml-1 mr-2 h-4 w-4 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                        </svg>
                        Preparing…
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={resetAll}
                    className="inline-flex w-full sm:w-auto items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  >
                    Translate another file
                  </button>
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex w-full sm:w-auto items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
                >
                  {busy ? "Processing…" : "Translate now"}
                </button>
              )}

            </div>
          </div>
        </form>

        <footer className="mt-10 text-center text-xs text-zinc-500 dark:text-zinc-400">
          <div className="flex items-center justify-center gap-3">
            <span className="font-medium">yobns</span>
            <a
              href="https://github.com/yobns"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub profile"
              className="inline-flex items-center justify-center text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.73-4.04-1.61-4.04-1.61-.55-1.4-1.34-1.77-1.34-1.77-1.09-.75.08-.73.08-.73 1.2.08 1.83 1.24 1.83 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.48-1.34-5.48-5.96 0-1.32.47-2.39 1.24-3.23-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23.96-.27 1.98-.4 3-.4s2.04.13 3 .4c2.28-1.55 3.29-1.23 3.29-1.23.66 1.65.24 2.87.12 3.17.77.84 1.23 1.91 1.23 3.23 0 4.63-2.81 5.66-5.49 5.96.43.37.81 1.1.81 2.22 0 1.6-.02 2.89-.02 3.29 0 .32.21.7.82.58C20.56 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
