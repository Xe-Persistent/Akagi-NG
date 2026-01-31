import type { Protocol } from 'devtools-protocol';
import type { WebContents } from 'electron';

export class GameHandler {
  private attached = false;
  private readonly BACKEND_API = 'http://127.0.0.1:8765/api/ingest';

  constructor(private webContents: WebContents) {}

  public async attach() {
    if (this.attached) return;

    try {
      // Auto re-attach when page reloads
      this.webContents.on('did-finish-load', async () => {
        if (!this.attached) {
          // Wait a bit just in case
          setTimeout(() => this.tryAttach(), 500);
        }
      });

      await this.tryAttach();
    } catch (err) {
      console.error('[GameHandler] Failed to attach debugger:', err);
    }
  }

  private async tryAttach() {
    if (this.attached) return;

    try {
      this.webContents.debugger.attach('1.3');
      this.attached = true;

      this.webContents.debugger.on('detach', (event, reason) => {
        console.warn('[GameHandler] Debugger detached:', reason);
        this.attached = false;
        this.sendToBackend({
          source: 'electron',
          type: 'debugger_detached',
          reason: reason,
          time: Date.now() / 1000,
        });
      });

      this.webContents.debugger.on('message', this.handleDebuggerMessage.bind(this));

      await this.webContents.debugger.sendCommand('Network.enable');
    } catch (e) {
      console.error('[GameHandler] Attach failed', e);
    }
  }

  public detach() {
    if (this.attached) {
      this.webContents.debugger.detach();
      this.attached = false;
    }
  }

  private async handleDebuggerMessage(event: unknown, method: string, params: unknown) {
    if (method === 'Network.webSocketCreated') {
      const p = params as Protocol.Network.WebSocketCreatedEvent;
      this.sendToBackend({
        source: 'electron',
        type: 'websocket_created',
        requestId: p.requestId,
        url: p.url,
        time: Date.now() / 1000,
      });
    } else if (method === 'Network.webSocketClosed') {
      const p = params as Protocol.Network.WebSocketClosedEvent;
      this.sendToBackend({
        source: 'electron',
        type: 'websocket_closed',
        requestId: p.requestId,
        time: Date.now() / 1000,
      });
    } else if (method === 'Network.webSocketFrameReceived') {
      this.handleWebSocketFrame(params as Protocol.Network.WebSocketFrameReceivedEvent, 'inbound');
    } else if (method === 'Network.webSocketFrameSent') {
      this.handleWebSocketFrame(params as Protocol.Network.WebSocketFrameSentEvent, 'outbound');
    } else if (method === 'Network.responseReceived') {
      await this.handleResponseReceived(params as Protocol.Network.ResponseReceivedEvent);
    }
  }

  private handleWebSocketFrame(
    params: Protocol.Network.WebSocketFrameReceivedEvent | Protocol.Network.WebSocketFrameSentEvent,
    direction: 'inbound' | 'outbound',
  ) {
    const { requestId, response } = params;

    let data = '';
    let opcode = -1;

    // Unified handling for both inbound and outbound frames
    // CDP puts payloadData inside the 'response' object for both events
    if (response && response.payloadData) {
      data = response.payloadData;
      opcode = response.opcode;
    } else {
      // Fallback: Check if payloadData is at the top level (older CDP or different backend)
      const p = params as unknown as Record<string, unknown>;
      if (typeof p.payloadData === 'string') {
        data = p.payloadData;
        opcode = typeof p.opcode === 'number' ? p.opcode : 2;
      } else {
        return;
      }
    }

    const payload = {
      source: 'electron',
      type: 'websocket',
      requestId: requestId,
      direction: direction,
      data: data, // Base64 string
      opcode: opcode,
      time: Date.now() / 1000,
    };

    this.sendToBackend(payload);
  }

  private async handleResponseReceived(params: Protocol.Network.ResponseReceivedEvent) {
    const { response } = params;

    if (response.url && response.url.includes('liqi.json')) {
      try {
        // Use fetch instead of CDP getResponseBody to avoid "No resource with given identifier" errors
        const res = await fetch(response.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        this.sendToBackend({
          source: 'electron',
          type: 'liqi_definition',
          data: text, // Send raw text (or JSON string)
          url: response.url,
        });
      } catch (e) {
        console.error('[GameHandler] Failed to fetch liqi.json manually:', e);
      }
    }
  }

  private sendToBackend(data: unknown) {
    fetch(this.BACKEND_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => {
      // Ignore errors
    });
  }
}
