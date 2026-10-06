import { GITHUB_MARKDOWN_API_URL } from '../config';

export async function renderMarkdown(text: string, token?: string, context?: string) {
  return fetch(GITHUB_MARKDOWN_API_URL, {
    method: 'POST',
    headers: token
      ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'gfm', text, ...(context ? { context } : {}) }),
  }).then((r) => r.text());
}
