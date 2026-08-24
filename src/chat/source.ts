import EventEmitter from './emitter';
import { JWT_COOKIE_NAME } from '../config/env';
import { parseFrame } from './frame';
import { makeLogger } from '../log';

const log = makeLogger('chat-source');

/**
 * Port of chat-gui/assets/chat/js/source.js — the golang sgg chat service
 * speaks a custom framing over raw WebSocket: `EVENTNAME {json payload}`.
 * Reconnect backoff matches the original: short retry (501-3000ms) right
 * after a successful connection drops, longer retry (5000-30000ms) for
 * repeated failures.
 *
 * Native RN WebSocket can't send cookies automatically like a browser, so we
 * attach the session jwt as a `Cookie` header on the handshake instead.
 */
// RN's WebSocket implementation (Libraries/WebSocket/WebSocket.js) matches
// the browser readyState enum but its ambient TS type varies by environment,
// so we pin the numeric values here instead of relying on instance statics.
const READY_STATE_CONNECTING = 0;
const READY_STATE_CLOSED = 3;
const READY_STATE_OPEN = 1;

// A connection that opens and dies again within this window didn't actually
// succeed — likely the server itself is rejecting/kicking it (e.g. rate
// limiting rapid reconnects). Treating that as a "success" that resets the
// backoff produces a runaway reconnect storm that never backs off, which is
// exactly what a too-eager client can trigger a rate limiter with in the
// first place.
const STABLE_CONNECTION_MS = 10000;

export default class ChatSource extends EventEmitter {
  private socket: WebSocket | null = null;
  private url: string | null = null;
  private jwt: string | null = null;
  retryOnDisconnect = true;
  private retryAttempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private openedAt: number | null = null;

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === READY_STATE_OPEN;
  }

  isConnecting(): boolean {
    return this.socket !== null && this.socket.readyState === READY_STATE_CONNECTING;
  }

  connect(url: string, jwt: string): void {
    this.url = url;
    this.jwt = jwt;
    this.retryAttempts++;
    try {
      if (this.retryTimer !== null) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      if (this.socket !== null) {
        this.socket.onopen = null;
        this.socket.onclose = null;
        this.socket.onerror = null;
        this.socket.onmessage = null;
        this.disconnect();
        this.socket = null;
      }
      log.info(`connecting (attempt ${this.retryAttempts})`, this.url);
      this.emit('CONNECTING', this.url);
      const socket = new (WebSocket as any)(this.url, undefined, {
        headers: { Cookie: `${JWT_COOKIE_NAME}=${this.jwt}` },
      });
      this.socket = socket;
      socket.onopen = (e: any) => this.onOpen(e);
      socket.onclose = (e: any) => this.onClose(e);
      socket.onmessage = (e: any) => this.onMsg(e);
      socket.onerror = (e: any) => this.emit('SOCKETERROR', e);
    } catch (e) {
      this.emit('SOCKETERROR', e);
    }
  }

  disconnect(): void {
    if (this.socket && this.socket.readyState !== READY_STATE_CLOSED) {
      this.socket.close();
    }
  }

  private onOpen(e: unknown): void {
    log.info('open');
    this.emit('OPEN', e);
    this.openedAt = Date.now();
    this.retryOnDisconnect = true;
  }

  private onClose(e: { code?: number }): void {
    const wasStable = this.openedAt !== null && Date.now() - this.openedAt >= STABLE_CONNECTION_MS;
    this.openedAt = null;
    if (wasStable) {
      this.retryAttempts = 0;
    }
    let retryMilli = 0;
    if (this.retryOnDisconnect && this.url && this.jwt) {
      retryMilli =
        this.retryAttempts <= 1
          ? Math.floor(Math.random() * (3000 - 501 + 1)) + 501
          : Math.floor(Math.random() * (30000 - 5000 + 1)) + 5000;
      this.retryTimer = setTimeout(() => this.connect(this.url!, this.jwt!), retryMilli);
    }
    log.warn(
      `closed (code ${e.code ?? 1006}, stable=${wasStable}), retrying in ${retryMilli}ms (attempt ${this.retryAttempts})`,
    );
    this.emit('CLOSE', { code: e.code || 1006, retryMilli });
  }

  private onMsg(e: { data: unknown }): void {
    this.parseAndDispatch(e);
  }

  private parseAndDispatch(event: { data: unknown }): void {
    const { event: eventname, data } = parseFrame(String(event.data));
    this.emit('DISPATCH', { data, event: eventname });
    this.emit(eventname, data);
  }

  send(eventname: string, data: unknown): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    if (this.isConnected()) {
      this.socket!.send(`${eventname} ${payload}`);
    } else {
      this.emit('ERR', 'notconnected');
    }
  }
}
