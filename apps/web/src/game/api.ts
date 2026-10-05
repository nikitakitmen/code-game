/**
 * Thin API client. Progress persists locally first (localStorage) and syncs to the
 * backend when reachable, so the game is fully playable offline / without an account.
 */
import type { GameState } from '@prod/engine';

const BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000/api/v1';
const GUEST_KEY = 'prod.guestToken';
const AUTH_KEY = 'prod.authToken';

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function getAuthToken(): string | null {
  return readLS(AUTH_KEY);
}
export function getGuestToken(): string | null {
  return readLS(GUEST_KEY);
}
export function setAuthToken(t: string | null) {
  writeLS(AUTH_KEY, t);
}
export function setGuestToken(t: string | null) {
  writeLS(GUEST_KEY, t);
}

function headers(json = true): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const auth = getAuthToken();
  const guest = getGuestToken();
  if (auth) h['Authorization'] = `Bearer ${auth}`;
  else if (guest) h['X-Guest-Token'] = guest;
  return h;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`${res.status} ${path}`) as Error & { status: number; body: string };
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return (await res.json()) as T;
}

export const api = {
  online: true,
  async health(): Promise<boolean> {
    try {
      await fetch(`${BASE.replace('/v1', '')}/health`, { method: 'GET' });
      return true;
    } catch {
      return false;
    }
  },
  async ensureGuest(): Promise<string | null> {
    if (getAuthToken() || getGuestToken()) return getGuestToken();
    try {
      const r = await req<{ guest_token: string }>('POST', '/guest');
      setGuestToken(r.guest_token);
      return r.guest_token;
    } catch {
      return null;
    }
  },
  async register(email: string, password: string, locale: string) {
    const r = await req<{ token: string }>('POST', '/auth/register', { email, password, locale, guest_token: getGuestToken() });
    setAuthToken(r.token);
    setGuestToken(null);
    return r;
  },
  async login(email: string, password: string) {
    const r = await req<{ token: string; guest_conflict: boolean }>('POST', '/auth/login', { email, password, guest_token: getGuestToken() });
    setAuthToken(r.token);
    if (!r.guest_conflict) setGuestToken(null);
    return r;
  },
  async logout() {
    try {
      await req('POST', '/auth/logout');
    } catch {
      /* ignore */
    }
    setAuthToken(null);
  },
  async mergeGuest(strategy: 'keep_account' | 'use_guest') {
    const guest = getGuestToken();
    if (!guest) return;
    await req('POST', '/profile/merge-guest', { guest_token: guest, strategy });
    setGuestToken(null);
  },
  async loadSave(): Promise<{ state: GameState; revision: number } | null> {
    try {
      const r = await req<{ save: { state: GameState; revision: number } | null }>('GET', '/save');
      return r.save ? { state: r.save.state, revision: r.save.revision } : null;
    } catch {
      return null;
    }
  },
  async putSave(state: GameState, revision: number): Promise<{ revision: number } | 'conflict' | null> {
    try {
      const r = await req<{ save: { revision: number } }>('PUT', '/save', {
        schema_version: state.schemaVersion,
        seed: state.seed,
        state,
        base_revision: revision,
        company_name: state.company.name || null,
        current_mission_id: state.campaign.currentMissionId,
      });
      return { revision: r.save.revision };
    } catch (e) {
      if ((e as { status?: number }).status === 409) return 'conflict';
      return null;
    }
  },
  async saveCheckpoint(state: GameState, type: string, label: string, missionId: string | null) {
    try {
      await req('POST', '/checkpoints', { schema_version: state.schemaVersion, seed: state.seed, state, checkpoint_type: type, label, mission_id: missionId });
    } catch {
      /* ignore */
    }
  },
  async putKnowledge(progress: { id: string; state: string; score: number }[]) {
    try {
      await req('PUT', '/knowledge/progress', { progress });
    } catch {
      /* ignore */
    }
  },
  async unlockAchievements(ids: string[]) {
    if (!ids.length) return;
    try {
      await req('POST', '/achievements/unlocks', { ids });
    } catch {
      /* ignore */
    }
  },
  isAuthed(): boolean {
    return !!getAuthToken();
  },
};
