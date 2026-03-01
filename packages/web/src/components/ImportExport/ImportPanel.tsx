import { useState, useCallback } from "react";
import { useBuildStore } from "@/store/build-store";
import {
  decodeBuildCode,
  parseBuildXml,
  parsePoeNinjaUrl,
  fetchPoeNinjaBuild,
} from "@/worker/build-decoder";

export const EXAMPLE_CODE = "https://poe.ninja/poe2/profile/krauthaufen-0194/character/wallensteinplatz";

export function ImportPanel() {
  const [input, setInput] = useState(() => {
    try { return localStorage.getItem("pob-import-code") || EXAMPLE_CODE; } catch { return EXAMPLE_CODE; }
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { setBuild, setImportCode, setOriginalImportCode, importCode: currentCode, originalImportCode, build } = useBuildStore();

  const doImport = useCallback((code: string) => {
    const xml = decodeBuildCode(code);
    const parsed = parseBuildXml(xml);
    setBuild(parsed);
    setImportCode(code);
    setOriginalImportCode(code);
  }, [setBuild, setImportCode, setOriginalImportCode]);

  const handleImport = useCallback(async () => {
    setError(null);

    // Check if it's a poe.ninja URL
    const ninjaUrl = parsePoeNinjaUrl(input);
    if (ninjaUrl) {
      setLoading(true);
      try {
        const code = await fetchPoeNinjaBuild(ninjaUrl.account, ninjaUrl.character);
        doImport(code);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch from poe.ninja");
      } finally {
        setLoading(false);
      }
      return;
    }

    // Otherwise treat as raw PoB code
    try {
      doImport(input);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to decode build");
    }
  }, [input, doImport]);

  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-poe-accent">
        Import Build
      </h2>
      <textarea
        className="w-full rounded border border-poe-border bg-poe-bg p-3 font-mono text-xs text-poe-text placeholder-gray-600 focus:border-poe-accent focus:outline-none"
        rows={4}
        placeholder="Paste PoB code or poe.ninja character URL..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleImport();
        }}
      />
      <div className="flex items-center gap-2">
        <button
          className="rounded bg-poe-accent px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
          onClick={handleImport}
          disabled={!input.trim() || loading}
        >
          {loading ? "Fetching..." : "Import"}
        </button>
        {build && originalImportCode && currentCode !== originalImportCode && (
          <button
            className="rounded border border-poe-border px-3 py-2 text-sm text-gray-400 transition hover:border-poe-accent hover:text-poe-text"
            onClick={() => { setInput(originalImportCode); doImport(originalImportCode); }}
          >
            Revert
          </button>
        )}
      </div>
      {build && (
        <p className="text-xs text-gray-400">
          {build.ascendancy || build.className} Lv{build.level} — {build.nodes.length} nodes
          {currentCode !== originalImportCode && (
            <span className="ml-1 text-yellow-400">(modified)</span>
          )}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
