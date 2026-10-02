import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

export function authorizedVoiceRequest(req, code, publicOrigin) {
  if (!code || !publicOrigin) return false;
  try {
    const address = new URL(req.url, publicOrigin);
    if (address.pathname !== '/api/audio/live-stream' || address.search) return false;
    const origin = req.headers.origin;
    if (origin && origin !== new URL(publicOrigin).origin) return false;
    const received = /(?:^|;\s*)training-access=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    const expected = createHash('sha256').update(`training-local:${code}`).digest('hex');
    if (!received || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) return false;
    return /^Bearer ek_[A-Za-z0-9_-]{10,2048}$/.test(req.headers.authorization || '');
  } catch { return false; }
}

/** Limit this relay to learner transcription; it is not an open API proxy. */
export function permittedVoiceEvent(event) {
  if (!event || typeof event !== 'object') return false;
  if (event.type === 'session.update') {
    const input = event.session?.audio?.input;
    return event.session?.type === 'transcription' && input?.transcription?.model === 'gpt-live-transcribe'
      && input?.format?.type === 'audio/pcm' && input.format.rate === 24000 && input.turn_detection === null;
  }
  if (['input_audio_buffer.commit', 'input_audio_buffer.clear'].includes(event.type)) return true;
  return event.type === 'input_audio_buffer.append' && typeof event.audio === 'string'
    && event.audio.length <= 160000 && /^[A-Za-z0-9+/=]+$/.test(event.audio);
}

export function transcriptionEvent(event) {
  if (!permittedVoiceEvent(event)) return null;
  if (event.type === 'session.update') {
    const config = event.session.audio.input.transcription;
    return { type: 'session.update', session: { type: 'transcription', audio: { input: {
      format: { type: 'audio/pcm', rate: 24000 }, turn_detection: null,
      transcription: { model: 'gpt-live-transcribe', languages: ['en', 'ru'], delay: 'low',
        ...(typeof config.prompt === 'string' && config.prompt.length <= 2500 ? { prompt: config.prompt } : {}) },
    } } } };
  }
  return event.type === 'input_audio_buffer.append' ? { type: event.type, audio: event.audio } : { type: event.type };
}

export function startVoiceRelay({ port = 3001, code = process.env.TRAINING_ACCESS_CODE, publicOrigin = process.env.TRAINING_PUBLIC_ORIGIN } = {}) {
  const server = createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 426, { 'Content-Type': 'text/plain' });
    res.end(req.url === '/health' ? 'ready' : 'WebSocket connection required');
  });
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false });
  const clients = new Set();
  server.on('upgrade', (req, socket, head) => {
    if (!authorizedVoiceRequest(req, code, publicOrigin)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    websocketServer.handleUpgrade(req, socket, head, client => {
      clients.add(client);
      const upstream = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
        headers: { Authorization: req.headers.authorization }, handshakeTimeout: 12000,
        maxPayload: 2 * 1024 * 1024, perMessageDeflate: false,
      });
      const waiting = [];
      let waitingBytes = 0;
      let audioBytes = 0;
      let finalized = false;
      const expiry = setTimeout(() => close(1000, 'Recording time limit reached'), 9 * 60000);
      const close = (status = 1011, reason = 'Live transcription connection ended') => {
        if (finalized) return;
        finalized = true;
        clearTimeout(expiry);
        clients.delete(client);
        if (client.readyState === WebSocket.OPEN) client.close(status, reason);
        else client.terminate();
        upstream.terminate();
      };
      const forward = data => {
        if (upstream.bufferedAmount > 4 * 1024 * 1024) { close(1013, 'Connection is too slow'); return; }
        upstream.send(data, error => { if (error) close(); });
      };
      upstream.on('open', () => { for (const data of waiting) forward(data); waiting.length = 0; waitingBytes = 0; });
      client.on('message', (bytes, binary) => {
        if (binary) { close(1008, 'JSON events required'); return; }
        let event;
        try { event = JSON.parse(bytes.toString()); } catch { close(1008, 'Invalid event'); return; }
        const permitted = transcriptionEvent(event);
        if (!permitted) { close(1008, 'Transcription events only'); return; }
        if (permitted.type === 'input_audio_buffer.append') {
          audioBytes += Buffer.from(permitted.audio, 'base64').length;
          if (audioBytes > 8 * 60 * 24000 * 2) { close(1008, 'Recording time limit reached'); return; }
        }
        const encoded = JSON.stringify(permitted);
        if (upstream.readyState === WebSocket.OPEN) forward(encoded);
        else if (upstream.readyState === WebSocket.CONNECTING && waitingBytes + encoded.length <= 512000) {
          waiting.push(encoded); waitingBytes += encoded.length;
        } else close(1013, 'Connection is not ready');
      });
      upstream.on('message', (bytes, binary) => {
        if (binary || client.readyState !== WebSocket.OPEN) return;
        if (client.bufferedAmount > 4 * 1024 * 1024) { close(1013, 'Connection is too slow'); return; }
        client.send(bytes.toString(), error => { if (error) close(); });
      });
      // Provider payloads and credentials must never be logged.
      upstream.on('error', () => close());
      upstream.on('close', () => close());
      client.on('error', () => close());
      client.on('close', () => close(1000));
    });
  });
  let settleReady, rejectReady, fail;
  let readySettled = false;
  let closing = false;
  const ready = new Promise((resolve, reject) => { settleReady = resolve; rejectReady = reject; });
  const failed = new Promise(resolve => { fail = resolve; });
  // Callers await ready before spawning the application. A handled listener error
  // must not become an uncaught exception that leaves its child server behind.
  void ready.catch(() => undefined);
  server.once('listening', () => { readySettled = true; settleReady(server.address()); });
  server.on('error', error => {
    if (!readySettled) { readySettled = true; rejectReady(error); }
    fail(error);
  });
  server.listen(port, '0.0.0.0');
  return { ready, failed, close() {
    if (closing) return;
    closing = true;
    if (!readySettled) { readySettled = true; rejectReady(new Error('Voice relay stopped before listening')); }
    for (const client of clients) client.close(1001, 'Server restarting');
    websocketServer.close(); server.close();
  } };
}
