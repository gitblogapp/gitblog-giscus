import { GetServerSidePropsContext, InferGetServerSidePropsType } from 'next';
import Head from 'next/head';
import { ContextType, useContext, useEffect, useState } from 'react';
import Widget from '../components/Widget';
import { assertOrigin } from '../lib/config';
import { ConfigContext, ThemeContext } from '../lib/context';
import { InputPosition, ISetConfigMessage } from '../lib/types/giscus';
import { cleanSessionParam, getOriginHost } from '../lib/utils';
import { Theme } from '../lib/variables';
import {
  CommentSetupError,
  getAppAccess,
  getPublicRepository,
} from '../services/github/getAppAccessToken';
import type { CommentSetupIssue } from '../services/github/getAppAccessToken';
import SetupNotice from '../components/SetupNotice';
import { getRepoConfig } from '../services/github/getConfig';
import { availableLanguages } from '../lib/i18n';
import Router from 'next/router';

export async function getServerSideProps({ query, res, locale }: GetServerSidePropsContext) {
  const session = (query.session as string) || '';
  const repo = (query.repo as string) || '';
  const term = cleanSessionParam((query.term as string) || '');
  const category = (query.category as string) || '';
  const number = +query.number || 0;
  const strict = Boolean(+query.strict);
  const repoId = (query.repoId as string) || '';
  const categoryId = (query.categoryId as string) || '';
  const description = (query.description as string) || '';
  const reactionsEnabled = Boolean(+query.reactionsEnabled);
  const emitMetadata = Boolean(+query.emitMetadata);
  const inputPosition = (query.inputPosition === 'top' ? 'top' : 'bottom') as InputPosition;
  const theme = ((query.theme as string) || 'preferred_color_scheme') as Theme;
  const { origin, originHost } = getOriginHost((query.origin as string) || '');
  const backLink = (query.backLink as string) || origin;

  res.setHeader('Cache-Control', 'private, no-store');
  let token: string | undefined;
  let metadata: Awaited<ReturnType<typeof getPublicRepository>>;
  let setupIssue: CommentSetupIssue | null = null;
  try {
    ({ token, metadata } = await getAppAccess(repo));
  } catch (error) {
    if (!(error instanceof CommentSetupError)) throw error;
    // Render only public setup guidance. Never issue a broader token or skip origin checks.
    try {
      metadata = await getPublicRepository(repo);
    } catch {
      res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
      return { notFound: true };
    }
    setupIssue = error.issue;
  }
  const allowed = new Set([
    'https://gitblog.app',
    `https://${metadata.owner.login.toLowerCase()}.github.io`,
  ]);
  if (metadata.homepage) {
    try {
      const u = new URL(metadata.homepage);
      if (u.protocol === 'https:') allowed.add(u.origin);
    } catch {
      /* Ignore invalid optional homepage. */
    }
  }
  if (!allowed.has(originHost)) {
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    return { notFound: true };
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const repoConfig = await getRepoConfig(repo, token);

  // Opt into CORP. See: https://web.dev/articles/coop-coep
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  if (!assertOrigin(originHost, repoConfig)) {
    res.setHeader('Content-Security-Policy', `frame-ancestors 'none';`);
    res.setHeader('X-Frame-Options', 'DENY');
    return {
      redirect: {
        destination: 'https://github.com/orgs/giscus/discussions/1298',
        permanent: false,
      },
    };
  } else {
    let origins = repoConfig.origins || [];
    if (origins.indexOf(originHost) === -1) {
      origins = [...origins, originHost];
    }
    const originsStr = origins.join(' ');

    res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${originsStr};`);
  }

  if (setupIssue) res.statusCode = 403;
  const defaultCommentOrder = repoConfig.defaultCommentOrder || 'oldest';

  return {
    props: {
      setupIssue,
      language: locale || 'en',
      origin,
      session,
      repo,
      term,
      category,
      number,
      strict,
      repoId,
      categoryId,
      description,
      reactionsEnabled,
      emitMetadata,
      inputPosition,
      defaultCommentOrder,
      theme,
      originHost,
      backLink,
    },
  };
}

export default function WidgetPage({
  setupIssue,
  language,
  origin,
  session,
  repo,
  term,
  number,
  category,
  strict,
  repoId,
  categoryId,
  description,
  reactionsEnabled,
  emitMetadata,
  inputPosition,
  defaultCommentOrder,
  theme,
  originHost,
  backLink,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const resolvedOrigin = origin || (typeof location === 'undefined' ? '' : location.href);
  const { theme: resolvedTheme, setTheme } = useContext(ThemeContext);
  const [config, setConfig] = useState<ContextType<typeof ConfigContext>>({
    repo,
    repoId,
    category,
    categoryId,
    description,
    backLink,
    term,
    number,
    strict,
    reactionsEnabled,
    emitMetadata,
    inputPosition,
    defaultCommentOrder,
  });

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== originHost) return;
      if (typeof event.data !== 'object' || !event.data.giscus) return;

      const giscusData = event.data.giscus;
      if (!('setConfig' in giscusData)) return;

      const { setConfig: newConfig } = giscusData as ISetConfigMessage;

      if ('theme' in newConfig) {
        setTheme(newConfig.theme);
        delete newConfig.theme;
      }

      if (Router.isReady && newConfig.lang in availableLanguages) {
        Router.replace(Router.asPath, Router.asPath, {
          locale: newConfig.lang,
          scroll: false,
        });
        delete newConfig.lang;
      }

      setConfig((prevConfig) => ({ ...prevConfig, ...newConfig }));
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [originHost, setTheme]);

  useEffect(() => setTheme(theme), [setTheme, theme]);

  if (setupIssue)
    return (
      <SetupNotice issue={setupIssue} repo={repo} language={language} originHost={originHost} />
    );

  return (
    <>
      <Head>
        <base target="_top" />
        <title>giscus</title>
      </Head>

      <main className="w-full mx-auto" data-theme={resolvedTheme}>
        <ConfigContext.Provider value={config}>
          <Widget origin={resolvedOrigin} session={session} />
        </ConfigContext.Provider>
      </main>
    </>
  );
}
