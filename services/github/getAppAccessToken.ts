import { getJWT } from '../../lib/jwt';
export async function githubJson(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'gitblog',
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}).`);
  return response.json();
}
export function validRepo(repo: string) {
  if (!/^[a-zA-Z0-9-]{1,39}\/[a-zA-Z0-9_.-]{1,100}$/.test(repo))
    throw new Error('Invalid repository.');
  return repo.toLowerCase();
}
export async function getAppAccessToken(repoWithOwner: string, writable = false): Promise<string> {
  const repo = validRepo(repoWithOwner);
  const jwt = getJWT();
  const installation = await githubJson(`/repos/${repo}/installation`, jwt);
  if (
    installation.suspended_at ||
    String(installation.app_id) !== process.env.GITHUB_APP_ID ||
    installation.permissions?.discussions !== 'write'
  )
    throw new Error('Install the gitblog App with Discussions access.');
  const credential = await githubJson(`/app/installations/${installation.id}/access_tokens`, jwt, {
    method: 'POST',
    body: JSON.stringify({
      repositories: [repo.split('/')[1]],
      permissions: { discussions: writable ? 'write' : 'read', contents: 'read', metadata: 'read' },
    }),
  });
  const metadata = await githubJson(`/repos/${repo}`, credential.token);
  if (
    metadata.private ||
    metadata.archived ||
    !metadata.has_discussions ||
    metadata.full_name.toLowerCase() !== repo
  )
    throw new Error('A public, active Discussions repository is required.');
  return credential.token;
}
