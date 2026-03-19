import { create } from "zustand";
import type { PoeCharacterEntry } from "@/utils/poe-api";

interface AuthState {
  token: string | null;
  account: string | null;
  characters: PoeCharacterEntry[];
  loading: boolean;
  error: string | null;

  setToken: (token: string | null) => void;
  setAccount: (account: string | null) => void;
  setCharacters: (chars: PoeCharacterEntry[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  account: null,
  characters: [],
  loading: false,
  error: null,

  setToken: (token) => set({ token }),
  setAccount: (account) => set({ account }),
  setCharacters: (characters) => set({ characters }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  logout: () => set({ token: null, account: null, characters: [], error: null }),
}));
