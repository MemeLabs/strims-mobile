import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChat } from '../chat/useChat';
import { getEmoteIndexUpdatedAt, loadEmoteIndex, type EmoteInfo } from '../chat/emotes';
import { formatMessage, isGreenText, isMention } from '../chat/messageFormat';
import { viewerChannelColor } from '../chat/viewerColor';
import { applyCompletion, buildSuggestions, findWordAtCursor, type Suggestion } from '../chat/autocomplete';
import { groupCombos, type DisplayItem } from '../chat/combo';
import { staticTransforms, useSpinRotation } from '../chat/emoteModifiers';
import {
  hasSeenNickColorTooltip,
  loadNickColors,
  markNickColorTooltipSeen,
  setNickColor,
} from '../chat/nickColors';
import AnimatedEmote from '../components/AnimatedEmote';
import { loadEmoteUsageCounts, recordEmoteUsage } from '../chat/emoteUsage';
import { makeLogger } from '../log';
import type { ChatMessage, ViewerChannel } from '../chat/types';

const log = makeLogger('chat-screen');

interface Props {
  jwt: string;
  // Bumped by Settings' "Refresh emotes" button (see App.tsx) — the emote
  // index has no automatic expiry (see emotes.ts), so this is the only
  // thing that ever tells this screen to re-fetch it after the initial
  // mount.
  emoteRefreshKey: number;
}

// Some emotes are 80px+ tall at native size. Rendered inline at that size,
// Android's Text layout distorts the whole line's metrics (and, transitively,
// the sibling viewer-bar's alignment) rather than just growing that one
// line — capping to roughly text-line height avoids the whole class of bug.
const MAX_INLINE_EMOTE_HEIGHT = 22;
// Matches the old suggestionEmote style's fixed size.
const SUGGESTION_EMOTE_SIZE = 20;

function capEmoteSize(emote: EmoteInfo): { width: number; height: number } {
  if (emote.height <= MAX_INLINE_EMOTE_HEIGHT) {
    return { width: emote.width, height: emote.height };
  }
  const scale = MAX_INLINE_EMOTE_HEIGHT / emote.height;
  return { width: Math.round(emote.width * scale), height: MAX_INLINE_EMOTE_HEIGHT };
}

// Non-animated emotes with a modifier (e.g. `PepoG:mirror`) — a plain
// <Image> can't drive the `:spin` rotation loop (needs its own Animated
// hook instance per emote), so this gets its own tiny component rather than
// inlining into MessageRow's segments.map.
function StaticEmote({
  emote,
  width,
  height,
  modifiers,
  accessibilityLabel,
}: {
  emote: EmoteInfo;
  width: number;
  height: number;
  modifiers: string[];
  accessibilityLabel: string;
}) {
  const spinRotate = useSpinRotation(modifiers);
  const transform = [...staticTransforms(modifiers), ...(spinRotate ? [{ rotate: spinRotate }] : [])];
  return (
    <Animated.Image
      source={{ uri: emote.uri }}
      // Inline images baseline-align by default (their bottom sits on the
      // text baseline), which pushes the top of any emote taller than the
      // text upward past the line — this is chat-gui's `margin-top: -Npx`
      // hack, done the RN way.
      style={[{ width, height, verticalAlign: 'middle' }, transform.length ? { transform } : null] as never}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

interface MessageRowProps {
  item: ChatMessage;
  emotes: Map<string, EmoteInfo>;
  viewerStates: Map<string, { nick: string; channel: ViewerChannel | null }>;
  continued: boolean;
  selfNick: string | null;
  nickColors: Map<string, string>;
  onPressNick: (nick: string) => void;
  onLongPressNick: (nick: string) => void;
  focusedNick: string | null;
}

function MessageRow({
  item,
  emotes,
  viewerStates,
  continued,
  selfNick,
  nickColors,
  onPressNick,
  onLongPressNick,
  focusedNick,
}: MessageRowProps) {
  const green = isGreenText(item.data);
  const mentioned = isMention(item.data, item.nick, selfNick);
  const segments = formatMessage(item.data, emotes);
  const customNickColor = nickColors.get(item.nick.toLowerCase());
  const dimmed = focusedNick !== null && item.nick.toLowerCase() !== focusedNick;
  // Colored bar next to the nick shows what stream they're watching — same
  // deterministic per-channel color scheme as chat-gui's "bar" indicator
  // style, so it's consistent with the web/extension clients. Rendered as
  // an inline block-drawing character colored via `color` (see viewerBar
  // style below) rather than a flexbox sibling View — a sibling can't track
  // just the nick's line when a large emote elsewhere in the paragraph
  // inflates the row, and border props on nested inline Text don't render
  // on Android at all, so it has to live inside the text flow itself.
  const barColor = viewerChannelColor(viewerStates.get(item.nick.toLowerCase())?.channel);
  return (
    <View
      style={[
        styles.messageRow,
        continued && styles.messageRowContinued,
        mentioned && styles.messageRowHighlight,
        dimmed && styles.messageRowDimmed,
      ]}
    >
      <Text style={[styles.messageText, green && styles.greenText]}>
        {continued ? (
          <Text style={styles.continueMarker}>› </Text>
        ) : (
          <>
            {/* borderLeftWidth/Color on a nested inline Text span doesn't
                render on Android — a block-drawing character colored via
                the (universally-supported) `color` style is the reliable
                cross-platform way to get a "bar" glyph inline with text. */}
            <Text style={[styles.viewerBar, { color: barColor }]}>{'▎'}</Text>
            <Text
              style={[styles.nick, customNickColor ? { color: customNickColor } : null]}
              onPress={() => onPressNick(item.nick)}
              onLongPress={() => onLongPressNick(item.nick)}
              suppressHighlighting
            >
              {item.nick}
            </Text>
          </>
        )}
        {!continued && <Text>: </Text>}
        {segments.map((seg, i) => {
          if (seg.type === 'emote') {
            const { width, height } = capEmoteSize(seg.emote);
            if (seg.emote.animation) {
              // AnimatedEmote cycles real cropped per-frame image files
              // (see emoteFrames.ts) via a plain <Image>'s `source` prop —
              // no wrapping View or transform, so unlike the earlier
              // clip-and-transform approach, this renders correctly inline.
              return (
                <AnimatedEmote
                  key={i}
                  emote={seg.emote}
                  width={width}
                  height={height}
                  accessibilityLabel={seg.name}
                  modifiers={seg.modifiers}
                />
              );
            }
            return (
              <StaticEmote
                key={i}
                emote={seg.emote}
                width={width}
                height={height}
                modifiers={seg.modifiers}
                accessibilityLabel={seg.name}
              />
            );
          }
          if (seg.type === 'link') {
            return (
              <Text key={i} style={styles.link} onPress={() => Linking.openURL(seg.url)}>
                {seg.display}
              </Text>
            );
          }
          return <Text key={i}>{seg.value}</Text>;
        })}
      </Text>
    </View>
  );
}

// chat-gui's ChatEmoteMessage: no nick/attribution, just the emote (larger
// than inline size) and an "N X C-C-C-COMBO" counter — collapsing the noise
// of many people spamming the same emote into one line.
const COMBO_EMOTE_HEIGHT = 36;

function ComboRow({ emoteName, count, emotes }: { emoteName: string; count: number; emotes: Map<string, EmoteInfo> }) {
  const emote = emotes.get(emoteName);
  if (!emote) {
    return null;
  }
  // Scale from the emote's own aspect ratio to a fixed target height —
  // scaling the *raw* native size by a flat multiplier (the previous
  // approach) let large or non-square emotes render distorted/oversized,
  // since native dimensions vary a lot (some are 84px tall, others fall
  // back to a 28px default with an assumed 1:1 aspect that isn't real).
  const width = Math.round((emote.width / emote.height) * COMBO_EMOTE_HEIGHT);
  return (
    <View style={[styles.messageRow, styles.comboRow]}>
      {emote.animation ? (
        <AnimatedEmote emote={emote} width={width} height={COMBO_EMOTE_HEIGHT} accessibilityLabel={emoteName} />
      ) : (
        <Image source={{ uri: emote.uri }} style={{ width, height: COMBO_EMOTE_HEIGHT }} accessibilityLabel={emoteName} />
      )}
      <Text style={styles.comboCount}>
        {count} X <Text style={styles.comboFlair}>C-C-C-COMBO</Text>
      </Text>
    </View>
  );
}

// Reconnects are frequent and usually resolve within a couple seconds
// (short-retry backoff, see source.ts) — flashing a banner for every single
// blip once we already have chat history on screen is just noise. Only a
// disconnect that's failed to recover for this long is worth calling out.
const LONG_DISCONNECT_MS = 60000;

export default function ChatScreen({ jwt, emoteRefreshKey }: Props) {
  const { messages, me, status, sendMessage, catchUpCount, viewerStates } = useChat(jwt);
  const [longDisconnected, setLongDisconnected] = useState(false);
  const [draft, setDraft] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [emotes, setEmotes] = useState<Map<string, EmoteInfo>>(new Map());
  const [nickColors, setNickColors] = useState<Map<string, string>>(new Map());
  const [colorPickerNick, setColorPickerNick] = useState<string | null>(null);
  const [emotePickerVisible, setEmotePickerVisible] = useState(false);
  const [emoteUsageCounts, setEmoteUsageCounts] = useState<Map<string, number>>(new Map());
  const [focusedNick, setFocusedNick] = useState<string | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const tooltipSeenRef = useRef(true); // assume seen until we know otherwise, to avoid a flash
  // Shown once, only on a genuinely fresh install (no persisted emote index
  // yet — see getEmoteIndexUpdatedAt) — the first connect is meaningfully
  // slower than every one after it, since there's no cached emote index to
  // fall back on while chat-gui's full emotes.<hash>.css gets fetched and
  // parsed from scratch. Cleared for good the first time catch-up actually
  // finishes (messages.length > 0 below), never shown again after that.
  const [firstTimeSetupVisible, setFirstTimeSetupVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (status !== 'closed') {
      setLongDisconnected(false);
      return;
    }
    const timer = setTimeout(() => setLongDisconnected(true), LONG_DISCONNECT_MS);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    getEmoteIndexUpdatedAt().then(updatedAt => {
      if (updatedAt === null) {
        setFirstTimeSetupVisible(true);
      }
    });
    loadEmoteIndex().then(setEmotes);
    // emoteRefreshKey has no effect the first time this runs (mount) —
    // it's only here so a later bump (Settings → Refresh emotes, see
    // App.tsx) makes this effect re-run and pick up the freshly-refreshed
    // index that loadEmoteIndex() now returns.
  }, [emoteRefreshKey]);

  useEffect(() => {
    if (messages.length > 0) {
      setFirstTimeSetupVisible(false);
    }
  }, [messages.length]);

  useEffect(() => {
    loadEmoteUsageCounts().then(setEmoteUsageCounts);
  }, []);

  useEffect(() => {
    loadNickColors().then(setNickColors);
    // TEMP: force the tooltip to retrigger on every launch for visual
    // review — revert to `hasSeenNickColorTooltip().then(seen => {...})`
    // once confirmed.
    tooltipSeenRef.current = false;
  }, []);

  // Click toggles "focus" on that nick — dims every other message until the
  // same nick is clicked again to clear it.
  const onPressNick = (nick: string) => {
    const key = nick.toLowerCase();
    setFocusedNick(prev => (prev === key ? null : key));
  };

  const onLongPressNick = (nick: string) => {
    if (!tooltipSeenRef.current) {
      tooltipSeenRef.current = true;
      markNickColorTooltipSeen();
      setTooltipVisible(true);
      setTimeout(() => setTooltipVisible(false), 3000);
    }
    setColorPickerNick(nick);
  };

  const pickNickColor = (color: string | null) => {
    if (colorPickerNick) {
      setNickColors(prev => setNickColor(prev, colorPickerNick, color));
    }
    setColorPickerNick(null);
  };

  const displayItems = useMemo(() => groupCombos(messages, emotes), [messages, emotes]);

  // "Seen in chat" half of the emote picker's sort — counted across the
  // same 200-message window useChat itself caps `messages` to (MAX_MESSAGES
  // in useChat.ts), so this is naturally "recent", not a lifetime tally.
  const emoteWindowCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of messages) {
      for (const word of m.data.split(/\s+/)) {
        const [base] = word.split(':');
        if (emotes.has(base)) {
          counts.set(base, (counts.get(base) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [messages, emotes]);

  // The picker button itself shows the user's own most-used emote (falling
  // back to LUL before there's any usage data yet) — a preview of what
  // tapping it gets you, and doubles as a one-glance "your go-to" callout.
  const topEmoteName = useMemo(() => {
    let best: string | null = null;
    let bestCount = 0;
    for (const [name, count] of emoteUsageCounts) {
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    return best ?? 'LUL';
  }, [emoteUsageCounts]);

  const activeWord = findWordAtCursor(draft, selection.start);
  const suggestions: Suggestion[] =
    selection.start === selection.end
      ? buildSuggestions(activeWord.word, [...viewerStates.values()].map(v => v.nick), [...emotes.keys()], activeWord.useronly)
      : [];

  const applySuggestion = (suggestion: Suggestion) => {
    const { text, cursor } = applyCompletion(draft, activeWord, suggestion.text);
    setDraft(text);
    setSelection({ start: cursor, end: cursor });
    inputRef.current?.focus();
  };
  // Android's forced edge-to-edge display (targetSdk 35+) breaks the legacy
  // windowSoftInputMode="adjustResize" window-resize behavior, so instead of
  // relying on that (or KeyboardAvoidingView, which relies on it too), we
  // measure the keyboard directly and shift the layout ourselves.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const listRef = useRef<FlatList<DisplayItem>>(null);
  const insets = useSafeAreaInsets();
  // Tracks whether the user is scrolled away reading history — while true,
  // new messages/catch-ups shouldn't yank the view back to the bottom;
  // instead show a "More messages" pill they can tap when ready.
  const isNearBottomRef = useRef(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  // Set for the duration of any scrollToEnd call (animated or not). While
  // true, onListScroll ignores its own nearBottom calculation — a
  // scrollToEnd's own onScroll events can fire with contentSize still
  // catching up to a just-changed message list (e.g. cached messages
  // getting replaced by catch-up's fresher batch), reading as "far from
  // bottom" for a frame or two even for a non-animated jump. Without this
  // guard that flips isNearBottomRef back to false right after we just set
  // it true, silently re-freezing autoscroll (or, worse, leaving the list
  // short of the bottom with no "More messages" pill to recover with, since
  // hasNewMessages was also just cleared).
  const scrollingToEndRef = useRef(false);

  const scrollToEnd = (animated: boolean) => {
    scrollingToEndRef.current = true;
    listRef.current?.scrollToEnd({ animated });
    isNearBottomRef.current = true;
    setHasNewMessages(false);
    // onMomentumScrollEnd is the normal way this clears (see below), but it
    // never fires for a non-animated jump (no momentum to speak of) or if
    // the list was already at/near the bottom — without this fallback the
    // guard would stay stuck on, freezing autoscroll for good.
    setTimeout(() => {
      scrollingToEndRef.current = false;
    }, 500);
  };

  const NEAR_BOTTOM_THRESHOLD = 120;
  const onListScroll = (e: {
    nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } };
  }) => {
    if (scrollingToEndRef.current) {
      return;
    }
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const nearBottom = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
    isNearBottomRef.current = nearBottom;
    if (nearBottom) {
      setHasNewMessages(false);
    }
  };

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => {
      log.info(`${showEvent} height=${e.endCoordinates?.height}`);
      setKeyboardHeight(e.endCoordinates?.height ?? 0);
      // Goes through the same scrollToEnd used by "More messages" (not a
      // bare listRef call) so its scrollingToEndRef guard applies here too
      // — without it, this animated scroll's own mid-flight onScroll events
      // race isNearBottomRef exactly like the "More messages" bug did:
      // sometimes flipping it back to false before the scroll finishes and
      // popping the pill right back up instead of just landing at bottom.
      scrollToEnd(true);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      log.info(hideEvent);
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // After every catch-up (initial load + every reconnect): if the user is
  // near the bottom already, follow along as before — waiting a tick lets
  // FlatList finish laying out the new batch before scrollToEnd, otherwise
  // it can undershoot. If they've scrolled up to read history, don't yank
  // them back down; just flag that there's more to see.
  useEffect(() => {
    if (catchUpCount === 0) {
      return;
    }
    if (!isNearBottomRef.current) {
      setHasNewMessages(true);
      return;
    }
    const id = setTimeout(() => scrollToEnd(false), 0);
    return () => clearTimeout(id);
  }, [catchUpCount]);

  const onSend = (override?: string) => {
    const text = override ?? draft.trim();
    if (!text) {
      return;
    }
    sendMessage(text);
    recordEmoteUsage(text, emotes).then(setEmoteUsageCounts);
    setDraft('');
    setSelection({ start: 0, end: 0 });
  };

  // Tapping an emote in the picker: an empty box means the user opened the
  // picker specifically to send that one emote, so send it immediately
  // rather than making them tap Send too; otherwise it's a normal insert at
  // the cursor, same as picking an autocomplete suggestion.
  const onPickEmote = (name: string) => {
    setEmotePickerVisible(false);
    if (draft.trim() === '') {
      onSend(name);
      return;
    }
    const { text, cursor } = applyCompletion(draft, { start: selection.start, end: selection.start }, name);
    setDraft(text);
    setSelection({ start: cursor, end: cursor });
    inputRef.current?.focus();
  };

  // A reconnect while we already have history on screen is invisible to the
  // user (messages just keep flowing once it resolves, usually within a
  // couple seconds) — only worth a banner the very first time, before
  // there's anything to look at yet. A disconnect that's failed to recover
  // for a while is worth surfacing regardless of history.
  const showConnecting = status === 'connecting' && messages.length === 0;
  const showDisconnected = status === 'closed' && longDisconnected;

  return (
    <View style={styles.container}>
      {(showConnecting || showDisconnected) && (
        <View style={[styles.statusBar, showDisconnected && styles.statusBarError]}>
          <Text style={[styles.statusText, showDisconnected && styles.statusTextError]}>
            {showDisconnected ? 'Disconnected' : 'Connecting…'}
          </Text>
        </View>
      )}
      <KeyboardWrapper keyboardHeight={keyboardHeight} navBarInset={insets.bottom}>
        <FlatList
          ref={listRef}
          style={styles.list}
          data={displayItems}
          keyExtractor={item => item.key}
          renderItem={({ item }) =>
            item.type === 'combo' ? (
              <ComboRow emoteName={item.emoteName} count={item.count} emotes={emotes} />
            ) : (
              <MessageRow
                item={item.message}
                emotes={emotes}
                viewerStates={viewerStates}
                continued={item.continued}
                selfNick={me?.nick ?? null}
                nickColors={nickColors}
                onPressNick={onPressNick}
                onLongPressNick={onLongPressNick}
                focusedNick={focusedNick}
              />
            )
          }
          onContentSizeChange={() => {
            if (isNearBottomRef.current) {
              scrollToEnd(false);
            } else {
              setHasNewMessages(true);
            }
          }}
          onScroll={onListScroll}
          onMomentumScrollEnd={() => {
            scrollingToEndRef.current = false;
          }}
          scrollEventThrottle={100}
          contentContainerStyle={styles.listContent}
        />
        {hasNewMessages && (
          <TouchableOpacity style={styles.newMessagesPill} onPress={() => scrollToEnd(true)}>
            <Text style={styles.newMessagesPillText}>More messages ↓</Text>
          </TouchableOpacity>
        )}
        {suggestions.length > 0 && (
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            style={styles.suggestionBar}
            contentContainerStyle={styles.suggestionBarContent}
          >
            {suggestions.map(s => (
              <TouchableOpacity
                key={`${s.isEmote ? 'e' : 'u'}:${s.text}`}
                style={styles.suggestionChip}
                onPress={() => applySuggestion(s)}
              >
                {s.isEmote && emotes.get(s.text) && (
                  <AnimatedEmote
                    emote={emotes.get(s.text)!}
                    width={SUGGESTION_EMOTE_SIZE}
                    height={SUGGESTION_EMOTE_SIZE}
                    accessibilityLabel={s.text}
                  />
                )}
                <Text style={styles.suggestionText}>{s.text}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        <View
          style={[
            styles.inputRow,
            // With 3-button nav, the nav bar stays visible above the
            // keyboard rather than being covered by it, so this padding is
            // needed whether or not the keyboard is open.
            { paddingBottom: insets.bottom + 8 },
          ]}
        >
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            onSelectionChange={e => setSelection(e.nativeEvent.selection)}
            placeholder="Message #strims"
            placeholderTextColor="#5c6273"
            onSubmitEditing={() => onSend()}
            returnKeyType="send"
          />
          <TouchableOpacity style={styles.emoteButton} onPress={() => setEmotePickerVisible(true)}>
            {emotes.get(topEmoteName) ? (
              <AnimatedEmote emote={emotes.get(topEmoteName)!} width={24} height={24} accessibilityLabel={topEmoteName} />
            ) : (
              // Bundled with the app (not fetched) so the button has something
              // to show immediately on a cold start, before the network-loaded
              // emote index resolves — same LUL that'd show anyway once it does,
              // just not left blank/placeholder-text in the meantime.
              <Image source={require('../assets/emotes/LUL.png')} style={styles.emoteButtonFallback} />
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.sendButton} onPress={() => onSend()}>
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardWrapper>
      <Modal visible={tooltipVisible} transparent animationType="fade">
        <View style={styles.tooltipOverlay} pointerEvents="none">
          <View style={styles.tooltip}>
            <Text style={styles.tooltipText}>Long-press a name to change its color</Text>
          </View>
        </View>
      </Modal>
      <Modal visible={firstTimeSetupVisible} transparent animationType="fade">
        <View style={styles.tooltipOverlay} pointerEvents="none">
          <View style={styles.tooltip}>
            <Text style={styles.tooltipText}>Setting things up — first load takes a bit longer while emotes download</Text>
          </View>
        </View>
      </Modal>
      <NickColorPicker nick={colorPickerNick} onPick={pickNickColor} onDismiss={() => setColorPickerNick(null)} />
      <EmotePicker
        visible={emotePickerVisible}
        emotes={emotes}
        usageCounts={emoteUsageCounts}
        windowCounts={emoteWindowCounts}
        onPick={onPickEmote}
        onDismiss={() => setEmotePickerVisible(false)}
      />
    </View>
  );
}

const NICK_COLOR_PALETTE = [
  '#ff6b6b',
  '#ffa94d',
  '#ffd43b',
  '#69db7c',
  '#38d9a9',
  '#4dabf7',
  '#748ffc',
  '#da77f2',
  '#f783ac',
  '#ffffff',
];

interface NickColorPickerProps {
  nick: string | null;
  onPick: (color: string | null) => void;
  onDismiss: () => void;
}

function NickColorPicker({ nick, onPick, onDismiss }: NickColorPickerProps) {
  return (
    <Modal visible={nick !== null} transparent animationType="fade" onRequestClose={onDismiss}>
      <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onDismiss}>
        <View style={styles.colorPicker}>
          <Text style={styles.colorPickerTitle}>Color for {nick}</Text>
          <View style={styles.colorSwatchRow}>
            {NICK_COLOR_PALETTE.map(color => (
              <TouchableOpacity
                key={color}
                style={[styles.colorSwatch, { backgroundColor: color }]}
                onPress={() => onPick(color)}
              />
            ))}
          </View>
          <TouchableOpacity style={styles.colorPickerReset} onPress={() => onPick(null)}>
            <Text style={styles.colorPickerResetText}>Reset to default</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

interface EmotePickerProps {
  visible: boolean;
  emotes: Map<string, EmoteInfo>;
  usageCounts: Map<string, number>;
  windowCounts: Map<string, number>;
  onPick: (name: string) => void;
  onDismiss: () => void;
}

// Fixed-height list — 5 rows visible, rest reachable by scrolling — rather
// than sizing to content, so the picker doesn't balloon to the height of
// the entire emote set (currently 1000+) every time it opens.
const EMOTE_PICKER_ROW_HEIGHT = 44;
const EMOTE_PICKER_VISIBLE_ROWS = 5;

function EmotePicker({ visible, emotes, usageCounts, windowCounts, onPick, onDismiss }: EmotePickerProps) {
  // Primary: the user's own lifetime usage (emoteUsage.ts) — a strong,
  // personal signal of what they actually reach for. Secondary: how often
  // it's shown up in the current 200-message window (see useChat's
  // MAX_MESSAGES) — a live "what's popular right now" tiebreaker for
  // emotes the user hasn't used from this app yet. Alphabetical beyond that
  // just keeps the order stable rather than shuffling on every render.
  const sortedNames = useMemo(() => {
    const names = [...emotes.keys()];
    names.sort((a, b) => {
      const usageDiff = (usageCounts.get(b) ?? 0) - (usageCounts.get(a) ?? 0);
      if (usageDiff !== 0) {
        return usageDiff;
      }
      const windowDiff = (windowCounts.get(b) ?? 0) - (windowCounts.get(a) ?? 0);
      if (windowDiff !== 0) {
        return windowDiff;
      }
      return a.localeCompare(b);
    });
    return names;
  }, [emotes, usageCounts, windowCounts]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onDismiss}>
        <TouchableOpacity activeOpacity={1} style={styles.emotePickerCard} onPress={() => {}}>
          <Text style={styles.emotePickerTitle}>Emotes</Text>
          <FlatList
            data={sortedNames}
            keyExtractor={name => name}
            style={{ height: EMOTE_PICKER_ROW_HEIGHT * EMOTE_PICKER_VISIBLE_ROWS }}
            renderItem={({ item: name }) => (
              <TouchableOpacity style={styles.emotePickerRow} onPress={() => onPick(name)}>
                <AnimatedEmote emote={emotes.get(name)!} width={28} height={28} accessibilityLabel={name} />
                <Text style={styles.emotePickerRowText}>{name}</Text>
              </TouchableOpacity>
            )}
          />
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

interface KeyboardWrapperProps {
  keyboardHeight: number;
  navBarInset: number;
  children: React.ReactNode;
}

// On Android we already track the keyboard height ourselves (see
// ChatScreen's keyboardDidShow/Hide listener) — using KeyboardAvoidingView
// there too means two independent mechanisms fighting over the same layout,
// which was masking our own adjustment. Plain View + manual marginBottom on
// Android; the real KeyboardAvoidingView on iOS, where 'padding' behavior is
// reliable and there's no adjustResize/edge-to-edge conflict to work around.
function KeyboardWrapper({ keyboardHeight, navBarInset, children }: KeyboardWrapperProps) {
  if (Platform.OS === 'android') {
    // keyboardDidShow's reported height is just the IME's own height — with
    // 3-button nav the nav bar sits below the keyboard, not covered by it,
    // so it has to be added on top or the input ends up under the buttons.
    const marginBottom = keyboardHeight > 0 ? keyboardHeight + navBarInset : 0;
    return <View style={[styles.keyboardArea, { marginBottom }]}>{children}</View>;
  }
  return (
    <KeyboardAvoidingView style={styles.keyboardArea} behavior="padding" keyboardVerticalOffset={90}>
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#15161c' },
  // flex: 1 (not position: 'absolute') — inside a Modal, absolute
  // positioning doesn't reliably resolve against a full-screen size on
  // Android, but Modal's own host view sizes flex:1 children correctly.
  tooltipOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tooltip: {
    // Same blue as the mention-highlight background (messageRowHighlight)
    // so it reads as an intentional call-out rather than a generic toast.
    backgroundColor: '#002547',
    borderWidth: 1,
    borderColor: '#4c9fff',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '80%',
  },
  tooltipText: { color: '#ffffff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  colorPicker: { backgroundColor: '#1c1e27', borderRadius: 10, padding: 16, width: 280 },
  colorPickerTitle: { color: '#e6e8f0', fontSize: 15, fontWeight: '600', marginBottom: 12 },
  colorSwatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorSwatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: '#00000033' },
  colorPickerReset: { marginTop: 16, alignItems: 'center' },
  colorPickerResetText: { color: '#5c6273', fontSize: 13 },
  emotePickerCard: { backgroundColor: '#1c1e27', borderRadius: 10, padding: 16, width: 260 },
  emotePickerTitle: { color: '#e6e8f0', fontSize: 15, fontWeight: '600', marginBottom: 8 },
  emotePickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  emotePickerRowText: { color: '#e6e8f0', fontSize: 14 },
  keyboardArea: { flex: 1 },
  list: { flex: 1 },
  statusBar: { backgroundColor: '#3a2f1f', paddingVertical: 4, alignItems: 'center' },
  statusText: { color: '#e0c080', fontSize: 12 },
  statusBarError: { backgroundColor: '#3a1414' },
  statusTextError: { color: '#ff6b6b' },
  listContent: { paddingHorizontal: 8, paddingVertical: 6 },
  messageRow: { paddingVertical: 2 },
  messageRowContinued: { paddingVertical: 0, marginTop: -1 },
  // Matches chat-gui's .msg-highlight ($color-chat-highlight: #002547) —
  // shown when someone else's message mentions your nick anywhere in the
  // text, not just via an explicit @mention.
  messageRowHighlight: { backgroundColor: '#002547' },
  // Applied to every row except the focused nick's while a nick is toggled
  // active (see focusedNick) — dims everyone else without hiding them.
  messageRowDimmed: { opacity: 0.3 },
  continueMarker: { color: '#5c6273' },
  comboRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  comboCount: { color: '#e6e8f0', fontSize: 14, fontWeight: '700', marginLeft: 8 },
  comboFlair: { color: '#e45e07' },
  // Fixed lineHeight so a tall inline emote/emoji later in the paragraph
  // doesn't inflate just that line and throw off vertical rhythm.
  messageText: { flexShrink: 1, color: '#c6c9d4', fontSize: 14, lineHeight: 24 },
  nick: { fontWeight: '600', color: '#ffffff' },
  // A '▎' character colored per-viewer (see MessageRow) — always hugs
  // exactly the nick's own line since it lives inside the same inline text
  // flow, immune to whatever else is on the line.
  viewerBar: { fontWeight: '900' },
  greenText: { color: '#6ab04c' },
  link: { color: '#4c9fff', textDecorationLine: 'underline' },
  newMessagesPill: {
    alignSelf: 'center',
    marginTop: -14,
    marginBottom: 6,
    backgroundColor: '#4c6fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  newMessagesPillText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  suggestionBar: {
    maxHeight: 40,
    backgroundColor: '#1c1e27',
    borderTopWidth: 1,
    borderTopColor: '#2a2c37',
  },
  suggestionBarContent: { paddingHorizontal: 8, paddingVertical: 6, gap: 8 },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#262833',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  suggestionText: { color: '#c6c9d4', fontSize: 13 },
  inputRow: {
    flexDirection: 'row',
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: '#2a2c37',
    backgroundColor: '#1c1e27',
  },
  input: {
    flex: 1,
    backgroundColor: '#262833',
    color: '#e6e8f0',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 8,
  },
  emoteButton: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 40,
    borderRadius: 6,
    backgroundColor: '#262833',
    marginRight: 8,
  },
  emoteButtonFallback: { width: 24, height: 24 },
  sendButton: {
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: '#4c6fff',
  },
  sendButtonText: { color: '#fff', fontWeight: '600' },
});
