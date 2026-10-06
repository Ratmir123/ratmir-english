import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const BROWSER_PROTOCOL = 'realtime-transcription';
const EPHEMERAL_PROTOCOL_PREFIX = 'openai-insecure-api-key.';
const EPHEMERAL_TOKEN = /^ek_[A-Za-z0-9_-]{10,2048}$/;
const PENDING_UPSTREAM_BYTES = 2 * 1024 * 1024;

function voiceRequestCredential(req, code, publicOrigin) {
  if (!code || !publicOrigin) return null;
  try {
    // Credentials never belong in URLs. Accept only this exact relative path.
    if (req.url !== '/api/audio/live-stream') return null;
    const configuredOrigin = new URL(publicOrigin);
    if (configuredOrigin.protocol !== 'https:') return null;
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== configuredOrigin.origin) return null;
    // Node may discard duplicate Authorization fields; inspect raw headers too.
    for (const header of ['authorization', 'sec-websocket-protocol', 'origin']) {
      if (req.rawHeaders?.filter((value, index) => index % 2 === 0 && value.toLowerCase() === header).length > 1) return null;
    }
    const cookies = typeof req.headers.cookie === 'string'
      ? [...req.headers.cookie.matchAll(/(?:^|;\s*)training-access=([^;]*)/g)] : [];
    if (cookies.length !== 1 || !/^[a-f0-9]{64}$/.test(cookies[0][1])) return null;
    const received = cookies[0][1];
    const expected = createHash('sha256').update(`training-local:${code}`).digest('hex');
    if (!timingSafeEqual(Buffer.from(received), Buffer.from(expected))) return null;
    const authorization = req.headers.authorization;
    const offered = req.headers['sec-websocket-protocol'];
    // A native header and a browser protocol are mutually exclusive channels.
    if (authorization !== undefined) {
      if (offered !== undefined || typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;
      return EPHEMERAL_TOKEN.test(authorization.slice(7)) ? authorization : null;
    }
    // Browsers cannot set Authorization. Require the same-origin app cookie and
    // an explicit matching Origin before reading their short-lived credential.
    if (origin !== configuredOrigin.origin || typeof offered !== 'string' || offered.length > 2200) return null;
    const protocols = offered.split(',').map(value => value.trim());
    if (protocols.length !== 2 || new Set(protocols).size !== 2 || !protocols.includes(BROWSER_PROTOCOL)) return null;
    const tokenProtocol = protocols.find(value => value !== BROWSER_PROTOCOL);
    if (!tokenProtocol.startsWith(EPHEMERAL_PROTOCOL_PREFIX)) return null;
    const token = tokenProtocol.slice(EPHEMERAL_PROTOCOL_PREFIX.length);
    return EPHEMERAL_TOKEN.test(token) ? `Bearer ${token}` : null;
  } catch { return null; }
}

export function authorizedVoiceRequest(req, code, publicOrigin) {
  return voiceRequestCredential(req, code, publicOrigin) !== null;
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
    // The relay decides the delay for every client (web, iPhone): 'minimal' shows the learner's words almost at once.
    return { type: 'session.update', session: { type: 'transcription', audio: { input: {
      format: { type: 'audio/pcm', rate: 24000 }, turn_detection: null,
      transcription: { model: 'gpt-live-transcribe', languages: ['en', 'ru'], delay: 'minimal',
        ...(typeof config.prompt === 'string' && config.prompt.length <= 2500 ? { prompt: config.prompt } : {}) },
    } } } };
  }
  return event.type === 'input_audio_buffer.append' ? { type: event.type, audio: event.audio } : { type: event.type };
}

export function startVoiceRelay({ port = 3001, code = process.env.TRAINING_ACCESS_CODE, publicOrigin = process.env.TRAINING_PUBLIC_ORIGIN,
  upstreamFactory = (url, options) => new WebSocket(url, options) } = {}) {
  const server = createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 426, { 'Content-Type': 'text/plain' });
    res.end(req.url === '/health' ? 'ready' : 'WebSocket connection required');
  });
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false,
    // Never echo the offered credential in Sec-WebSocket-Protocol.
    handleProtocols: protocols => protocols.has(BROWSER_PROTOCOL) ? BROWSER_PROTOCOL : false });
  const clients = new Set();
  server.on('upgrade', (req, socket, head) => {
    const authorization = voiceRequestCredential(req, code, publicOrigin);
    if (!authorization) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    websocketServer.handleUpgrade(req, socket, head, client => {
      clients.add(client);
      const upstream = upstreamFactory('wss://api.openai.com/v1/realtime?intent=transcription', {
        // Only our validated ephemeral goes upstream; no app cookie, Origin,
        // incoming protocol field, arbitrary header or persistent key is copied.
        headers: { Authorization: authorization }, handshakeTimeout: 12000,
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
        // Clients connect in parallel with the microphone and flush audio queued meanwhile: hold up to ~2 MB
        // (the browser queues at most 20 s of PCM ≈ 1.3 MB as base64) while the provider connection opens.
        else if (upstream.readyState === WebSocket.CONNECTING && waitingBytes + encoded.length <= PENDING_UPSTREAM_BYTES) {
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
