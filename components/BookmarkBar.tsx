import { BookmarkIcon, BookmarkFillIcon } from '@primer/octicons-react';
import { useContext, useEffect, useState } from 'react';
import { AuthContext, ConfigContext } from '../lib/context';
import useTranslation from 'next-translate/useTranslation';
import english from '../locales/en/common.json';
import { BookmarkError, updateBookmark } from '../services/giscus/bookmarks';

export default function BookmarkBar() {
  const { token, origin, getLoginUrl } = useContext(AuthContext);
  const { repo, term } = useContext(ConfigContext);
  const { t: translate, lang } = useTranslation('common');
  const t = (
    key:
      | 'signInToBookmark'
      | 'bookmarked'
      | 'bookmarkPost'
      | 'myBookmarks'
      | 'bookmarkPostUnavailable'
      | 'bookmarkFailed',
  ) => translate<string>(key, undefined, { default: english[key] });
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(0);
  const supported = /^giscus-post-[a-f0-9]{16}$/.test(term);
  useEffect(() => {
    const controller = new AbortController();
    setSaved(null);
    setError(0);
    if (token && supported) {
      setBusy(true);
      updateBookmark(token, repo, term, lang, 'status', controller.signal)
        .then(setSaved)
        .catch((cause) => {
          if (!controller.signal.aborted)
            setError(cause instanceof BookmarkError ? cause.status : 502);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }
    return () => controller.abort();
  }, [token, repo, term, lang, supported]);

  if (!supported) return null;
  const toggle = async () => {
    if (busy) return;
    const previous = saved;
    setBusy(true);
    setError(0);
    if (saved !== null) setSaved(!saved);
    try {
      setSaved(
        await updateBookmark(
          token,
          repo,
          term,
          lang,
          saved === null ? 'status' : saved ? 'remove' : 'save',
        ),
      );
    } catch (cause) {
      setSaved(previous);
      setError(cause instanceof BookmarkError ? cause.status : 502);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="gsc-bookmark-bar color-text-primary mb-4 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!token || error === 401 ? (
          <a
            className="btn inline-flex items-center gap-2 rounded-md border"
            href={getLoginUrl(origin)}
            target="_top"
          >
            <BookmarkIcon /> {t('signInToBookmark')}
          </a>
        ) : (
          <button
            type="button"
            className="btn inline-flex items-center gap-2 rounded-md border"
            aria-pressed={saved === true}
            disabled={busy}
            onClick={toggle}
          >
            {saved ? <BookmarkFillIcon /> : <BookmarkIcon />}
            {saved ? t('bookmarked') : t('bookmarkPost')}
          </button>
        )}
        <a
          href="/library"
          target="_blank"
          rel="noopener noreferrer"
          className="link-secondary text-sm"
        >
          {t('myBookmarks')}
        </a>
      </div>
      {error && error !== 401 ? (
        <p role="status" className="mt-2 text-sm color-text-secondary">
          {error === 404 ? t('bookmarkPostUnavailable') : t('bookmarkFailed')}
        </p>
      ) : null}
    </div>
  );
}
