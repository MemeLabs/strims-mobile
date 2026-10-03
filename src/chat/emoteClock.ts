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
  framesPerTick: number;
  frameCount: number;
  tickMs: number;
  nextTickAt: number;
  listeners: Set<(frameIndex: number) => void>;
}

const clocks = new Map<string, Clock>();

// Every clock advances off ONE shared interval rather than one interval per
// emote. Each separate timer callback produced its own React commit, and
// each commit re-clones the whole chat tree — with ~10 distinct animated
// emotes on screen that was hundreds of full commits a second and a pegged
// JS thread. One callback means React batches every frame change into a
// single commit per tick.
const BASE_TICK_MS = 40;
let ticker: ReturnType<typeof setInterval> | null = null;

// Global gate: chat stays mounted while hidden (other tab, settings) and
// while backgrounded; App.tsx flips this from AppState + visible screen so
// nothing ticks off-screen.
let animationsActive = true;
const activeListeners = new Set<(active: boolean) => void>();

function tick() {
  const now = Date.now();
  clocks.forEach(clock => {
    if (now < clock.nextTickAt) {
      return;
    }
    // Catch up on missed ticks without replaying them one by one.
    const ticks = Math.floor((now - clock.nextTickAt) / clock.tickMs) + 1;
    clock.nextTickAt += ticks * clock.tickMs;
    clock.frameIndex = (clock.frameIndex + ticks * clock.framesPerTick) % clock.frameCount;
    clock.listeners.forEach(fn => fn(clock.frameIndex));
  });
}

function syncTicker() {
  const shouldRun = animationsActive && clocks.size > 0;
  if (shouldRun && ticker === null) {
    const now = Date.now();
    clocks.forEach(clock => {
      clock.nextTickAt = now + clock.tickMs;
    });
    ticker = setInterval(tick, BASE_TICK_MS);
  } else if (!shouldRun && ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}

export function setEmoteAnimationsActive(active: boolean) {
  if (active === animationsActive) {
    return;
  }
  animationsActive = active;
  syncTicker();
  activeListeners.forEach(fn => fn(active));
}

export function getEmoteAnimationsActive(): boolean {
  return animationsActive;
}

export function subscribeToEmoteAnimationsActive(fn: (active: boolean) => void): () => void {
  activeListeners.add(fn);
  return () => {
    activeListeners.delete(fn);
  };
}

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
    clock = { frameIndex: 0, framesPerTick, frameCount, tickMs, nextTickAt: Date.now() + tickMs, listeners: new Set() };
    clocks.set(key, clock);
  }
  const activeClock = clock;
  activeClock.listeners.add(onFrame);
  onFrame(activeClock.frameIndex);
  syncTicker();

  return () => {
    activeClock.listeners.delete(onFrame);
    if (activeClock.listeners.size === 0) {
      clocks.delete(key);
      syncTicker();
      // Dropped rather than kept idle — a later resubscribe just starts a
      // fresh clock from frame 0, which is simpler than reasoning about
      // resuming a stale phase and not worth the bookkeeping to avoid.
    }
  };
}
