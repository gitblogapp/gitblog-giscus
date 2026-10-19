import Head from 'next/head';
import { useEffect, useRef } from 'react';
import type { CommentSetupIssue } from '../services/github/getAppAccessToken';

export default function SetupNotice({
  issue,
  repo,
  language,
  originHost,
}: {
  issue: CommentSetupIssue;
  repo: string;
  language: string;
  originHost: string;
}) {
  const box = useRef<HTMLElement>(null);
  const ko = language.startsWith('ko');
  const title = ko ? '댓글 연결 설정이 필요합니다' : 'Comments need to be connected';
  const messages = ko
    ? {
        installation:
          '블로그 소유자가 GitBlog App의 접근 가능한 저장소에 이 블로그를 추가해야 합니다. 토큰 로그인과 Discussions 활성화만으로는 App 접근이 승인되지 않습니다.',
        permissions:
          '블로그 소유자가 GitBlog App 설치 상태와 Discussions 쓰기 권한을 확인해야 합니다.',
        repository: '공개 상태이며 보관되지 않은 저장소에서 Discussions를 활성화해야 합니다.',
      }
    : {
        installation:
          'The blog owner needs to add this repository to the GitBlog App installation. Token login and enabling Discussions do not grant the App repository access.',
        permissions:
          'The blog owner needs to check the GitBlog App installation and approve Discussions write access.',
        repository: 'Enable Discussions on a public repository that is not archived.',
      };
  useEffect(() => {
    const resize = () =>
      window.parent.postMessage(
        { giscus: { resizeHeight: box.current?.scrollHeight ?? 280 } },
        originHost,
      );
    const observer = new ResizeObserver(resize);
    if (box.current) observer.observe(box.current);
    resize();
    return () => observer.disconnect();
  }, [originHost]);
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <section
        ref={box}
        role="status"
        style={{
          padding: 20,
          fontFamily: 'system-ui, sans-serif',
          lineHeight: 1.7,
          color: '#24292f',
          background: '#fff',
          borderRadius: 8,
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>{title}</h2>
        <p>{messages[issue]}</p>
        <p>
          <strong>{repo}</strong>
        </p>
        <p>
          {ko
            ? '설정을 완료한 뒤 블로그를 새로고침하세요.'
            : 'Reload the blog after completing setup.'}
        </p>
        <p>
          <a
            href="https://github.com/apps/gitblog-app/installations/new"
            target="_blank"
            rel="noopener noreferrer"
          >
            {ko ? 'GitBlog App 설정' : 'Configure GitBlog App'}
          </a>
          {' · '}
          <a
            href={`https://github.com/${repo}/discussions`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {ko ? 'GitHub Discussions에서 보기' : 'View GitHub Discussions'}
          </a>
        </p>
      </section>
    </>
  );
}
