import type { GetServerSidePropsContext } from 'next';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../components/Widget', () => ({ default: () => null }));
vi.mock('../lib/jwt', () => ({ getJWT: () => 'app-jwt' }));

const fetchMock = vi.fn();
let render: typeof import('../pages/widget').getServerSideProps;
let repoConfig: Record<string, unknown>;
let installationStatus: number;
let publicStatus: number;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('GITHUB_APP_ID', '123');
  repoConfig = {};
  installationStatus = 200;
  publicStatus = 200;
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/installation'))
      return Response.json(
        { id: 42, app_id: 123, permissions: { discussions: 'write' } },
        { status: installationStatus },
      );
    if (url.endsWith('/access_tokens'))
      return Response.json({
        token: 'private-server-token',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    if (url.endsWith('/contents/giscus.json'))
      return Response.json({ content: Buffer.from(JSON.stringify(repoConfig)).toString('base64') });
    return Response.json(
      {
        private: false,
        archived: false,
        has_discussions: true,
        full_name: 'owner/blog',
        owner: { login: 'owner' },
        homepage: 'https://blog.example',
      },
      { status: publicStatus },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  render = (await import('../pages/widget')).getServerSideProps;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function context(origin = 'https://blog.example/post') {
  return {
    query: { repo: 'owner/blog', origin, term: 'post' },
    res: { setHeader: vi.fn() },
  } as unknown as GetServerSidePropsContext;
}

it('renders with four cold / three warm GitHub calls and keeps the token server-side', async () => {
  const first = await render(context());
  expect(first).toHaveProperty('props.repo', 'owner/blog');
  expect(JSON.stringify(first)).not.toContain('private-server-token');
  expect(fetchMock).toHaveBeenCalledTimes(4);
  fetchMock.mockClear();
  const second = await render(context());
  expect(second).toHaveProperty('props.repo', 'owner/blog');
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    'https://api.github.com/repos/owner/blog/installation',
    'https://api.github.com/repos/owner/blog',
    'https://api.github.com/repos/owner/blog/contents/giscus.json',
  ]);
});

it('still rejects origins outside the repository homepage, Pages host and GitBlog', async () => {
  const ctx = context('https://evil.example/post');
  expect(await render(ctx)).toEqual({ notFound: true });
  expect(ctx.res.setHeader).toHaveBeenCalledWith(
    'Content-Security-Policy',
    "frame-ancestors 'none'",
  );
});

it('still enforces giscus.json origin restrictions with a warm token', async () => {
  await render(context());
  repoConfig = { origins: ['https://elsewhere.example'] };
  const ctx = context();
  expect(await render(ctx)).toHaveProperty('redirect');
  expect(ctx.res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
});

it('renders actionable setup guidance instead of a 500 when the App lacks repository access', async () => {
  installationStatus = 404;
  const ctx = context('https://owner.github.io/blog/post');
  ctx.locale = 'ko';
  const result = await render(ctx);
  expect(result).toHaveProperty('props.setupIssue', 'installation');
  expect(result).toHaveProperty('props.language', 'ko');
  expect(ctx.res.statusCode).toBe(403);
  expect(ctx.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  expect(ctx.res.setHeader).toHaveBeenCalledWith(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://owner.github.io;",
  );
  expect(JSON.stringify(result)).not.toMatch(/app-jwt|private-server-token/);
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/access_tokens'))).toBe(false);
  const publicCall = fetchMock.mock.calls.find(
    ([url]) => url === 'https://api.github.com/repos/owner/blog',
  );
  expect(publicCall?.[1].headers.Authorization).toBeUndefined();
});

it('does not weaken origin restrictions for setup guidance', async () => {
  installationStatus = 404;
  expect(await render(context('https://evil.example'))).toEqual({ notFound: true });
  repoConfig = { origins: ['https://elsewhere.example'] };
  expect(await render(context())).toHaveProperty('redirect');
});

it('does not expose setup details for an inaccessible repository', async () => {
  installationStatus = 404;
  publicStatus = 404;
  expect(await render(context())).toEqual({ notFound: true });
});

it('recovers after the owner grants the App access without caching the failed setup', async () => {
  installationStatus = 404;
  expect(await render(context())).toHaveProperty('props.setupIssue', 'installation');
  installationStatus = 200;
  expect(await render(context())).toHaveProperty('props.setupIssue', null);
});
