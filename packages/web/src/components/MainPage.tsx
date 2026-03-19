import { useState, useCallback, useEffect } from "react";
import { useAuthStore } from "@/store/auth-store";
import { useBuildStore } from "@/store/build-store";
import {
  decodeBuildCode,
  parseBuildXml,
  parsePoeNinjaUrl,
  fetchPoeNinjaBuild,
} from "@/worker/build-decoder";
import { startLogin, handleCallback, getToken, isLoggedIn, logout } from "@/utils/poe-auth";
import { fetchCharacterList, type PoeCharacterEntry } from "@/utils/poe-api";
import type { CalcClient } from "@/worker/calc-client";

const SPRITE_ATLAS = "/data/sprites/ascendancy-background_250_250_BC7.png";

interface SpriteInfo { x: number; y: number; w: number; h: number }

/** Resolve API class string (e.g. "Mercenary3") to display name and sprite key. */
function useClassInfo() {
  const [atlas, setAtlas] = useState<Record<string, SpriteInfo> | null>(null);
  const [classMap, setClassMap] = useState<Record<string, { displayName: string; baseClass: string }>>({});

  useEffect(() => {
    // Load sprite atlas metadata
    fetch("/data/sprites/ascendancy-background_250_250_BC7.json")
      .then((r) => r.json())
      .then((data) => setAtlas(data.sprites))
      .catch(() => {});

    // Load tree.json to build internalId → displayName map
    fetch("/data/tree.json")
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, { displayName: string; baseClass: string }> = {};
        for (const cls of data.classes ?? []) {
          // Base class maps to itself
          map[cls.name] = { displayName: cls.name, baseClass: cls.name };
          for (const asc of cls.ascendancies ?? []) {
            const intId = asc.internalId ?? asc.id;
            map[intId] = { displayName: asc.name, baseClass: cls.name };
            // Also map the display name to itself (in case API returns that)
            map[asc.name] = { displayName: asc.name, baseClass: cls.name };
          }
        }
        setClassMap(map);
      })
      .catch(() => {});
  }, []);

  return { atlas, classMap };
}

function ClassSprite({ apiClass, classMap, atlas, size = 36 }: {
  apiClass: string;
  classMap: Record<string, { displayName: string; baseClass: string }>;
  atlas: Record<string, SpriteInfo> | null;
  size?: number;
}) {
  const info = classMap[apiClass];
  const spriteName = info ? `Classes${info.displayName}` : `Classes${apiClass}`;
  const sprite = atlas?.[spriteName];

  if (!sprite) {
    return <div className="shrink-0 rounded-full bg-poe-border" style={{ width: size, height: size }} />;
  }

  const scale = size / sprite.w;
  return (
    <div
      className="shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${SPRITE_ATLAS})`,
        backgroundPosition: `-${sprite.x * scale}px -${sprite.y * scale}px`,
        backgroundSize: `${1500 * scale}px ${1500 * scale}px`,
      }}
    />
  );
}

interface MainPageProps {
  calcClient: CalcClient | null;
  engineStatus: string;
}

export function MainPage({ calcClient, engineStatus }: MainPageProps) {
  const { token, account, characters, loading, error, setToken, setAccount, setCharacters, setLoading, setError, logout: authLogout } = useAuthStore();
  const { setBuild, setImportCode, setOriginalImportCode } = useBuildStore();
  const { atlas, classMap } = useClassInfo();

  const [importInput, setImportInput] = useState(() => {
    try { return localStorage.getItem("pob-import-code") || ""; } catch { return ""; }
  });
  const [importError, setImportError] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [charLoading, setCharLoading] = useState<string | null>(null);

  // Handle OAuth callback on mount
  useEffect(() => {
    (async () => {
      try {
        const result = await handleCallback();
        if (result) {
          setToken(result.token);
          if (result.account) setAccount(result.account);
          // Fetch characters
          setLoading(true);
          try {
            const chars = await fetchCharacterList(result.token);
            setCharacters(chars);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to fetch characters");
          } finally {
            setLoading(false);
          }
          return;
        }
      } catch (e) {
        console.error("OAuth callback error:", e);
      }

      // Check for existing token
      if (isLoggedIn()) {
        try {
          const t = await getToken();
          if (t) {
            setToken(t);
            setLoading(true);
            try {
              const chars = await fetchCharacterList(t);
              setCharacters(chars);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed to fetch characters");
            } finally {
              setLoading(false);
            }
          }
        } catch {
          // Token expired/invalid
        }
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doImport = useCallback((code: string) => {
    const xml = decodeBuildCode(code);
    const parsed = parseBuildXml(xml);
    setBuild(parsed);
    setImportCode(code);
    setOriginalImportCode(code);
  }, [setBuild, setImportCode, setOriginalImportCode]);

  const handleImport = useCallback(async () => {
    setImportError(null);
    const input = importInput.trim();
    if (!input) return;

    const ninjaUrl = parsePoeNinjaUrl(input);
    if (ninjaUrl) {
      setImportLoading(true);
      try {
        const code = await fetchPoeNinjaBuild(ninjaUrl.account, ninjaUrl.character);
        doImport(code);
      } catch (e) {
        setImportError(e instanceof Error ? e.message : "Failed to fetch from poe.ninja");
      } finally {
        setImportLoading(false);
      }
      return;
    }

    try {
      doImport(input);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Failed to decode build");
    }
  }, [importInput, doImport]);

  const handleCharacterImport = useCallback(async (char: PoeCharacterEntry) => {
    if (!calcClient || !token) return;
    setCharLoading(char.name);
    setImportError(null);

    try {
      // Fetch full character data from PoE API
      const { fetchCharacter } = await import("@/utils/poe-api");
      const charDetail = await fetchCharacter(token, char.name);

      // Send to Lua worker for import
      const result = await calcClient.importCharacter(JSON.stringify(charDetail));
      if (result.error) {
        setImportError(`Import failed: ${result.error}`);
        setCharLoading(null);
        return;
      }

      // The worker returns raw XML — encode it and feed through normal pipeline
      const { encodeBuildCode } = await import("@/worker/build-decoder");
      const code = encodeBuildCode(result.code);
      doImport(code);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Character import failed");
    } finally {
      setCharLoading(null);
    }
  }, [calcClient, token, doImport]);

  const handleLogout = useCallback(() => {
    logout();
    authLogout();
  }, [authLogout]);

  // Group characters by league
  const charsByLeague = characters.reduce<Record<string, PoeCharacterEntry[]>>((acc, char) => {
    (acc[char.league] ??= []).push(char);
    return acc;
  }, {});

  const engineReady = engineStatus === "ready";

  return (
    <div className="flex h-[100dvh] w-screen items-center justify-center bg-poe-bg p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-poe-accent">PoB Web</h1>
          <p className="mt-1 text-sm text-gray-500">Path of Building for PoE2 — in the browser</p>
        </div>

        {/* Character List (logged in) */}
        {token && (
          <div className="mb-6 rounded border border-poe-border bg-poe-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-gray-400">
                {account ? <>{account}</> : "Logged in"}
              </span>
              <button
                className="text-xs text-gray-500 hover:text-gray-300"
                onClick={handleLogout}
              >
                Logout
              </button>
            </div>

            {loading ? (
              <div className="py-4 text-center text-sm text-gray-500">Loading characters...</div>
            ) : characters.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-500">No characters found</div>
            ) : (
              <div className="max-h-80 space-y-3 overflow-y-auto">
                {Object.entries(charsByLeague).map(([league, chars]) => (
                  <div key={league}>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">{league}</div>
                    <div className="space-y-1">
                      {chars.sort((a, b) => b.level - a.level).map((char) => {
                        const info = classMap[char.class];
                        const displayClass = info?.displayName ?? char.class;
                        const baseClass = info?.baseClass;
                        const isAscended = baseClass && displayClass !== baseClass;
                        return (
                          <button
                            key={char.id}
                            className="flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm transition hover:bg-poe-bg disabled:opacity-50"
                            onClick={() => handleCharacterImport(char)}
                            disabled={!engineReady || !!charLoading}
                          >
                            <ClassSprite apiClass={char.class} classMap={classMap} atlas={atlas} size={36} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium text-poe-text">{char.name}</div>
                              <div className="truncate text-xs text-gray-500">
                                {isAscended ? (
                                  <>{displayClass} <span className="text-gray-600">({baseClass})</span></>
                                ) : displayClass}
                              </div>
                            </div>
                            <span className="shrink-0 text-xs text-gray-500">
                              {charLoading === char.name ? "Importing..." : `Lv ${char.level}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Login button (not logged in) */}
        {!token && (
          <div className="mb-6">
            <button
              className="w-full rounded bg-poe-accent px-4 py-3 text-sm font-medium text-white transition hover:brightness-110"
              onClick={startLogin}
            >
              Login with Path of Exile
            </button>
          </div>
        )}

        {/* Manual import */}
        <div className="rounded border border-poe-border bg-poe-panel p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Import Build
          </h2>
          <textarea
            className="w-full rounded border border-poe-border bg-poe-bg p-3 font-mono text-xs text-poe-text placeholder-gray-600 focus:border-poe-accent focus:outline-none"
            rows={3}
            placeholder="Paste PoB code or poe.ninja character URL..."
            value={importInput}
            onChange={(e) => setImportInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleImport();
            }}
          />
          <button
            className="mt-2 w-full rounded bg-poe-accent/80 px-4 py-2 text-sm font-medium text-white transition hover:bg-poe-accent disabled:opacity-50"
            onClick={handleImport}
            disabled={!importInput.trim() || importLoading}
          >
            {importLoading ? "Fetching..." : "Import"}
          </button>
        </div>

        {/* Error display */}
        {(importError || error) && (
          <p className="mt-3 text-center text-xs text-red-400">{importError || error}</p>
        )}

        {/* Engine status */}
        {engineStatus === "loading" && (
          <p className="mt-3 text-center text-xs text-yellow-400">Engine booting...</p>
        )}

        {/* GGG disclaimer */}
        <p className="mt-6 text-center text-[10px] text-gray-700">
          Not affiliated with or endorsed by Grinding Gear Games
        </p>
      </div>
    </div>
  );
}
