/**
 * Path of Exile API client (proxied through /poe-api/).
 */

export interface PoeCharacterEntry {
  id: string;
  name: string;
  realm: string;
  class: string;
  league: string;
  level: number;
  experience: number;
}

export interface PoeCharacterDetail {
  id: string;
  name: string;
  realm: string;
  class: string;
  league: string;
  level: number;
  experience: number;
  passives: any;
  equipment: any[];
  jewels: any[];
  skills: any[];
  [key: string]: any;
}

async function apiFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`/poe-api/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

export async function fetchCharacterList(token: string): Promise<PoeCharacterEntry[]> {
  const data = await apiFetch<{ characters: PoeCharacterEntry[] }>("character/poe2", token);
  return data.characters || [];
}

export async function fetchCharacter(token: string, name: string): Promise<PoeCharacterDetail> {
  const data = await apiFetch<{ character: PoeCharacterDetail }>(`character/poe2/${encodeURIComponent(name)}`, token);
  return data.character;
}
