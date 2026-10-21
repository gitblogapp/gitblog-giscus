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
  expect(publicCall).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
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

it('can show a data-free Pages setup notice when anonymous GitHub reads are unavailable', async () => {
  installationStatus = 404;
  publicStatus = 403;
  const ctx = context('https://owner.github.io/blog/post');
  expect(await render(ctx)).toHaveProperty('props.setupIssue', 'installation');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(['one.gitblog.page', 'blog.personal.example'])(
  'allows the verified Pages domain %s with empty Website',
  async (hostname) => {
    const previous = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, ...args: unknown[]) => {
      if (url.endsWith('/pages'))
        return Response.json({
          cname: hostname,
          html_url: `https://${hostname}/`,
          protected_domain_state: 'verified',
          https_enforced: true,
          https_certificate: { state: 'approved' },
        });
      const result = await previous(url, ...args);
      if (url.endsWith('/repos/owner/blog'))
        return Response.json({ ...(await result.json()), homepage: null });
      return result;
    });
    const ctx = context(`https://${hostname}/blog/post`);
    expect(await render(ctx)).toHaveProperty('props.repo', 'owner/blog');
    expect(ctx.res.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      `frame-ancestors 'self' https://${hostname};`,
    );
    for (const origin of [
      'https://two.gitblog.page',
      `https://${hostname}.evil.example`,
      `http://${hostname}`,
      `https://${hostname}:444`,
    ]) {
      expect(await render(context(origin))).toEqual({ notFound: true });
    }
    repoConfig = { origins: ['https://elsewhere.example'] };
    expect(await render(ctx)).toHaveProperty('redirect');
  },
);

it.each([
  { cname: 'other.gitblog.page' },
  { protected_domain_state: 'unverified' },
  { https_enforced: false },
  { https_certificate: { state: 'pending' } },
  { html_url: 'https://other.gitblog.page/' },
])('rejects a stale or unready Pages assignment: %j', async (change) => {
  const previous = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, ...args: unknown[]) =>
    url.endsWith('/pages')
      ? Response.json({
          cname: 'one.gitblog.page',
          html_url: 'https://one.gitblog.page/',
          protected_domain_state: 'verified',
          https_enforced: true,
          https_certificate: { state: 'approved' },
          ...change,
        })
      : previous(url, ...args),
  );
  expect(await render(context('https://one.gitblog.page'))).toEqual({ notFound: true });
});

it('fails closed if Pages lookup is unavailable', async () => {
  const previous = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, ...args: unknown[]) =>
    url.endsWith('/pages') ? Response.json({}, { status: 503 }) : previous(url, ...args),
  );
  expect(await render(context('https://one.gitblog.page'))).toEqual({ notFound: true });
});
