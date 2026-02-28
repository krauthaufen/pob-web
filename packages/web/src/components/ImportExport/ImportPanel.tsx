import { useState, useCallback } from "react";
import { useBuildStore } from "@/store/build-store";
import { decodeBuildCode, parseBuildXml } from "@/worker/build-decoder";

export function ImportPanel() {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { setBuild, setImportCode, build } = useBuildStore();

  const handleImport = useCallback(() => {
    setError(null);
    try {
      const xml = decodeBuildCode(input);
      const build = parseBuildXml(xml);
      setBuild(build);
      setImportCode(input);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to decode build");
    }
  }, [input, setBuild, setImportCode]);

  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-poe-accent">
        Import Build
      </h2>
      <textarea
        className="w-full rounded border border-poe-border bg-poe-bg p-3 font-mono text-xs text-poe-text placeholder-gray-600 focus:border-poe-accent focus:outline-none"
        rows={4}
        placeholder="Paste PoB build code here..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleImport();
        }}
      />
      <div className="flex items-center gap-3">
        <button
          className="rounded bg-poe-accent px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
          onClick={handleImport}
          disabled={!input.trim()}
        >
          Import
        </button>
        {build && (
          <span className="text-xs text-gray-400">
            {build.ascendancy || build.className} Lv{build.level} — {build.nodes.length} nodes
          </span>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
