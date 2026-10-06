import type { NextApiRequest, NextApiResponse } from 'next';
import { sessionFrom, requireSameOrigin } from '../../../lib/gitblog-session';
import { getAppAccessToken } from '../../../services/github/getAppAccessToken';
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    requireSameOrigin(req);
    const session = sessionFrom(req);
    await getAppAccessToken(session.repo);
    const input = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (typeof input.text !== 'string' || input.text.length > 10000) throw new Error();
    const response = await fetch('https://api.github.com/markdown', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'gitblog',
      },
      body: JSON.stringify({ text: input.text, mode: 'gfm', context: session.repo }),
    });
    if (!response.ok) throw new Error();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(await response.text());
  } catch {
    res.status(403).send('Unable to preview Markdown.');
  }
}
export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };
