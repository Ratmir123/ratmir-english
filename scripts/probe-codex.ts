import { BRAIN_MODEL, closeCodexBridge, codexJson, getBrainStatus } from '../lib/server/codex';

async function main() {
  const status = await getBrainStatus();
  console.log(JSON.stringify({ stage: 'status', ...status }, null, 2));
  if (!status.connected || !status.authenticated || !status.modelAvailable) {
    process.exitCode = 1;
    return;
  }
  const started = Date.now();
  const result = await codexJson<{ ok: boolean; message: string }>(
    'This is a minimal authorized connectivity probe. Return exactly an object with ok=true and message="Subscription bridge works". Do not use any tools.',
    { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } }, required: ['ok', 'message'], additionalProperties: false },
    'low',
  );
  if (result.ok !== true || result.message !== 'Subscription bridge works') throw new Error('Probe result did not match the requested schema and expected values.');
  console.log(JSON.stringify({ stage: 'inference', model: BRAIN_MODEL, verified: true, elapsedMs: Date.now() - started, result }, null, 2));
  console.log(JSON.stringify({ stage: 'verified_status', ...(await getBrainStatus()) }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ stage: 'failed', error: error instanceof Error ? error.message : 'Codex probe failed' }));
  process.exitCode = 1;
}).finally(() => closeCodexBridge());
