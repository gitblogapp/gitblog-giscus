import { beforeEach, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
// Matches gitblog's versioned AES-GCM session contract.
function seal(value: unknown, secret: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
  cipher.setAAD(Buffer.from('gitblog-session-v1'));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
import { readSession } from './gitblog-session';
import handler from '../pages/api/gitblog/graphql';
import tokenHandler from '../pages/api/oauth/token';
import { ADD_DISCUSSION_COMMENT_QUERY } from '../services/github/addDiscussionComment';
import { ADD_DISCUSSION_REPLY_QUERY } from '../services/github/addDiscussionReply';
const mock = vi.hoisted(() => ({ app: vi.fn(), api: vi.fn() }));
vi.mock('../services/github/getAppAccessToken', () => ({
  getAppAccessToken: mock.app,
  githubJson: mock.api,
}));
const secret = 'x'.repeat(64);
const ticket = () =>
  seal(
    { repo: 'owner/blog', token: 'ghu_private', expires: Date.now() + 60000 },
    `${secret}:giscus-fork:v1`,
  );
function response() {
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}
function request(query: string, variables: unknown) {
  return {
    method: 'POST',
    headers: {
      origin: 'https://gitblog.app',
      'content-type': 'application/json',
      authorization: `Bearer ${ticket()}`,
    },
    body: { query, variables },
  } as NextApiRequest;
}
beforeEach(() => {
  process.env.AUTH_SECRET = secret;
  vi.clearAllMocks();
  mock.app.mockResolvedValue('installation_readonly');
  mock.api.mockResolvedValue({
    data: {
      node: { __typename: 'Discussion', id: 'D1', repository: { nameWithOwner: 'owner/blog' } },
    },
  });
});
it('accepts the main service seal format but rejects expired, modified and cross-repo tickets', () => {
  const t = ticket();
  expect(readSession(t, 'owner/blog').token).toBe('ghu_private');
  expect(() => readSession(t, 'other/blog')).toThrow();
  expect(() => readSession(t.slice(0, -4) + 'xxxx')).toThrow();
  expect(() =>
    readSession(
      seal({ repo: 'owner/blog', token: 'ghu_private', expires: 0 }, `${secret}:giscus-fork:v1`),
    ),
  ).toThrow();
});
it('returns an opaque ticket rather than a GitHub credential', async () => {
  const t = ticket(),
    res = response();
  await tokenHandler(
    {
      method: 'POST',
      headers: { origin: 'https://gitblog.app', 'content-type': 'application/json' },
      body: { session: t },
    } as NextApiRequest,
    res as unknown as NextApiResponse,
  );
  expect(res.json).toHaveBeenCalledWith({ token: t });
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('ghu_private');
});
it('rejects arbitrary GraphQL operations before reaching GitHub', async () => {
  const res = response();
  await handler(request('mutation { deleteRepository }', {}), res as unknown as NextApiResponse);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(mock.api).not.toHaveBeenCalled();
});
it('rejects foreign repository nodes and replies to a different discussion', async () => {
  mock.api.mockResolvedValueOnce({
    data: {
      node: { __typename: 'Discussion', id: 'D1', repository: { nameWithOwner: 'other/blog' } },
    },
  });
  let res = response();
  await handler(
    request(ADD_DISCUSSION_COMMENT_QUERY, { discussionId: 'D1', body: 'text' }),
    res as unknown as NextApiResponse,
  );
  expect(res.status).toHaveBeenCalledWith(403);
  expect(mock.api).toHaveBeenCalledTimes(1);
  mock.api
    .mockResolvedValueOnce({
      data: {
        node: { __typename: 'Discussion', id: 'D1', repository: { nameWithOwner: 'owner/blog' } },
      },
    })
    .mockResolvedValueOnce({
      data: {
        node: {
          __typename: 'DiscussionComment',
          discussion: { id: 'D2', repository: { nameWithOwner: 'owner/blog' } },
        },
      },
    });
  res = response();
  await handler(
    request(ADD_DISCUSSION_REPLY_QUERY, { discussionId: 'D1', replyToId: 'C1', body: 'text' }),
    res as unknown as NextApiResponse,
  );
  expect(res.status).toHaveBeenCalledWith(403);
});
it('forwards a valid comment with the user credential only after node validation', async () => {
  const res = response();
  await handler(
    request(ADD_DISCUSSION_COMMENT_QUERY, { discussionId: 'D1', body: 'text' }),
    res as unknown as NextApiResponse,
  );
  expect(mock.api.mock.calls[0][1]).toBe('installation_readonly');
  expect(mock.api.mock.calls[1][1]).toBe('ghu_private');
  expect(res.status).not.toHaveBeenCalled();
});
it('rejects cross-origin writes', async () => {
  const req = request(ADD_DISCUSSION_COMMENT_QUERY, { discussionId: 'D1', body: 'text' });
  req.headers.origin = 'https://evil.example';
  const res = response();
  await handler(req, res as unknown as NextApiResponse);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(mock.app).not.toHaveBeenCalled();
});
