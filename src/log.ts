// Thin wrapper so app logs are greppable in `adb logcat` (tag: strims/<scope>)
// separate from React Native's own noisy warnings.
export function makeLogger(scope: string) {
  const tag = `strims/${scope}`;
  return {
    info: (msg: string, extra?: unknown) =>
      extra !== undefined ? console.log(`[${tag}] ${msg}`, extra) : console.log(`[${tag}] ${msg}`),
    warn: (msg: string, extra?: unknown) =>
      extra !== undefined ? console.warn(`[${tag}] ${msg}`, extra) : console.warn(`[${tag}] ${msg}`),
  };
}
