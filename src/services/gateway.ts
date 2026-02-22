// ═══════════════════════════════════════════════════════════
// Gateway WebSocket Client — Browser-side
// Protocol: OpenClaw Gateway WS v3
//
// Events:
//   event="chat" → payload.state: "delta"|"final"|"error"|"aborted"
//   payload.message.content: string | [{type:"text",text:"..."}]
// ═══════════════════════════════════════════════════════════

import { useWorkshopStore, Task } from '@/stores/workshopStore';
import { startPolling, stopPolling, handleGatewayEvent } from '@/stores/gatewayDataStore';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { parseButtons } from '@/utils/buttonParser';

// ── Workshop Command Parser ──
// Parses [[workshop:action ...]] commands from agent messages
interface WorkshopCommandResult {
  cleanContent: string;
  executed: string[];
}

function parseAndExecuteWorkshopCommands(content: string): WorkshopCommandResult {
  const executed: string[] = [];
  const store = useWorkshopStore.getState();
  
  // Pattern: [[workshop:action param1="value1" param2="value2"]]
  const commandRegex = /\[\[workshop:(\w+)((?:\s+\w+="[^"]*")*)\]\]/g;
  
  const cleanContent = content.replace(commandRegex, (match, action, paramsStr) => {
    try {
      // Parse params
      const params: Record<string, string> = {};
      const paramRegex = /(\w+)="([^"]*)"/g;
      let paramMatch;
      while ((paramMatch = paramRegex.exec(paramsStr)) !== null) {
        params[paramMatch[1]] = paramMatch[2];
      }
      
      switch (action) {
        case 'add': {
          const title = params.title || 'Untitled Task';
          const priority = (params.priority as Task['priority']) || 'medium';
          const description = params.description || '';
          const assignedAgent = params.agent || undefined;
          
          store.addTask({ title, priority, description, assignedAgent });
          executed.push(`✅ Added task: "${title}"`);
          break;
        }
        
        case 'move': {
          const id = params.id;
          const status = params.status as Task['status'];
          if (id && status && ['queue', 'inProgress', 'done'].includes(status)) {
            store.moveTask(id, status);
            executed.push(`✅ Moved task to ${status}`);
          } else {
            executed.push(`⚠️ Invalid move command`);
          }
          break;
        }
        
        case 'delete': {
          const id = params.id;
          if (id) {
            store.deleteTask(id);
            executed.push(`✅ Deleted task`);
          } else {
            executed.push(`⚠️ Invalid delete command`);
          }
          break;
        }
        
        case 'progress': {
          const id = params.id;
          const progress = parseInt(params.value || '0', 10);
          if (id && !isNaN(progress)) {
            store.setProgress(id, Math.min(100, Math.max(0, progress)));
            executed.push(`✅ Updated progress to ${progress}%`);
          }
          break;
        }
        
        case 'list': {
          const tasks = store.tasks;
          const summary = tasks.map(t => `- [${t.status}] ${t.title}`).join('\n');
          executed.push(`📋 Tasks:\n${summary}`);
          break;
        }
        
        default:
          executed.push(`⚠️ Unknown workshop command: ${action}`);
      }
    } catch (err) {
      executed.push(`❌ Error executing command: ${err}`);
    }
    
    return ''; // Remove the command from displayed content
  });
  
  return { cleanContent: cleanContent.trim(), executed };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
}

// ── AEGIS Desktop Client Context ──
// Injected with the FIRST message only — tells the agent about Desktop capabilities
// Version from package.json (injected by Vite define plugin or fallback)
const APP_VERSION = __APP_VERSION__ ?? '5.2.1';

const AEGIS_DESKTOP_CONTEXT = `[AEGIS_DESKTOP_CONTEXT]
You are connected via AEGIS Desktop v${APP_VERSION} — an Electron-based OpenClaw Gateway client.
This context is injected once at conversation start. Do NOT repeat or reference it to the user.

CAPABILITIES:
- User can attach: images (base64), files (as paths), screenshots, voice messages
- You can send: markdown (syntax highlighting, tables, RTL/LTR auto-detection), images (![](url)), videos (![](url.mp4))
- The interface supports dark/light themes and bilingual Arabic/English layout

ARTIFACTS (opens in a separate preview window):
For interactive content (dashboards, games, charts, UIs, diagrams), wrap in:

<aegis_artifact type="TYPE" title="Title">
...content...
</aegis_artifact>

Types: html (vanilla JS, CSS inline) | react (JSX, React 18 pre-loaded) | svg | mermaid
Rules:
- ONE self-contained file (inline CSS + JS, no external imports)
- Sandboxed iframe — no Node.js or filesystem access
- ALWAYS use for: interactive content, visualizations, calculators, games
- NEVER use for: simple text, short code snippets, explanations

FILE REFERENCES:
- Files: 📎 file: <path> (mime/type, size)
- Voice: 🎤 [voice] <path> (duration)

WORKSHOP (Kanban task management):
- [[workshop:add title="Task" priority="high|medium|low" description="Desc" agent="Name"]]
- [[workshop:move id="ID" status="queue|inProgress|done"]]
- [[workshop:delete id="ID"]]
- [[workshop:progress id="ID" value="0-100"]]
Commands execute automatically and are replaced with confirmations.

QUICK REPLIES (clickable buttons):
Add [[button:Label]] at the END of your message when you need a decision to proceed.
- Renders as clickable chips — click sends the text as a user message.
- Max 2-5 buttons. ONLY for decisions that block your next step.
- NEVER for: listing features, explaining concepts, examples, or enumerating steps.
[/AEGIS_DESKTOP_CONTEXT]`;

export interface MediaInfo {
  mediaUrl?: string;
  mediaType?: string;
}

export interface GatewayCallbacks {
  onMessage: (msg: ChatMessage) => void;
  onStreamChunk: (messageId: string, content: string, media?: MediaInfo) => void;
  onStreamEnd: (messageId: string, content: string, media?: MediaInfo) => void;
  onStatusChange: (status: { connected: boolean; connecting: boolean; error?: string }) => void;
  /** Fired when Gateway rejects with missing scope / invalid token */
  onScopeError?: (error: string) => void;
  /** Fired after successful re-pairing (token received) */
  onPairingComplete?: (token: string) => void;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

class GatewayService {
  private ws: WebSocket | null = null;
  private connected = false;
  private connecting = false;
  private callbacks: GatewayCallbacks | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private msgCounter = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private maxReconnects = 10;

  // ── Pairing detection (gentle retry instead of exponential backoff) ──
  private pairingRequired = false;
  private pairingRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly PAIRING_RETRY_MS = 5_000; // Retry every 5s when pairing needed

  // Current streaming state
  private currentRunId: string | null = null;
  private currentStreamContent: string = '';
  private lastCompactionTs = 0;

  // Device identity challenge nonce (from connect.challenge event)
  private challengeNonce: string | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Heartbeat (activity-based dead connection detection) ──
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly HEARTBEAT_DEAD_MS = 45_000; // No traffic for 45s = dead

  // ── Message Queue (buffer while disconnected) ──
  private messageQueue: Array<{ message: string; attachments?: any[]; sessionKey?: string }> = [];
  private readonly MAX_QUEUE_SIZE = 50;

  private url = '';
  private token = '';
  private contextSent = false;  // Track if Desktop context was sent with first message

  // ── Heartbeat Management (activity-based) ──
  // Any incoming message resets the timer. If no traffic for HEARTBEAT_DEAD_MS → reconnect.

  private startHeartbeat() {
    this.resetHeartbeat();
  }

  private resetHeartbeat() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (!this.connected) return;
    this.heartbeatTimer = setTimeout(() => {
      console.warn('[GW] ❌ No traffic for', this.HEARTBEAT_DEAD_MS / 1000, 's — connection dead');
      this.ws?.close(4000, 'Heartbeat timeout');
    }, this.HEARTBEAT_DEAD_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) { clearTimeout(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  // ── Message Queue Management ──

  private enqueueMessage(message: string, attachments?: any[], sessionKey?: string) {
    if (this.messageQueue.length >= this.MAX_QUEUE_SIZE) {
      console.warn('[GW] Queue full — dropping oldest message');
      this.messageQueue.shift();
    }
    this.messageQueue.push({ message, attachments, sessionKey });
    console.log('[GW] 📦 Queued message — queue size:', this.messageQueue.length);
  }

  private async flushQueue() {
    if (this.messageQueue.length === 0) return;
    console.log('[GW] 📤 Flushing', this.messageQueue.length, 'queued messages');
    // Copy and clear — prevent re-entrancy issues
    const queued = [...this.messageQueue];
    this.messageQueue = [];
    for (const item of queued) {
      try {
        await this.sendMessage(item.message, item.attachments, item.sessionKey);
      } catch (err) {
        console.error('[GW] Failed to flush queued message:', err);
        // Re-queue failed messages at the front
        this.messageQueue.unshift(item);
        break; // Stop flushing — connection might be dead again
      }
    }
  }

  /** Number of messages waiting in the offline queue */
  getQueueSize(): number {
    return this.messageQueue.length;
  }

  // ── Setup ──

  setCallbacks(cb: GatewayCallbacks) {
    this.callbacks = cb;
  }

  // ── Extract text from content (string or content blocks array) ──
  private extractText(content: any): string {
    if (typeof content === 'string') return content;
    if (content == null) return '';
    if (Array.isArray(content)) {
      return content
        .map((block: any) => {
          if (typeof block === 'string') return block;
          if (block?.type === 'text' && typeof block.text === 'string') return block.text;
          if (typeof block?.text === 'string') return block.text;
          return '';
        })
        .join('');
    }
    if (typeof content === 'object') {
      if (typeof content.text === 'string') return content.text;
      if (typeof content.content === 'string') return content.content;
      if (Array.isArray(content.content)) return this.extractText(content.content);
      return JSON.stringify(content);
    }
    return String(content);
  }

  // ── Extract text from a message object ──
  private extractMessageText(msg: any): string {
    if (!msg) return '';
    const content = msg.content;
    return this.extractText(content);
  }

  // ── Connect ──

  connect(url: string, token: string) {
    this.url = url;
    this.token = token;

    if (this.ws && (this.connected || this.connecting)) return;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connecting = true;
    this.contextSent = false;  // Reset context injection for new connection
    this.emitStatus();

    console.log('[GW] Connecting:', url);

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[GW] Open — waiting for connect.challenge...');
      this.challengeNonce = null;
      // Wait up to 750ms for challenge; if it doesn't arrive, send without nonce
      this.connectTimer = setTimeout(() => {
        if (this.connecting) {
          console.log('[GW] No challenge received — sending handshake without nonce');
          this.sendHandshake();
        }
      }, 750);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch (e) {
        console.error('[GW] Parse error:', e);
      }
    };

    this.ws.onclose = (event) => {
      console.log('[GW] Closed:', event.code, event.reason);
      this.stopHeartbeat();
      stopPolling();
      this.connected = false;
      this.connecting = false;
      this.ws = null;
      this.emitStatus();

      // Pairing required — gentle retry instead of exponential backoff
      if (this.pairingRequired) {
        this.callbacks?.onScopeError?.('pairing required');
        this.schedulePairingRetry();
        return;
      }

      this.scheduleReconnect();
    };

    this.ws.onerror = (event) => {
      console.error('[GW] Error:', event);
      this.connecting = false;
      this.emitStatus({ error: 'Connection error' });
    };
  }

  disconnect() {
    this.stopHeartbeat();
    this.stopPairingRetry();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = this.maxReconnects;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.connecting = false;
    this.emitStatus();
  }

  // ── Handshake ──

  private async sendHandshake() {
    const id = this.nextId();
    const scopes = ['operator.read', 'operator.write', 'operator.admin'];
    const clientId = 'openclaw-control-ui';
    const clientMode = 'ui';
    // Note: Gateway client schema is strict — no extra fields allowed
    // Desktop identity is carried in userAgent instead

    this.registerCallback(id, {
      resolve: (response: any) => {
        console.log('[GW] Handshake response:', JSON.stringify(response).substring(0, 200));
        if (response.ok !== false && (response.payload?.type === 'hello-ok' || response.type === 'hello-ok')) {
          console.log('[GW] ✅ Connected!');
          // Save device token if issued
          const auth = response.auth || response.payload?.auth;
          if (auth?.deviceToken && window.aegis?.pairing?.saveToken) {
            window.aegis.pairing.saveToken(auth.deviceToken).catch(() => {});
          }
          this.connected = true;
          this.connecting = false;
          this.reconnectAttempt = 0;
          // Reset pairing state on successful connect
          this.pairingRequired = false;
          if (this.pairingRetryTimer) {
            clearTimeout(this.pairingRetryTimer);
            this.pairingRetryTimer = null;
          }
          this.startHeartbeat();
          this.emitStatus();
          // Start central data polling
          startPolling(this);
          // Enable reasoning streaming so ThinkingBubble works for all users
          this.enableReasoningStream();
          // Flush any messages queued while disconnected
          this.flushQueue();
        } else {
          const err = response.error?.message || JSON.stringify(response);
          console.error('[GW] ❌ Handshake failed:', err);
          this.connected = false;
          this.connecting = false;
          this.emitStatus({ error: err });
        }
      },
      reject: (err: any) => {
        const errStr = String(err);
        console.error('[GW] ❌ Handshake rejected:', errStr);
        this.connecting = false;
        // Detect pairing rejection — will switch to gentle retry in onclose
        if (errStr.toLowerCase().includes('pairing required') || errStr.toLowerCase().includes('pairing_required')) {
          this.pairingRequired = true;
        }
        this.emitStatus({ error: errStr });
      },
    });

    // Build device identity if available (Electron IPC)
    let device: any = undefined;
    try {
      if (window.aegis?.device?.sign) {
        const signed = await window.aegis.device.sign({
          nonce: this.challengeNonce || undefined,
          clientId,
          clientMode,
          role: 'operator',
          scopes,
          token: this.token || '',
        });
        device = {
          id: signed.deviceId,
          publicKey: signed.publicKey,
          signature: signed.signature,
          signedAt: signed.signedAt,
          nonce: signed.nonce,
        };
        console.log('[GW] 🔑 Device identity attached:', signed.deviceId.substring(0, 16) + '...');
      }
    } catch (err) {
      console.warn('[GW] Device identity unavailable:', err);
    }

    this.send({
      type: 'req',
      id,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: clientId,
          version: APP_VERSION,
          platform: 'windows',
          mode: clientMode,
        },
        role: 'operator',
        scopes,
        caps: ['streaming'],
        commands: [],
        permissions: {},
        auth: { token: this.token },
        device,
        locale: 'ar-SA',
        userAgent: `aegis-desktop/${APP_VERSION}`,
      },
    });
  }

  // ── Send Message ──

  async sendMessage(message: string, attachments?: any[], sessionKey = 'agent:main:main'): Promise<any> {
    // Queue message if disconnected instead of throwing
    if (!this.ws || !this.connected) {
      this.enqueueMessage(message, attachments, sessionKey);
      return { queued: true, queueSize: this.messageQueue.length };
    }

    // Gateway expects: { type, mimeType, content (base64 string), fileName }
    // content = raw base64 (NOT data URI) — Gateway normalizes it internally
    const gwAttachments = attachments?.map((att) => {
      // Strip data URI prefix if present — Gateway wants raw base64
      let rawBase64 = att.content || '';
      if (rawBase64.startsWith('data:')) {
        rawBase64 = rawBase64.replace(/^data:[^;]+;base64,/, '');
      }
      return {
        type: att.mimeType?.startsWith('image/') ? 'image' : 'file',
        mimeType: att.mimeType,
        content: rawBase64,
        fileName: att.fileName || 'file',
      };
    });

    // Inject Desktop context with the FIRST message only
    let finalMessage = message;
    if (!this.contextSent && message.trim()) {
      finalMessage = `${AEGIS_DESKTOP_CONTEXT}\n\n${message}`;
      this.contextSent = true;
      console.log('[GW] 📋 Desktop context injected with first message');
    }

    return this.request('chat.send', {
      sessionKey,
      message: finalMessage,
      idempotencyKey: `aegis-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...(gwAttachments?.length ? { attachments: gwAttachments } : {}),
    });
  }

  // ── Sessions & History ──

  async getSessions(): Promise<any> {
    return this.request('sessions.list', {});
  }

  async getAgents(): Promise<any> {
    return this.request('agents.list', {});
  }

  async createAgent(agent: { id: string; name?: string; model?: string; workspace?: string }): Promise<any> {
    return this.request('agents.create', agent);
  }

  async updateAgent(agentId: string, patch: { name?: string; model?: string; workspace?: string }): Promise<any> {
    return this.request('agents.update', { agentId, ...patch });
  }

  async deleteAgent(agentId: string): Promise<any> {
    return this.request('agents.delete', { agentId });
  }

  async getHistory(sessionKey: string, limit = 200): Promise<any> {
    return this.request('chat.history', { sessionKey, limit });
  }

  // ── Abort (Stop) ──

  async abortChat(sessionKey = 'agent:main:main'): Promise<any> {
    return this.request('chat.abort', { sessionKey });
  }

  /** Override the model for a specific session (per-session, not permanent). */
  async setSessionModel(model: string, sessionKey = 'agent:main:main'): Promise<any> {
    return this.request('sessions.patch', { key: sessionKey, model });
  }

  /** Override thinking level for a session (null = reset to default). */
  async setSessionThinking(level: string | null, sessionKey = 'agent:main:main'): Promise<any> {
    return this.request('sessions.patch', { key: sessionKey, thinkingLevel: level });
  }

  /** Enable reasoning visibility so thinking content appears as a separate Reasoning: message.
   *  'on' sends reasoning as a prefixed message (works on all channels).
   *  'stream' only works on Telegram preview — not WebSocket clients. */
  private async enableReasoningStream(sessionKey = 'agent:main:main') {
    try {
      await this.request('sessions.patch', { key: sessionKey, reasoningLevel: 'on' });
      console.log('[GW] 🧠 Reasoning visibility enabled');
    } catch (err) {
      console.warn('[GW] Could not enable reasoning:', err);
    }
  }

  /** Update an agent's extra params (e.g. context1m). */
  async updateAgentParams(agentId: string, extraParams: Record<string, any>): Promise<any> {
    return this.request('agents.update', { agentId, extraParams });
  }

  // ── Session Status (token usage) ──

  async getSessionStatus(sessionKey = 'agent:main:main'): Promise<any> {
    return this.request('sessions.list', {});
  }

  // ── Cost & Usage ──

  async getAvailableModels(): Promise<any> {
    return this.request('models.list', {});
  }

  /** Public gateway RPC — use for one-off calls not covered by dedicated methods */
  async call(method: string, params: any = {}): Promise<any> {
    return this.request(method, params);
  }

  async getCostSummary(days = 30): Promise<any> {
    return this.request('usage.cost', { days });
  }

  async getSessionsUsage(params: { limit?: number; startDate?: string; endDate?: string; key?: string } = {}): Promise<any> {
    return this.request('sessions.usage', { limit: 50, ...params });
  }

  async getSessionTimeseries(key: string): Promise<any> {
    return this.request('sessions.usage.timeseries', { key });
  }

  async getSessionLogs(key: string, limit = 200): Promise<any> {
    return this.request('sessions.usage.logs', { key, limit });
  }

  // ── Status ──

  getStatus() {
    return { connected: this.connected, connecting: this.connecting };
  }

  // ── Internal ──

  private async request(method: string, params: any): Promise<any> {
    if (!this.ws || !this.connected) throw new Error('Not connected');

    return new Promise((resolve, reject) => {
      const id = this.nextId();
      this.registerCallback(id, { resolve, reject });
      this.send({ type: 'req', id, method, params });
    });
  }

  private registerCallback(id: string, handlers: { resolve: (v: any) => void; reject: (e: any) => void }) {
    const timer = setTimeout(() => {
      this.pendingRequests.delete(id);
      handlers.reject('Request timeout');
    }, 120000);
    this.pendingRequests.set(id, { ...handlers, timer });
  }

  private handleMessage(msg: any) {
    // Any incoming message = connection alive — reset heartbeat timer
    this.resetHeartbeat();

    // Intercept connect.challenge — extract nonce and trigger handshake
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      const nonce = msg.payload?.nonce;
      if (nonce && typeof nonce === 'string') {
        console.log('[GW] 🔑 Received connect.challenge with nonce');
        this.challengeNonce = nonce;
        if (this.connectTimer) {
          clearTimeout(this.connectTimer);
          this.connectTimer = null;
        }
        this.sendHandshake();
      }
      return;
    }

    // Response
    if (msg.type === 'res' && msg.id) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        if (msg.ok !== false) {
          pending.resolve(msg.payload ?? msg);
        } else {
          const errorMsg = msg.error?.message || 'Request failed';
          // Detect scope/auth errors for auto-pairing flow
          if (typeof errorMsg === 'string' &&
              (errorMsg.toLowerCase().includes('missing scope') ||
               errorMsg.toLowerCase().includes('unauthorized') ||
               errorMsg.toLowerCase().includes('invalid token') ||
               errorMsg.toLowerCase().includes('token required') ||
               errorMsg.toLowerCase().includes('auth'))) {
            console.warn('[GW] 🔑 Scope/auth error detected:', errorMsg);
            this.callbacks?.onScopeError?.(errorMsg);
          }
          pending.reject(errorMsg);
        }
      }
      return;
    }

    // Event
    if (msg.type === 'event') {
      this.handleEvent(msg);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Tool Stream Handler — real-time tool execution display
  //
  // Gateway sends: { type:"event", event:"chat", payload: {
  //   stream: "tool",
  //   runId, sessionKey?, ts?,
  //   data: {
  //     toolCallId: string,
  //     name: string,
  //     phase: "start" | "update" | "result",
  //     args?: Record<string,any>,        // when phase==="start"
  //     partialResult?: string | object,   // when phase==="update"
  //     result?: string | object,          // when phase==="result"
  //   }
  // }}
  // ═══════════════════════════════════════════════════════════
  private handleToolStream(payload: any) {
    // Only process when Tool Intent View is enabled in settings
    if (!useSettingsStore.getState().toolIntentEnabled) return;

    const data = payload.data ?? {};
    const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : '';
    if (!toolCallId) return;

    const toolName = typeof data.name === 'string' ? data.name : 'tool';
    const phase    = typeof data.phase === 'string' ? data.phase : '';
    const msgId    = `tool-live-${toolCallId}`;

    const store = useChatStore.getState();

    if (phase === 'start') {
      // Tool is starting — add a 'running' card (idempotent)
      if (!store.messages.some((m) => m.id === msgId)) {
        const toolInput = data.args && typeof data.args === 'object' ? data.args : {};
        store.addMessage({
          id: msgId,
          role: 'tool',
          content: '',
          toolName,
          toolInput,
          toolStatus: 'running',
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    if (phase === 'update') {
      // Partial result streaming — update existing card
      const partial = data.partialResult != null
        ? (typeof data.partialResult === 'string' ? data.partialResult : JSON.stringify(data.partialResult))
        : '';
      const msgs = store.messages;
      const idx  = msgs.findIndex((m) => m.id === msgId);
      if (idx >= 0) {
        const updated = [...msgs];
        updated[idx] = { ...updated[idx], toolOutput: partial.slice(0, 2000) };
        store.setMessages(updated);
      }
      return;
    }

    if (phase === 'result') {
      // Tool complete — finalize with output + duration
      const output = data.result != null
        ? (typeof data.result === 'string' ? data.result : JSON.stringify(data.result))
        : '';
      const msgs = store.messages;
      const idx  = msgs.findIndex((m) => m.id === msgId);
      if (idx >= 0) {
        const updated = [...msgs];
        const startTs = typeof payload.ts === 'number' ? payload.ts : 0;
        const durationMs = startTs > 0 ? Date.now() - startTs : undefined;
        updated[idx] = {
          ...updated[idx],
          toolOutput: output.slice(0, 2000),
          toolStatus: 'done',
          ...(durationMs !== undefined ? { toolDurationMs: durationMs } : {}),
        };
        store.setMessages(updated);
      } else {
        // No 'start' event received — add result card directly
        store.addMessage({
          id: msgId,
          role: 'tool',
          content: '',
          toolName,
          toolOutput: output.slice(0, 2000),
          toolStatus: 'done',
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    console.log('[GW] Tool stream — unknown phase:', phase, toolCallId);
  }

  // ═══════════════════════════════════════════════════════════
  // Thinking Stream Handler — real-time reasoning display
  //
  // Gateway sends: { type:"event", event:"chat", payload: {
  //   stream: "thinking",
  //   runId, sessionKey?,
  //   data: {
  //     text: string,   // full accumulated thinking text
  //     delta: string,   // new portion only
  //   }
  // }}
  // ═══════════════════════════════════════════════════════════
  private handleThinkingStream(payload: any) {
    const data = payload.data ?? {};
    const text = typeof data.text === 'string' ? data.text : '';
    const runId = payload.runId || this.currentRunId || '';

    if (!text || !runId) return;

    const store = useChatStore.getState();
    store.setThinkingStream(runId, text);
  }

  // ═══════════════════════════════════════════════════════════
  // Event Handler — OpenClaw Protocol
  //
  // Gateway sends: { type:"event", event:"chat", payload: {
  //   state: "delta" | "final" | "error" | "aborted",
  //   message: { role, content },  // content: string | [{type:"text",text:"..."}]
  //   sessionKey, runId
  // }}
  //
  // "delta" = streaming update (accumulated content, NOT a chunk)
  // "final" = complete, fetch full history
  // ═══════════════════════════════════════════════════════════
  private handleEvent(msg: any) {
    const event = msg.event || '';
    const p = msg.payload || {};

    // ── Direct compaction detection from agent events ──
    // Instead of relying on polling tokenUsage.compactions (unreliable timing),
    // intercept the agent compaction event and inject CompactDivider immediately.
    if (event === 'agent' && p.stream === 'compaction' && p.data?.phase === 'end' && !p.data?.willRetry) {
      const sk = p.sessionKey || '';
      if (sk === 'agent:main:main' || !sk) {
        const now = Date.now();
        if (now - this.lastCompactionTs > 10_000) { // Dedup: max 1 per 10s
          this.lastCompactionTs = now;
          useChatStore.getState().addMessage({
            id: `compaction-live-${now}`,
            role: 'compaction' as any,
            content: '',
            timestamp: new Date().toISOString(),
          });
          console.log('[GW] 📦 Compaction detected — divider injected');
        }
      }
    }

    // Non-chat events → forward to central data store
    if (event !== 'chat') {
      handleGatewayEvent(event, p);
      return;
    }

    // Filter out events from isolated cron/sub-agent sessions
    // Only show messages from main session or sessions the user explicitly opened
    const sessionKey = p.sessionKey || '';
    if (sessionKey && sessionKey !== 'agent:main:main') {
      console.log('[GW] Ignoring event from isolated session:', sessionKey);
      return;
    }

    // ── Tool stream events (real-time tool execution) ──
    // payload.stream === "tool" → tool call lifecycle events (start/update/result)
    if (p.stream === 'tool') {
      this.handleToolStream(p);
      return;
    }

    // ── Thinking stream events (real-time reasoning display) ──
    // payload.stream === "thinking" → accumulated reasoning text
    if (p.stream === 'thinking') {
      this.handleThinkingStream(p);
      return;
    }

    // Compaction stream from chat events — already handled above via agent events
    if (p.stream === 'compaction') return;

    const state = p.state || '';
    const runId = p.runId || '';
    let messageText = this.extractMessageText(p.message);

    // Extract mediaUrl from payload fields
    let mediaUrl = p.mediaUrl || p.message?.mediaUrl || (p.mediaUrls?.length ? p.mediaUrls[0] : undefined);
    let mediaType = p.mediaType || p.message?.mediaType || undefined;

    // Also extract MEDIA: paths/URLs from message content (OpenClaw TTS format)
    // Formats:
    //   MEDIA:http://localhost:5050/audio/xxx.mp3   (HTTP URL — preferred)
    //   MEDIA:/host-d/clawdbot-shared/voice/xxx.mp3 (shared folder path)
    //   MEDIA:/tmp/tts-xxx/voice-123.mp3            (sandbox path — needs conversion)
    const mediaMatch = messageText.match(/MEDIA:(https?:\/\/[^\s]+|\/[^\s]+|[A-Z]:\\[^\s]+)/);
    if (mediaMatch) {
      let mediaPath = mediaMatch[1];
      mediaType = mediaType || 'audio';
      // Remove the MEDIA: line from displayed text
      messageText = messageText.replace(/\n?MEDIA:[^\s]+\n?/g, '').trim();

      if (!mediaUrl) {
        if (/^https?:\/\//.test(mediaPath)) {
          // HTTP URL — use directly (Edge TTS server or any HTTP source)
          mediaUrl = mediaPath;
          console.log('[GW] 🔊 Media URL (HTTP):', mediaUrl);
        } else {
          // File path — resolve via Electron IPC
          mediaUrl = `aegis-media:${mediaPath}`;
          console.log('[GW] 🔊 Media path:', mediaPath);
        }
      }
    }

    const media: MediaInfo | undefined = mediaUrl ? { mediaUrl, mediaType } : undefined;

    console.log('[GW] Chat event — state:', state, 'runId:', runId?.substring(0, 12), 'text length:', messageText.length);

    // Use runId as the message ID for streaming
    const mId = runId || `msg-${Date.now()}`;

    // ── Reasoning message detection ──
    // When reasoningLevel='on', Gateway sends reasoning as a separate 'final'
    // message prefixed with "Reasoning:" BEFORE the actual response.
    // We intercept it and store as thinking content for the next message.
    const reasoningPrefix = /^Reasoning:\s*/i;
    if (state === 'final' && messageText && reasoningPrefix.test(messageText)) {
      const reasoningText = messageText.replace(reasoningPrefix, '').trim();
      if (reasoningText) {
        console.log('[GW] 🧠 Reasoning message captured:', reasoningText.length, 'chars');
        // Store as live thinking, then it will be finalized onto the next assistant message
        useChatStore.getState().setThinkingStream(mId, reasoningText);
      }
      return; // Don't show as a regular message
    }

    switch (state) {
      case 'delta': {
        // Streaming update — content is ACCUMULATED (not a chunk)
        // Only update if the new content is longer (protocol sends full accumulated text)
        if (messageText.length >= this.currentStreamContent.length) {
          this.currentStreamContent = messageText;
          this.currentRunId = mId;
          // Pass media if present (usually comes with final, but check delta too)
          this.callbacks?.onStreamChunk(mId, messageText, media);
        }
        break;
      }

      case 'final': {
        // Message complete — use the final text or what we accumulated
        let finalText = messageText || this.currentStreamContent;
        this.currentStreamContent = '';
        this.currentRunId = null;
        
        // Parse and execute Workshop commands
        const { cleanContent, executed } = parseAndExecuteWorkshopCommands(finalText);
        if (executed.length > 0) {
          // Append execution results to the message
          finalText = cleanContent + (cleanContent ? '\n\n' : '') + executed.join('\n');
        } else {
          finalText = cleanContent || finalText;
        }

        // Parse [[button:...]] markers — strip from text, store in chatStore
        const btnResult = parseButtons(finalText);
        if (btnResult.buttons.length > 0) {
          finalText = btnResult.cleanContent;
          useChatStore.getState().setQuickReplies(btnResult.buttons);
        } else {
          useChatStore.getState().setQuickReplies([]);
        }
        
        this.callbacks?.onStreamEnd(mId, finalText, media);
        break;
      }

      case 'error': {
        const errorText = p.errorMessage || 'حدث خطأ';
        this.currentStreamContent = '';
        this.currentRunId = null;
        useChatStore.getState().clearThinking();
        this.callbacks?.onStreamEnd(mId, `⚠️ ${errorText}`);
        break;
      }

      case 'aborted': {
        this.currentStreamContent = '';
        this.currentRunId = null;
        useChatStore.getState().clearThinking();
        this.callbacks?.onStreamEnd(mId, this.currentStreamContent || '⏹️ تم الإيقاف');
        break;
      }

      default:
        console.log('[GW] Unknown chat state:', state);
    }
  }

  private send(msg: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private nextId(): string {
    return `aegis-${Date.now()}-${++this.msgCounter}`;
  }

  private emitStatus(extra?: { error?: string }) {
    this.callbacks?.onStatusChange({
      connected: this.connected,
      connecting: this.connecting,
      ...extra,
    });
  }

  // ── Pairing Retry (gentle 5s interval — no backoff) ──

  private schedulePairingRetry() {
    if (this.pairingRetryTimer) clearTimeout(this.pairingRetryTimer);
    this.pairingRetryTimer = setTimeout(() => {
      if (this.pairingRequired && !this.connected && !this.connecting) {
        console.log('[GW] 🔑 Pairing retry...');
        this.connect(this.url, this.token);
      }
    }, this.PAIRING_RETRY_MS);
  }

  /** Stop pairing retry loop (called from cancel or disconnect) */
  stopPairingRetry() {
    this.pairingRequired = false;
    if (this.pairingRetryTimer) {
      clearTimeout(this.pairingRetryTimer);
      this.pairingRetryTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempt >= this.maxReconnects) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30000);
    this.reconnectAttempt++;
    console.log(`[GW] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => this.connect(this.url, this.token), delay);
  }

  // ── Auto-Pairing Support ──

  /** Derive HTTP base URL from the WebSocket URL */
  getHttpBaseUrl(): string {
    return this.url
      .replace(/^ws:/, 'http:')
      .replace(/^wss:/, 'https:')
      .replace(/\/+$/, ''); // Strip trailing slashes to avoid double-slash in URLs
  }

  /** Reconnect with a new token (after pairing approval) */
  reconnectWithToken(newToken: string) {
    console.log('[GW] 🔑 Reconnecting with new token');
    this.stopHeartbeat();
    this.stopPairingRetry();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.connecting = false;
    this.reconnectAttempt = 0;
    this.token = newToken;
    // Small delay to allow clean disconnect
    setTimeout(() => this.connect(this.url, newToken), 300);
  }

  /** Request pairing via Gateway HTTP API */
  async requestPairing(): Promise<{ code: string; deviceId: string }> {
    const httpUrl = this.getHttpBaseUrl();
    console.log('[GW] 🔑 Requesting pairing from:', httpUrl);
    const res = await fetch(`${httpUrl}/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'openclaw-control-ui',
        clientName: 'AEGIS Desktop',
        platform: 'windows',
        scopes: ['operator.read', 'operator.write', 'operator.admin'],
      }),
    });
    if (!res.ok) {
      throw new Error(`Pairing request failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  /** Poll pairing status until approved or timeout */
  async pollPairingStatus(deviceId: string): Promise<{ status: string; token?: string }> {
    const httpUrl = this.getHttpBaseUrl();
    const res = await fetch(`${httpUrl}/v1/pair/${encodeURIComponent(deviceId)}/status`);
    if (!res.ok) {
      throw new Error(`Pairing poll failed: ${res.status}`);
    }
    return res.json();
  }
}

// Singleton
export const gateway = new GatewayService();
