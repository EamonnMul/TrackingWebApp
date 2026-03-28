"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.stravaImport = exports.stravaActivities = exports.stravaCallback = exports.stravaOAuth = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
const db = admin.firestore();
// ─── Config (set via functions/.env) ──────────────────────────────────────────
const CLIENT_ID = () => process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = () => process.env.STRAVA_CLIENT_SECRET;
const REDIRECT_URI = () => process.env.STRAVA_REDIRECT_URI;
const APP_URL = () => process.env.APP_URL;
// ─── Token helpers ────────────────────────────────────────────────────────────
async function getTokens(userId) {
    const snap = await db.doc(`users/${userId}/strava/tokens`).get();
    return snap.exists ? snap.data() : null;
}
async function saveTokens(userId, data) {
    const tokens = {
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
async function refreshTokens(userId, refreshToken) {
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
    if (!res.ok)
        throw new Error('token_refresh_failed');
    const data = await res.json();
    return saveTokens(userId, { ...data, athlete_name: '' }); // refresh doesn't return athlete
}
async function getValidTokens(userId) {
    const tokens = await getTokens(userId);
    if (!tokens)
        throw new Error('not_connected');
    // Refresh if within 5 minutes of expiry
    if (Date.now() / 1000 >= tokens.expires_at - 300) {
        return refreshTokens(userId, tokens.refresh_token);
    }
    return tokens;
}
// ─── Auth helper ──────────────────────────────────────────────────────────────
async function verifyAuth(req) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer '))
        throw new Error('unauthorized');
    const decoded = await admin.auth().verifyIdToken(auth.slice(7));
    return decoded.uid;
}
// ─── CORS helper ──────────────────────────────────────────────────────────────
function setCors(res, method = 'GET') {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', `${method}, OPTIONS`);
}
// ─── 1. Redirect to Strava OAuth ──────────────────────────────────────────────
exports.stravaOAuth = (0, https_1.onRequest)(async (req, res) => {
    const userId = req.query.userId;
    if (!userId) {
        res.status(400).send('Missing userId');
        return;
    }
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
exports.stravaCallback = (0, https_1.onRequest)(async (req, res) => {
    const code = req.query.code;
    const userId = req.query.state;
    const error = req.query.error;
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
        if (!tokenRes.ok)
            throw new Error('token_exchange_failed');
        const data = await tokenRes.json();
        await saveTokens(userId, data);
        res.redirect(`${APP_URL()}?stravaConnected=true`);
    }
    catch (e) {
        console.error('stravaCallback error:', e);
        res.redirect(`${APP_URL()}?stravaError=auth_failed`);
    }
});
// ─── 3. Fetch recent activities ───────────────────────────────────────────────
exports.stravaActivities = (0, https_1.onRequest)(async (req, res) => {
    setCors(res, 'GET');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const userId = await verifyAuth(req);
        let tokens;
        try {
            tokens = await getValidTokens(userId);
        }
        catch (e) {
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
        const activitiesRes = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=10', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
        if (activitiesRes.status === 429) {
            res.status(429).json({ error: 'rate_limit' });
            return;
        }
        if (activitiesRes.status === 401) {
            res.status(401).json({ error: 'not_connected' });
            return;
        }
        if (!activitiesRes.ok)
            throw new Error(`strava_error_${activitiesRes.status}`);
        const activities = await activitiesRes.json();
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
    }
    catch (e) {
        console.error('stravaActivities error:', e);
        res.status(500).json({ error: 'server_error' });
    }
});
// ─── 4. Import a Strava activity as a run ─────────────────────────────────────
exports.stravaImport = (0, https_1.onRequest)(async (req, res) => {
    setCors(res, 'POST');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        const userId = await verifyAuth(req);
        let tokens;
        try {
            tokens = await getValidTokens(userId);
        }
        catch {
            res.status(401).json({ error: 'not_connected' });
            return;
        }
        const { strava_id } = req.body;
        if (!strava_id) {
            res.status(400).json({ error: 'missing strava_id' });
            return;
        }
        // Check if already imported
        const existing = await db
            .collection(`users/${userId}/runs`)
            .where('stravaId', '==', String(strava_id))
            .get();
        if (!existing.empty) {
            res.status(409).json({ error: 'already_imported' });
            return;
        }
        // Fetch full activity from Strava for authoritative data
        const actRes = await fetch(`https://www.strava.com/api/v3/activities/${strava_id}`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
        if (actRes.status === 429) {
            res.status(429).json({ error: 'rate_limit' });
            return;
        }
        if (!actRes.ok)
            throw new Error(`strava_error_${actRes.status}`);
        const a = await actRes.json();
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
    }
    catch (e) {
        console.error('stravaImport error:', e);
        res.status(500).json({ error: 'server_error' });
    }
});
//# sourceMappingURL=index.js.map