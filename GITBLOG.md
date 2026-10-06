# gitblog giscus fork

Fork of https://github.com/giscus/giscus. Original Next.js/React widget, styles, themes and translations are retained; this is not a Svelte rewrite. Upstream MIT license and authorship remain in LICENSE.

Cloudflare OpenNext requires a supported Next.js release, so the fork updates Next.js to 15.5.27 and uses React 18. The Worker is private and is reached through gitblog's service binding at gitblog.app. Do not attach a separate public hostname.

The same gitblog GitHub App is used. Its user token has CMS rights and must NEVER be sent to the original client-side GitHub API functions. Login goes through gitblog's OAuth flow and issues a separate one-hour encrypted, repository-bound comment ticket. The original UI services send that ticket only to allowlisted server operations. The server rechecks public repository and App installation access and validates all comment/reaction node ownership before using the user token. No token endpoint returns the raw GitHub token. Private repositories are unsupported. Creating a missing discussion uses a single-repository Discussions-write installation token after category/repository/title validation; replies and reactions use the visitor credential.

No Supabase, PostgREST or Valkey service is required. Worker secrets: AUTH_SECRET (same as gitblog), GITHUB_PRIVATE_KEY (existing App PEM). Public App IDs are in wrangler.jsonc. Build: npm ci && npm run build:worker. Deploy: npm run deploy. The gitblog Worker routes widget, themes, client.js, _next and the giscus API paths to this Worker.
