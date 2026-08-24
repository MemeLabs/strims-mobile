// Drives looping (non-one-shot) animated emotes off a single shared timer
// per emote, rather than one independent setInterval per rendered instance.
//
// Without this, every on-screen copy of e.g. catJAM ran its own interval
// and local frameIndex — besides being wasteful (N timers for N copies of
// the same emote), each instance's timer could drift out of phase with the
// others, and a re-render of any one instance (messageFormat.ts builds a
// fresh `modifiers` array per render, which used to sit directly in an
// effect's dependency list) would reset *only that instance's* interval,
// producing visibly inconsistent playback — freezing, flickering on
// restart, everything except actually staying in sync. A single shared
// clock per emote sidesteps all of that: every subscriber just renders
// whatever frame the shared clock is currently on.
interface Clock {
  frameIndex: number;
  timer: ReturnType<typeof setInterval> | null;
  listeners: Set<(frameIndex: number) => void>;
}

const clocks = new Map<string, Clock>();

// Subscribes to the shared clock for `key`, creating it if this is the
// first subscriber and tearing it down once the last one unsubscribes.
// `onFrame` is called immediately with the clock's current position so a
// newly-mounted instance renders in sync right away, not one tick late.
export function subscribeToEmoteClock(
  key: string,
  frameCount: number,
  framesPerTick: number,
  tickMs: number,
  onFrame: (frameIndex: number) => void,
): () => void {
  let clock = clocks.get(key);
  if (!clock) {
    clock = { frameIndex: 0, timer: null, listeners: new Set() };
    clocks.set(key, clock);
  }
  const activeClock = clock;
  activeClock.listeners.add(onFrame);
  onFrame(activeClock.frameIndex);

  if (activeClock.timer === null) {
    activeClock.timer = setInterval(() => {
      activeClock.frameIndex = (activeClock.frameIndex + framesPerTick) % frameCount;
      activeClock.listeners.forEach(fn => fn(activeClock.frameIndex));
    }, tickMs);
  }

  return () => {
    activeClock.listeners.delete(onFrame);
    if (activeClock.listeners.size === 0 && activeClock.timer !== null) {
      clearInterval(activeClock.timer);
      // Dropped rather than kept idle — a later resubscribe just starts a
      // fresh clock from frame 0, which is simpler than reasoning about
      // resuming a stale phase and not worth the bookkeeping to avoid.
      clocks.delete(key);
    }
  };
}
