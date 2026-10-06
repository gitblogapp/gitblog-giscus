const nextTranslate = require('next-translate-plugin');
const fallbacks = require('./i18n.fallbacks.json');
require('next-translate-plugin/lib/cjs/utils.js').defaultLoader = `(l, n) => { const lang = ${JSON.stringify(fallbacks)}[l] ?? l; return import(\`@next-translate-root/locales/\${lang}/\${n}\`).then(m => m.default); }`;
module.exports = nextTranslate({
  transpilePackages: ['next-translate'],
  output: 'standalone',
  poweredByHeader: false,
  env: { NEXT_PUBLIC_GISCUS_APP_HOST: 'https://gitblog.app' },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      },
      { source: '/client.js', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] },
    ];
  },
});
