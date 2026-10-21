import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../lib/jwt', () => ({ getJWT: () => 'app-jwt' }));

let access: typeof import('./getAppAccessToken');
let installation: Record<string, unknown>;
let metadata: Record<string, unknown>;
let expiresAt: string;
let metadataStatus: number;
let issued: number;
const fetchMock = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
  vi.stubEnv('GITHUB_APP_ID', '123');
  installation = { id: 42, app_id: 123, permissions: { discussions: 'write' } };
  metadata = {
    private: false,
    archived: false,
    has_discussions: true,
    full_name: 'owner/blog',
    owner: { login: 'owner' },
    homepage: 'https://blog.example',
  };
  expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  metadataStatus = 200;
  issued = 0;
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/installation')) return Response.json(installation);
    if (url.endsWith('/access_tokens'))
      return Response.json({ token: `token-${++issued}`, expires_at: expiresAt });
    return Response.json(metadata, { status: metadataStatus });
  });
  vi.stubGlobal('fetch', fetchMock);
  access = await import('./getAppAccessToken');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('reuses a credential while rechecking installation and repository on every request', async () => {
  expect(await access.getAppAccess('Owner/Blog')).toEqual({ token: 'token-1', metadata });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  fetchMock.mockClear();
  expect(await access.getAppAccessToken('owner/blog')).toBe('token-1');
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    'https://api.github.com/repos/owner/blog/installation',
    'https://api.github.com/repos/owner/blog',
  ]);
});

it('keeps repository and read/write credentials separate', async () => {
  expect(await access.getAppAccessToken('owner/blog')).toBe('token-1');
  expect(await access.getAppAccessToken('owner/blog', true)).toBe('token-2');
  metadata.full_name = 'owner/other';
  expect(await access.getAppAccessToken('owner/other')).toBe('token-3');
  metadata.full_name = 'owner/blog';
  expect(await access.getAppAccessToken('owner/blog')).toBe('token-1');
  const bodies = fetchMock.mock.calls
    .filter(([url]) => url.endsWith('/access_tokens'))
    .map(([, init]) => JSON.parse(init.body));
  expect(bodies).toEqual([
    {
      repositories: ['blog'],
      permissions: { discussions: 'read', contents: 'read', metadata: 'read' },
    },
    {
      repositories: ['blog'],
      permissions: { discussions: 'write', contents: 'read', metadata: 'read' },
    },
    {
      repositories: ['other'],
      permissions: { discussions: 'read', contents: 'read', metadata: 'read' },
    },
  ]);
});

it('does not reuse credentials after installation or App changes', async () => {
  await access.getAppAccessToken('owner/blog');
  installation.id = 43;
  expect(await access.getAppAccessToken('owner/blog')).toBe('token-2');
  vi.stubEnv('GITHUB_APP_ID', '456');
  installation.app_id = 456;
  expect(await access.getAppAccessToken('owner/blog')).toBe('token-3');
});

it('refreshes credentials one minute before expiry', async () => {
  await access.getAppAccessToken('owner/blog');
  vi.advanceTimersByTime(3_540_000);
  expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  expect(await access.getAppAccessToken('owner/blog')).toBe('token-2');
});

it.each(['invalid', '2026-10-15T00:00:00Z', undefined])(
  'does not cache credentials with unusable expiry %s',
  async (expiry) => {
    expiresAt = expiry;
    await access.getAppAccessToken('owner/blog');
    expect(await access.getAppAccessToken('owner/blog')).toBe('token-2');
  },
);

it.each([
  { suspended_at: '2026-10-16' },
  { app_id: 456 },
  { permissions: { discussions: 'read' } },
])('rejects changed installation access even with a warm cache: %j', async (change) => {
  await access.getAppAccessToken('owner/blog');
  Object.assign(installation, change);
  fetchMock.mockClear();
  await expect(access.getAppAccessToken('owner/blog')).rejects.toThrow('Install the gitblog App');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  { private: true },
  { archived: true },
  { has_discussions: false },
  { full_name: 'owner/other' },
])('rejects changed repository access and discards its token: %j', async (change) => {
  await access.getAppAccessToken('owner/blog');
  const original = { ...metadata };
  Object.assign(metadata, change);
  await expect(access.getAppAccessToken('owner/blog')).rejects.toThrow('public, active');
  metadata = original;
  expect(await access.getAppAccessToken('owner/blog')).toBe('token-2');
});

it('discards rejected credentials so a subsequent request can recover', async () => {
  await access.getAppAccessToken('owner/blog');
  metadataStatus = 401;
  await expect(access.getAppAccessToken('owner/blog')).rejects.toThrow('(401)');
  metadataStatus = 200;
  expect(await access.getAppAccessToken('owner/blog')).toBe('token-2');
});

it('rejects invalid repository input before contacting GitHub', async () => {
  await expect(access.getAppAccessToken('owner/blog/extra')).rejects.toThrow('Invalid repository');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('bounds the token cache and evicts least recently used credentials', async () => {
  const { TokenCache } = await import('../cache');
  for (let i = 0; i < 256; i++)
    TokenCache.set(String(i), { token: String(i), expires_at: expiresAt });
  expect(TokenCache.get('0')?.token).toBe('0');
  TokenCache.set('new', { token: 'new', expires_at: expiresAt });
  expect(TokenCache.get('1')).toBeUndefined();
  expect(TokenCache.get('0')?.token).toBe('0');
  expect(TokenCache.get('new')?.token).toBe('new');
});

it('classifies a missing installation without issuing a token', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ message: 'Not Found' }, { status: 404 }));
  await expect(access.getAppAccess('owner/blog')).rejects.toMatchObject({ issue: 'installation' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([401, 429, 500])(
  'does not misreport GitHub %s as a missing installation',
  async (status) => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status }));
    await expect(access.getAppAccess('owner/blog')).rejects.toMatchObject({ status });
  },
);

it('isolates Pages-read credentials from ordinary comment credentials', async () => {
  installation.permissions = { discussions: 'write', pages: 'write' };
  expect((await access.getAppAccess('owner/blog')).token).toBe('token-1');
  expect((await access.getAppAccess('owner/blog', false, true)).token).toBe('token-2');
  const init = fetchMock.mock.calls.filter(([url]) => url.endsWith('/access_tokens'))[1][1];
  expect(JSON.parse(init.body)).toEqual({
    repositories: ['blog'],
    permissions: { discussions: 'read', contents: 'read', metadata: 'read', pages: 'read' },
  });
  expect((await access.getAppAccess('owner/blog')).token).toBe('token-1');
  expect((await access.getAppAccess('owner/blog', false, true)).token).toBe('token-2');
});
