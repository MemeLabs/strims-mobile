export interface Frame {
  event: string;
  data: unknown;
}

// Shared with ChatSource — the golang sgg service frames every message
// (live and history) the same way: `EVENTNAME {json payload}`.
export function parseFrame(raw: string): Frame {
  const spaceIdx = raw.indexOf(' ');
  const event = (spaceIdx === -1 ? raw : raw.slice(0, spaceIdx)).toUpperCase();
  const payload = spaceIdx === -1 ? '' : raw.slice(spaceIdx + 1);

  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    data = payload;
  }
  return { event, data };
}
