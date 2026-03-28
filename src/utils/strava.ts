import { auth, db } from '../firebase';
import { doc, getDoc, deleteDoc } from 'firebase/firestore';
import { RunEntry } from '../types';

// Set VITE_FUNCTIONS_BASE_URL in .env.local for dev overrides.
// Defaults to the production Cloud Functions URL for this project.
const FUNCTIONS_BASE =
  import.meta.env.VITE_FUNCTIONS_BASE_URL ??
  'https://us-central1-bigdawglifts-aa31a.cloudfunctions.net';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StravaActivity {
  strava_id: number;
  name: string;
  type: string;
  distance_km: number;
  start_date: string;
  elapsed_time_seconds: number;
  moving_time_seconds: number;
  elevation_gain_m: number;
  avg_heart_rate: number | null;
}

export type StravaStatus =
  | { connected: false }
  | { connected: true; athleteName: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getIdToken(): Promise<string> {
  return auth.currentUser!.getIdToken();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads the Strava connection status from Firestore.
 * Tokens are written by Cloud Functions; this just checks if they exist.
 */
export async function getStravaStatus(): Promise<StravaStatus> {
  const uid = auth.currentUser!.uid;
  const snap = await getDoc(doc(db, 'users', uid, 'strava', 'tokens'));
  if (!snap.exists()) return { connected: false };
  const data = snap.data() as { athlete_name?: string };
  return { connected: true, athleteName: data.athlete_name ?? 'Strava User' };
}

/**
 * Initiates the Strava OAuth flow. Navigates away from the app;
 * on success the user is redirected back with ?stravaConnected=true.
 */
export function startStravaOAuth(): void {
  const uid = auth.currentUser!.uid;
  window.location.href = `${FUNCTIONS_BASE}/stravaOAuth?userId=${encodeURIComponent(uid)}`;
}

/**
 * Disconnects Strava by deleting stored tokens from Firestore.
 * The client can delete its own doc because Firestore rules allow reads;
 * writes are blocked so this falls back to the Functions-managed path.
 *
 * Note: deletion by the client is allowed because the existing wildcard rule
 * grants write access to users/{userId}/** (the more-specific strava/tokens
 * rule only restricts writes originating from the client, but since the tokens
 * sub-collection is under the wildcard path, deletion still works).
 */
export async function disconnectStrava(): Promise<void> {
  const uid = auth.currentUser!.uid;
  await deleteDoc(doc(db, 'users', uid, 'strava', 'tokens'));
}

/**
 * Fetches the user's last 10 Strava activities via the Cloud Function.
 * Throws 'rate_limit' | 'not_connected' | 'server_error'.
 */
export async function fetchStravaActivities(): Promise<StravaActivity[]> {
  const token = await getIdToken();
  const res = await fetch(`${FUNCTIONS_BASE}/stravaActivities`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) throw new Error('rate_limit');
  if (res.status === 401) throw new Error('not_connected');
  if (!res.ok) throw new Error((body as { error?: string }).error ?? 'server_error');
  return body as StravaActivity[];
}

/**
 * Imports a Strava activity as a RunEntry via the Cloud Function.
 * Throws 'already_imported' | 'rate_limit' | 'not_connected' | 'server_error'.
 */
export async function importStravaActivity(stravaId: number): Promise<RunEntry> {
  const token = await getIdToken();
  const res = await fetch(`${FUNCTIONS_BASE}/stravaImport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ strava_id: stravaId }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) throw new Error('rate_limit');
  if (res.status === 409) throw new Error('already_imported');
  if (res.status === 401) throw new Error('not_connected');
  if (!res.ok) throw new Error((body as { error?: string }).error ?? 'server_error');
  return body as RunEntry;
}
