import { afterEach, expect, it, vi } from 'vitest';
import { BookmarkError, updateBookmark } from './bookmarks';
afterEach(() => vi.unstubAllGlobals());
it('uses the existing opaque comment ticket without sending a cookie or user identity', async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ saved: true }));
  vi.stubGlobal('fetch', request);
  expect(
    await updateBookmark('opaque', 'owner/blog', 'giscus-post-1234567890abcdef', 'ko', 'save'),
  ).toBe(true);
  expect(request).toHaveBeenCalledWith(
    '/v1/reader/bookmarks',
    expect.objectContaining({
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer opaque' },
      body: JSON.stringify({
        repo: 'owner/blog',
        term: 'giscus-post-1234567890abcdef',
        locale: 'ko',
        action: 'save',
      }),
    }),
  );
});
it.each([401, 404, 429, 503])(
  'preserves status %i for reconnect, indexing and retry UI',
  async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
    await expect(updateBookmark('ticket', 'owner/blog', 'term', 'en', 'status')).rejects.toEqual(
      new BookmarkError(status),
    );
  },
);
it('does not treat malformed success responses as saved', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})));
  await expect(updateBookmark('ticket', 'owner/blog', 'term', 'en', 'save')).rejects.toMatchObject({
    status: 502,
  });
});
