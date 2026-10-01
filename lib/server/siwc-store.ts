import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { SiwcError, SIWC_ISSUER, objectValue, validClientId } from './siwc-protocol';

export interface SiwcTokens {
  access_token: string; refresh_token: string; id_token: string; scopes: string[];
  expires_at: number; refresh_expires_at: number; id_token_received_at: number; earliest_refresh_at?: string | number;
}
export interface SiwcRegistration extends SiwcTokens {
  version: 1; issuer: typeof SIWC_ISSUER; client_id: string; subject: string; received_at: number;
  model_available?: boolean; model_verified_at?: number;
  pending_refresh?: SiwcTokens & { received_at: number };
}
export interface SiwcHost { version: 1; host_id: string }
const execFileAsync = promisify(execFile);
const UUID_HOST = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validHostId(value: unknown): value is string { return typeof value === 'string' && UUID_HOST.test(value); }
function validTokens(input: unknown): SiwcTokens {
  const value = objectValue(input);
  const direct = Array.isArray(value.scopes) && value.scopes.includes('chatgpt.tokens.use.direct');
  for (const name of ['access_token', 'refresh_token', 'id_token']) {
    const token = value[name];
    if (typeof token !== 'string' || ((!token) && (direct || name === 'id_token')) || token.length > 32_000) throw new SiwcError('storage');
  }
  if (!Array.isArray(value.scopes) || value.scopes.some(scope => typeof scope !== 'string' || scope.length > 200)
    || typeof value.expires_at !== 'number' || !Number.isSafeInteger(value.expires_at) || value.expires_at < 0
    || typeof value.refresh_expires_at !== 'number' || !Number.isSafeInteger(value.refresh_expires_at) || value.refresh_expires_at < 0
    || typeof value.id_token_received_at !== 'number' || !Number.isSafeInteger(value.id_token_received_at) || value.id_token_received_at < 0
    || (value.earliest_refresh_at !== undefined && typeof value.earliest_refresh_at !== 'number' && typeof value.earliest_refresh_at !== 'string')) throw new SiwcError('storage');
  return value as unknown as SiwcTokens;
}
export function validateRegistration(input: unknown): SiwcRegistration {
  const value = objectValue(input); validTokens(value);
  if (value.version !== 1 || value.issuer !== SIWC_ISSUER || !validClientId(value.client_id)
    || typeof value.subject !== 'string' || !value.subject || value.subject.length > 500 || typeof value.received_at !== 'number'
    || !Number.isSafeInteger(value.received_at) || (value.model_available !== undefined && typeof value.model_available !== 'boolean')
    || (value.model_verified_at !== undefined && (typeof value.model_verified_at !== 'number' || !Number.isSafeInteger(value.model_verified_at)))) throw new SiwcError('storage');
  if (value.pending_refresh) {
    const pending = validTokens(value.pending_refresh) as SiwcTokens & { received_at?: unknown };
    if (typeof pending.received_at !== 'number' || !Number.isSafeInteger(pending.received_at)) throw new SiwcError('storage');
  }
  return value as unknown as SiwcRegistration;
}
function isMissing(error: unknown): boolean { return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'; }
async function checkWindowsAcl(path: string): Promise<void> {
  const encodedPath = Buffer.from(path, 'utf8').toString('base64');
  const script = '$ErrorActionPreference = "Stop"; ' +
    '$trainingPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' + encodedPath + '")); ' +
    '$trainingSid = [Security.Principal.WindowsIdentity]::GetCurrent().User; ' +
    '$trainingAcl = if ([IO.Directory]::Exists($trainingPath)) { [IO.Directory]::GetAccessControl($trainingPath) } else { [IO.File]::GetAccessControl($trainingPath) }; ' +
    '$trainingOwner = $trainingAcl.GetOwner([Security.Principal.SecurityIdentifier]); ' +
    'if ($trainingOwner.Value -ne $trainingSid.Value) { throw "owner"; }; ' +
    'foreach ($trainingRule in $trainingAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) { ' +
    'if ($trainingRule.AccessControlType -eq "Allow" -and $trainingRule.IdentityReference.Value -ne $trainingSid.Value) { throw "permission"; } }';
  try { await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15_000, maxBuffer: 16_000 }); }
  catch { throw new SiwcError('storage'); }
}
async function protectDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new SiwcError('storage');
  if (process.platform !== 'win32') { await chmod(path, 0o700); return; }
  // Replace the leaf directory's ACL with only the running Windows user's inheritable grant.
  // The encoded literal is a path, never a credential, and is not executable interpolation.
  const encodedPath = Buffer.from(path, 'utf8').toString('base64');
  const script = '$ErrorActionPreference = "Stop"; ' +
    '$trainingPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' + encodedPath + '")); ' +
    '$trainingSid = [Security.Principal.WindowsIdentity]::GetCurrent().User; ' +
    '$trainingAcl = New-Object Security.AccessControl.DirectorySecurity; ' +
    '$trainingAcl.SetOwner($trainingSid); $trainingAcl.SetAccessRuleProtection($true, $false); ' +
    '$trainingRule = New-Object Security.AccessControl.FileSystemAccessRule($trainingSid, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow"); ' +
    '$trainingAcl.AddAccessRule($trainingRule); [IO.Directory]::SetAccessControl($trainingPath, $trainingAcl)';
  try { await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15_000, maxBuffer: 16_000 }); }
  catch { throw new SiwcError('storage'); }
}
export class SiwcStore {
  readonly directory: string;
  private prepared?: Promise<void>;
  constructor(directory = process.env.TRAINING_SIWC_DIR || join(process.cwd(), '.data', 'siwc')) {
    this.directory = resolve(directory);
    if (this.directory === parse(this.directory).root || /[\0\r\n]/.test(this.directory) || !basename(this.directory)) throw new SiwcError('storage');
  }
  private file(name: string): string {
    if (!/^[a-z0-9.-]+$/.test(name)) throw new SiwcError('storage');
    const path = join(this.directory, name);
    if (dirname(path) !== this.directory) throw new SiwcError('storage');
    return path;
  }
  async prepare(): Promise<void> {
    this.prepared ??= (async () => { await mkdir(this.directory, { recursive: true, mode: 0o700 }); await protectDirectory(this.directory); })();
    try { await this.prepared; } catch { this.prepared = undefined; throw new SiwcError('storage'); }
  }
  private async read(name: string): Promise<unknown | undefined> {
    try {
      const dir = await lstat(this.directory);
      if (!dir.isDirectory() || dir.isSymbolicLink()) throw new SiwcError('storage');
      if (process.platform !== 'win32' && (dir.mode & 0o077) !== 0) throw new SiwcError('storage');
      const path = this.file(name); const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 256_000) throw new SiwcError('storage');
      if (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && info.uid !== process.getuid()))) throw new SiwcError('storage');
      if (process.platform === 'win32') { await checkWindowsAcl(this.directory); await checkWindowsAcl(path); }
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) { if (isMissing(error)) return; throw new SiwcError('storage'); }
  }
  private async atomic(name: string, data: unknown): Promise<void> {
    await this.prepare();
    const path = this.file(name); const temporary = this.file(name + '.' + randomUUID() + '.tmp');
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(data), 'utf8'); await handle.sync(); await handle.close(); handle = undefined;
      await rename(temporary, path);
      if (process.platform !== 'win32') await chmod(path, 0o600);
    } catch { throw new SiwcError('storage'); }
    finally { await handle?.close().catch(() => undefined); await unlink(temporary).catch(() => undefined); }
  }
  async host(): Promise<SiwcHost | undefined> {
    const value = await this.read('host.json'); if (!value) return;
    const host = objectValue(value);
    if (host.version !== 1 || !validHostId(host.host_id)) throw new SiwcError('storage');
    return host as unknown as SiwcHost;
  }
  async ensureHost(): Promise<SiwcHost> {
    return this.withLock(async () => {
      const current = await this.host(); if (current) return current;
      const host: SiwcHost = { version: 1, host_id: 'urn:uuid:' + randomUUID() };
      await this.atomic('host.json', host); return host;
    });
  }
  async registration(): Promise<SiwcRegistration | undefined> {
    const record = await this.read('credentials.json');
    return record === undefined ? undefined : validateRegistration(record);
  }
  async save(record: SiwcRegistration): Promise<void> { await this.atomic('credentials.json', validateRegistration(record)); }
  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.prepare();
    const path = this.file('session-lock.sqlite');
    try { const initial = await open(path, 'wx', 0o600); await initial.close(); }
    catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw new SiwcError('storage'); }
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new SiwcError('storage');
    if (process.platform !== 'win32') await chmod(path, 0o600);
    let db: DatabaseSync;
    try { db = new DatabaseSync(path); db.exec('PRAGMA busy_timeout=0'); }
    catch { throw new SiwcError('storage'); }
    const end = Date.now() + 45_000;
    try {
      while (true) {
        try { db.exec('BEGIN IMMEDIATE'); break; }
        catch (error) {
          const busy = error instanceof Error && /database is (?:locked|busy)/i.test(error.message);
          if (!busy) throw new SiwcError('storage');
          if (Date.now() >= end) throw new SiwcError('busy');
          await new Promise(resolveWait => setTimeout(resolveWait, 50));
        }
      }
      // SQLite coordinates separate Node processes and releases the lock after a crash.
      // This database stores no tokens. The token JSON replacement stays atomic.
      try { const result = await operation(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    } finally { db.close(); }
  }
}
export async function prepareVm(directory: string): Promise<SiwcHost> {
  const store = new SiwcStore(directory);
  try { await lstat(store.directory); throw new SiwcError('storage'); }
  catch (error) { if (!isMissing(error)) throw new SiwcError('storage'); }
  return store.ensureHost();
}
