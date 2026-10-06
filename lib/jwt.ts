import { sign } from 'node:crypto';
export function getJWT() {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 60, exp: now + 540, iss: process.env.GITHUB_APP_ID })}`;
  return `${payload}.${sign('RSA-SHA256', Buffer.from(payload), process.env.GITHUB_PRIVATE_KEY).toString('base64url')}`;
}
