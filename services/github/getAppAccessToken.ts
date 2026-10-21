import { getJWT } from '../../lib/jwt';
import { TokenCache } from '../cache';

export interface RepositoryMetadata {
  private: boolean;
  archived: boolean;
  has_discussions: boolean;
  full_name: string;
  owner: { login: string };
  homepage?: string;
}

export class GitHubRequestError extends Error {
  constructor(public status: number) {
    super(`GitHub request failed (${status}).`);
  }
}

export type CommentSetupIssue = 'installation' | 'permissions' | 'repository';
export class CommentSetupError extends Error {
  constructor(
    public issue: CommentSetupIssue,
    message: string,
  ) {
    super(message);
  }
}

export async function getPublicRepository(repoWithOwner: string): Promise<RepositoryMetadata> {
  const repo = validRepo(repoWithOwner);
  const metadata = await githubJson(`/repos/${repo}`, '');
  if (metadata.private || metadata.full_name?.toLowerCase() !== repo)
    throw new Error('A public repository is required.');
  return metadata;
}

export async function githubJson(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'application/vnd.github+json',
      'User-Agent': 'gitblog',
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!response.ok) throw new GitHubRequestError(response.status);
  return response.json();
}
export function validRepo(repo: string) {
  if (!/^[a-zA-Z0-9-]{1,39}\/[a-zA-Z0-9_.-]{1,100}$/.test(repo))
    throw new Error('Invalid repository.');
  return repo.toLowerCase();
}
export async function getAppAccess(repoWithOwner: string, writable = false, pagesRead = false) {
  const repo = validRepo(repoWithOwner);
  const jwt = getJWT();
  let installation;
  try {
    installation = await githubJson(`/repos/${repo}/installation`, jwt);
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404)
      throw new CommentSetupError(
        'installation',
        'Add this repository to the gitblog App installation.',
      );
    throw error;
  }
  if (
    installation.suspended_at ||
    String(installation.app_id) !== process.env.GITHUB_APP_ID ||
    installation.permissions?.discussions !== 'write'
  )
    throw new CommentSetupError('permissions', 'Install the gitblog App with Discussions access.');
  // Repository-scoped read and write credentials must never share a cache entry.
  const canReadPages = pagesRead && ['read', 'write'].includes(installation.permissions?.pages);
  const key = JSON.stringify([
    process.env.GITHUB_APP_ID,
    installation.id,
    repo,
    writable,
    canReadPages,
  ]);
  const credential =
    TokenCache.get(key) ||
    (await githubJson(`/app/installations/${installation.id}/access_tokens`, jwt, {
      method: 'POST',
      body: JSON.stringify({
        repositories: [repo.split('/')[1]],
        permissions: {
          discussions: writable ? 'write' : 'read',
          contents: 'read',
          metadata: 'read',
          ...(canReadPages ? { pages: 'read' } : {}),
        },
      }),
    }));
  try {
    const metadata: RepositoryMetadata = await githubJson(`/repos/${repo}`, credential.token);
    if (
      metadata.private ||
      metadata.archived ||
      !metadata.has_discussions ||
      metadata.full_name.toLowerCase() !== repo
    )
      throw new CommentSetupError(
        'repository',
        'A public, active Discussions repository is required.',
      );
    TokenCache.set(key, credential);
    return { token: credential.token as string, metadata };
  } catch (error) {
    TokenCache.delete(key);
    throw error;
  }
}

export async function getAppAccessToken(repoWithOwner: string, writable = false): Promise<string> {
  return (await getAppAccess(repoWithOwner, writable)).token;
}
