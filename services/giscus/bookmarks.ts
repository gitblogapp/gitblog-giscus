export class BookmarkError extends Error {
  constructor(public status: number) {
    super('Bookmark request failed');
  }
}
export async function updateBookmark(
  token: string,
  repo: string,
  term: string,
  locale: string,
  action: 'status' | 'save' | 'remove',
  signal?: AbortSignal,
) {
  const response = await fetch('/v1/reader/bookmarks', {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ repo, term, locale, action }),
  });
  if (!response.ok) throw new BookmarkError(response.status);
  const data = await response.json();
  if (typeof data.saved !== 'boolean') throw new BookmarkError(502);
  return data.saved as boolean;
}
