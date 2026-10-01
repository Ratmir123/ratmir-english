// Check only public static metadata. A health probe must never call a model,
// read personal API state or unlock/start the private analysis queue.
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);
try {
  const response = await fetch('http://127.0.0.1:3000/manifest.webmanifest', {
    signal: controller.signal,
    redirect: 'error',
  });
  const manifest = await response.json();
  if (!response.ok || typeof manifest.name !== 'string' || manifest.display !== 'standalone') {
    throw new Error('unhealthy');
  }
} catch {
  // No response body, headers, environment or credentials are printed.
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
