import { createDecipheriv, createHash } from 'node:crypto';
import type { NextApiRequest } from 'next';
export type CommentSession = { token: string; repo: string; expires: number };
export function readSession(value: string, repo?: string): CommentSession {
  try {
    if (!process.env.AUTH_SECRET || value.length > 12000) throw new Error();
    const bytes = Buffer.from(value, 'base64url');
    const key = createHash('sha256').update(`${process.env.AUTH_SECRET}:giscus-fork:v1`).digest();
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from('gitblog-session-v1'));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const payload = JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(),
    );
    if (
      !payload.token?.startsWith('ghu_') ||
      !Number.isFinite(payload.expires) ||
      payload.expires <= Date.now() ||
      !payload.repo ||
      (repo && payload.repo !== repo.toLowerCase())
    )
      throw new Error();
    return payload;
  } catch {
    throw new Error('State has expired. Please sign in again.');
  }
}
export function sessionFrom(req: NextApiRequest, repo?: string) {
  return readSession(req.headers.authorization?.replace(/^Bearer /, '') || '', repo);
}
export function requireSameOrigin(req: NextApiRequest) {
  if (
    req.headers.origin !== 'https://gitblog.app' ||
    req.method !== 'POST' ||
    !req.headers['content-type']?.startsWith('application/json')
  )
    throw new Error('Invalid request origin.');
}
