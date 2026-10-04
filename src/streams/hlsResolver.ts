// AngelThump's embed player (player.angelthump.com) resolves a channel to a
// playable HLS manifest via a two-step dance we found by reading its bundle
// (there's no public API docs for this): POST for a short-lived token, then
// GET the manifest with that token attached. Not exposed anywhere in
// chat-gui/Rustla2/the extension — they all just embed the iframe player,
// which is why this is worth documenting clearly here.
const VIGOR_BASE = 'https://vigor.angelthump.com';
// Sent by the official player bundle as the `Identifier` header on the token
// request — not a secret, just an API client identifier the token endpoint
// expects to be present.
const PLAYER_IDENTIFIER = 'SwnpX0RnA99YdRj0SPqs';

async function fetchAngelThumpToken(channel: string): Promise<string> {
  const res = await fetch(`${VIGOR_BASE}/${encodeURIComponent(channel)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Identifier: PLAYER_IDENTIFIER },
  });
  if (!res.ok) {
    throw new Error(`token request failed: ${res.status}`);
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

// The vigor.angelthump.com master manifest (obtained via the token dance
// above) doesn't send an Access-Control-Allow-Origin header. That's fine
// for us fetching it directly (native fetch, no CORS), but a Chromecast
// receiver is a webpage and its fetch of the cast URL IS subject to CORS —
// loading that URL as-is casts successfully (device connects, receiver
// shows up) but the video never actually plays, silently, since the
// browser-side fetch inside the receiver gets blocked with no error
// surfaced back to the sender app. Confirmed the per-edge-server manifest
// one hop down *does* send `Access-Control-Allow-Origin: *`, so we resolve
// past the blocked hop ourselves and hand the receiver the CORS-clean URL.
async function resolveEdgeManifestUrl(masterManifestUrl: string): Promise<string> {
  const res = await fetch(masterManifestUrl);
  if (!res.ok) {
    throw new Error(`master manifest request failed: ${res.status}`);
  }
  const text = await res.text();
  const edgeUrl = text
    .split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0 && !line.startsWith('#'));
  if (!edgeUrl) {
    throw new Error('no stream URL found in master manifest');
  }
  return edgeUrl;
}

// AngelThump replicates a live stream's HLS segments across several
// regional edge servers (same path, different hostname) — the manifest
// resolved above only ever hands back whichever one it's decided to route
// you to by default (observed: geographically-routed, e.g. sfo1 from the
// US), not a menu of options. There's no API that lists which regions a
// given stream is actually live on; this is the fixed set chat-gui/Rustla2
// users have been observed referencing for manual region selection.
export const ANGELTHUMP_REGIONS: { code: string; label: string }[] = [
  { code: 'sfo1', label: 'SFO' },
  { code: 'ams1', label: 'AMS' },
  { code: 'fra1', label: 'FRA' },
  { code: 'nyc1', label: 'NYC' },
  { code: 'sgp1', label: 'SGP' },
];

// What a user can pick for in-app playback: AngelThump's own routing, or a
// fixed region.
export const ANGELTHUMP_SERVER_CHOICES: { code: string | null; label: string }[] = [
  { code: null, label: 'Auto' },
  ...ANGELTHUMP_REGIONS,
];

// Any angelthump.com host: the master manifest now points at
// video-cdn.angelthump.com, which redirects nowhere but serves a playlist
// whose segment URLs are absolute and pinned to its own pick of region
// (sfo1 from the US), so swapping only a `sfo1`-style host never matched and
// region choice silently did nothing.
const REGION_HOST_RE = /^https:\/\/[a-z0-9-]+\.angelthump\.com\//;

// Swaps the server in an already-resolved manifest URL (e.g.
// `https://video-cdn.angelthump.com/hls/...` -> `https://ams1.angelthump.com/hls/...`).
// Each regional host serves the same playlist path with its own segment
// URLs (verified for sfo1/ams1/fra1), and answers playlist requests far
// faster than video-cdn (0.4s vs 3.8s observed). A region a stream isn't
// replicated to will just fail to load like any other bad URL would.
export function withAngelThumpRegion(edgeUrl: string, regionCode: string): string {
  return edgeUrl.replace(REGION_HOST_RE, `https://${regionCode}.angelthump.com/`);
}

// Resolves an AngelThump channel to its current playable, CORS-clean HLS
// manifest URL — safe to hand directly to a Chromecast receiver. Throws if
// the channel isn't actually live or any step of the resolution fails —
// callers should surface that as "can't cast this stream right now" rather
// than retry blindly, since a fresh token is cheap to fetch again on the
// next tap. `regionCode` (see ANGELTHUMP_REGIONS) overrides the edge server
// the default resolution would otherwise route to.
export async function resolveAngelThumpHls(channel: string, regionCode?: string): Promise<string> {
  const token = await fetchAngelThumpToken(channel);
  const masterManifestUrl = `${VIGOR_BASE}/hls/${encodeURIComponent(channel)}.m3u8?token=${token}`;
  const edgeUrl = await resolveEdgeManifestUrl(masterManifestUrl);
  return regionCode ? withAngelThumpRegion(edgeUrl, regionCode) : edgeUrl;
}
