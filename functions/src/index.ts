import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

// ─── Config (set via functions/.env) ──────────────────────────────────────────
const CLIENT_ID = () => process.env.STRAVA_CLIENT_ID!;
const CLIENT_SECRET = () => process.env.STRAVA_CLIENT_SECRET!;
const REDIRECT_URI = () => process.env.STRAVA_REDIRECT_URI!;
const APP_URL = () => process.env.APP_URL!;

// ─── Types ────────────────────────────────────────────────────────────────────

interface StravaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  strava_athlete_id: number;
  athlete_name: string;
}

// ─── Token helpers ────────────────────────────────────────────────────────────

async function getTokens(userId: string): Promise<StravaTokens | null> {
  const snap = await db.doc(`users/${userId}/strava/tokens`).get();
  return snap.exists ? (snap.data() as StravaTokens) : null;
}

async function saveTokens(userId: string, data: StravaTokenDoc): Promise<StravaTokens> {
  const tokens: StravaTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    strava_athlete_id: data.athlete?.id ?? data.strava_athlete_id ?? 0,
    athlete_name: data.athlete
      ? `${data.athlete.firstname} ${data.athlete.lastname}`
      : (data.athlete_name ?? ''),
  };
  await db.doc(`users/${userId}/strava/tokens`).set(tokens);
  return tokens;
}

async function refreshTokens(userId: string, refreshToken: string): Promise<StravaTokens> {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error('token_refresh_failed');
  const data = await res.json() as StravaTokenDoc;
  return saveTokens(userId, { ...data, athlete_name: '' }); // refresh doesn't return athlete
}

async function getValidTokens(userId: string): Promise<StravaTokens> {
  const tokens = await getTokens(userId);
  if (!tokens) throw new Error('not_connected');
  // Refresh if within 5 minutes of expiry
  if (Date.now() / 1000 >= tokens.expires_at - 300) {
    return refreshTokens(userId, tokens.refresh_token);
  }
  return tokens;
}

// Loose shape for Strava token endpoint responses
interface StravaTokenDoc {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname: string; lastname: string };
  strava_athlete_id?: number;
  athlete_name?: string;
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function verifyAuth(req: { headers: { authorization?: string } }): Promise<string> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) throw new Error('unauthorized');
  const decoded = await admin.auth().verifyIdToken(auth.slice(7));
  return decoded.uid;
}

// ─── CORS helper ──────────────────────────────────────────────────────────────

function setCors(res: { set: (k: string, v: string) => void }, method = 'GET') {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', `${method}, OPTIONS`);
}

// ─── 1. Redirect to Strava OAuth ──────────────────────────────────────────────

export const stravaOAuth = onRequest(async (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) { res.status(400).send('Missing userId'); return; }

  const params = new URLSearchParams({
    client_id: CLIENT_ID(),
    redirect_uri: REDIRECT_URI(),
    response_type: 'code',
    scope: 'activity:read_all',
    state: userId,
  });

  res.redirect(`https://www.strava.com/oauth/authorize?${params}`);
});

// ─── 2. OAuth callback ────────────────────────────────────────────────────────

export const stravaCallback = onRequest(async (req, res) => {
  const code = req.query.code as string;
  const userId = req.query.state as string;
  const error = req.query.error as string;

  if (error || !code || !userId) {
    res.redirect(`${APP_URL()}?stravaError=cancelled`);
    return;
  }

  try {
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID(),
        client_secret: CLIENT_SECRET(),
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) throw new Error('token_exchange_failed');
    const data = await tokenRes.json() as StravaTokenDoc;
    await saveTokens(userId, data);

    res.redirect(`${APP_URL()}?stravaConnected=true`);
  } catch (e) {
    console.error('stravaCallback error:', e);
    res.redirect(`${APP_URL()}?stravaError=auth_failed`);
  }
});

// ─── 3. Fetch recent activities ───────────────────────────────────────────────

export const stravaActivities = onRequest(async (req, res) => {
  setCors(res, 'GET');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    const userId = await verifyAuth(req);
    let tokens: StravaTokens;
    try {
      tokens = await getValidTokens(userId);
    } catch (e: unknown) {
      if (e instanceof Error && (e.message === 'not_connected' || e.message === 'token_refresh_failed')) {
        // Clear stale tokens so the client can prompt reconnect
        if (e.message === 'token_refresh_failed') {
          await db.doc(`users/${userId}/strava/tokens`).delete().catch(() => null);
        }
        res.status(401).json({ error: 'not_connected' });
        return;
      }
      throw e;
    }

    const activitiesRes = await fetch(
      'https://www.strava.com/api/v3/athlete/activities?per_page=10',
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );

    if (activitiesRes.status === 429) { res.status(429).json({ error: 'rate_limit' }); return; }
    if (activitiesRes.status === 401) { res.status(401).json({ error: 'not_connected' }); return; }
    if (!activitiesRes.ok) throw new Error(`strava_error_${activitiesRes.status}`);

    const activities = await activitiesRes.json() as StravaRawActivity[];

    const result = activities.map(a => ({
      strava_id: a.id,
      name: a.name,
      type: a.type,
      distance_km: +(a.distance / 1000).toFixed(2),
      start_date: a.start_date,
      elapsed_time_seconds: a.elapsed_time,
      moving_time_seconds: a.moving_time,
      elevation_gain_m: Math.round(a.total_elevation_gain ?? 0),
      avg_heart_rate: a.average_heartrate ?? null,
    }));

    res.json(result);
  } catch (e) {
    console.error('stravaActivities error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── 4. Import a Strava activity as a run ─────────────────────────────────────

export const stravaImport = onRequest(async (req, res) => {
  setCors(res, 'POST');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  try {
    const userId = await verifyAuth(req);
    let tokens: StravaTokens;
    try {
      tokens = await getValidTokens(userId);
    } catch {
      res.status(401).json({ error: 'not_connected' });
      return;
    }

    const { strava_id } = req.body as { strava_id: number };
    if (!strava_id) { res.status(400).json({ error: 'missing strava_id' }); return; }

    // Check if already imported
    const existing = await db
      .collection(`users/${userId}/runs`)
      .where('stravaId', '==', String(strava_id))
      .get();
    if (!existing.empty) { res.status(409).json({ error: 'already_imported' }); return; }

    // Fetch full activity from Strava for authoritative data
    const actRes = await fetch(
      `https://www.strava.com/api/v3/activities/${strava_id}`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );

    if (actRes.status === 429) { res.status(429).json({ error: 'rate_limit' }); return; }
    if (!actRes.ok) throw new Error(`strava_error_${actRes.status}`);

    const a = await actRes.json() as StravaRawActivity;

    const run = {
      id: `strava_${a.id}`,
      date: a.start_date.split('T')[0],
      distanceKm: +(a.distance / 1000).toFixed(2),
      source: 'strava',
      stravaId: String(a.id),
      movingTimeSecs: a.moving_time ?? null,
      elevationGainM: Math.round(a.total_elevation_gain ?? 0),
      avgHeartRate: a.average_heartrate ?? null,
    };

    await db.doc(`users/${userId}/runs/${run.id}`).set(run);
    res.json(run);
  } catch (e) {
    console.error('stravaImport error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ─── Strava API shape (partial) ───────────────────────────────────────────────

interface StravaRawActivity {
  id: number;
  name: string;
  type: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  start_date: string;
  average_heartrate?: number;
}
