import type { NextApiRequest, NextApiResponse } from 'next';
import { readSession, requireSameOrigin } from '../../../lib/gitblog-session';
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    requireSameOrigin(req);
    readSession(req.body?.session);
    res.json({ token: req.body.session });
  } catch {
    res.status(401).json({ error: 'State has expired. Please sign in again.' });
  }
}
