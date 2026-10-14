"use client";

import { useRef, useState } from "react";
import { FileJson, FolderOpen, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { SAMPLE_JSON, safeParseJson } from "@/utils/jsonToHierarchy";

interface JsonUploaderProps {
  onLoad: (data: unknown, name: string) => void;
}

/**
 * 2D landing-page file uploader: drag-and-drop zone for `.json` files
 * plus a raw JSON editor with validation.
 */
export default function JsonUploader({ onLoad }: JsonUploaderProps) {
  const [text, setText] = useState(() => JSON.stringify(SAMPLE_JSON, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadText = (raw: string, name: string) => {
    const { data, error: err } = safeParseJson(raw);
    if (err || data === undefined) {
      setError(err ?? "Invalid JSON.");
      return;
    }
    setError(null);
    setText(raw);
    onLoad(data, name);
  };

  const readFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => loadText(String(reader.result ?? ""), f.name);
    reader.onerror = () => setError(`Could not read ${f.name}.`);
    reader.readAsText(f);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          readFile(e.dataTransfer.files?.[0]);
        }}
        className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed p-4 transition ${
          dragging ? "border-keyblue bg-keyblue/10" : "border-white/15 bg-white/[0.03] hover:border-white/30"
        }`}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5">
          <FolderOpen size={20} className="text-keyblue" />
        </span>
        <span>
          <span className="block text-sm font-medium text-zinc-100">Drop a .json file here, or click to browse</span>
          <span className="block text-xs text-zinc-500">Parsed locally in your browser — nothing is uploaded.</span>
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            readFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {/* Raw editor */}
      <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">Raw JSON</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={10}
        className="w-full resize-y rounded-xl border border-white/10 bg-black/50 p-3 font-mono text-xs leading-relaxed text-zinc-200 outline-none focus:border-keyblue/60"
      />

      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => loadText(text, "editor.json")}
          className="flex items-center gap-1.5 rounded-lg bg-keyblue px-3.5 py-2 text-sm font-semibold text-black transition hover:brightness-110"
        >
          <FileJson size={16} /> Visualize JSON
        </button>
        <button
          onClick={() => {
            const sample = JSON.stringify(SAMPLE_JSON, null, 2);
            setText(sample);
            loadText(sample, "sample.json");
          }}
          className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-sm text-zinc-200 transition hover:bg-white/10"
        >
          <Sparkles size={16} /> Load sample
        </button>
        <button
          onClick={() => {
            setText("");
            setError(null);
          }}
          title="Clear editor"
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/5"
        >
          <RotateCcw size={15} />
        </button>
      </div>
    </div>
  );
}
