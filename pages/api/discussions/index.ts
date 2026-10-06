import { sessionFrom, requireSameOrigin } from '../../../lib/gitblog-session';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getDiscussion } from '../../../services/github/getDiscussion';
import { adaptDiscussion } from '../../../lib/adapter';
import { IError, IGiscussion } from '../../../lib/types/adapter';
import { createDiscussion } from '../../../services/github/createDiscussion';
import { GRepositoryDiscussion } from '../../../lib/types/github';
import { getAppAccessToken } from '../../../services/github/getAppAccessToken';

async function get(req: NextApiRequest, res: NextApiResponse<IGiscussion | IError>) {
  const params = {
    repo: req.query.repo as string,
    term: req.query.term as string,
    number: +req.query.number,
    category: req.query.category as string,
    strict: req.query.strict === 'true',
    first: +req.query.first,
    last: +req.query.last,
    after: req.query.after as string,
    before: req.query.before as string,
  };
  if (!params.last && !params.first) {
    params.first = 20;
  }

  await getAppAccessToken(params.repo);
  const userToken = req.headers.authorization ? sessionFrom(req, params.repo).token : undefined;
  let token = userToken;
  if (!token) {
    try {
      token = await getAppAccessToken(params.repo);
    } catch (error) {
      res.status(403).json({ error: error.message });
      return;
    }
  }

  const response = await getDiscussion(params, token);

  if ('message' in response) {
    if (response.message.includes('Bad credentials')) {
      res.status(403).json({ error: response.message });
      return;
    }
    res.status(500).json({ error: response.message });
    return;
  }

  if ('errors' in response) {
    const error = response.errors[0];
    if (error?.message?.includes('API rate limit exceeded')) {
      let message = `API rate limit exceeded for ${params.repo}`;
      if (!userToken) {
        message += '. Sign in to increase the rate limit';
      }
      res.status(429).json({ error: message });
      return;
    }

    console.error(response);
    const message = response.errors.map?.(({ message }) => message).join('. ') || 'Unknown error';
    res.status(500).json({ error: message });
    return;
  }

  const { data } = response;
  if (!data) {
    console.error(response);
    res.status(500).json({ error: 'Unable to fetch discussion' });
    return;
  }

  const { viewer } = data;

  let discussion: GRepositoryDiscussion;
  if ('search' in data) {
    const { search } = data;
    const { discussionCount, nodes } = search;
    discussion = discussionCount > 0 ? nodes[0] : null;
  } else {
    discussion = data.repository.discussion;
  }

  if (!discussion) {
    res.status(404).json({ error: 'Discussion not found' });
    return;
  }

  const adapted = adaptDiscussion({ viewer, discussion });
  res.status(200).json(adapted);
}

async function post(req: NextApiRequest, res: NextApiResponse) {
  requireSameOrigin(req);
  const { repo, input } = req.body;
  const session = sessionFrom(req, repo);
  const appToken = await getAppAccessToken(repo, true);
  const categoryResult = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'gitblog',
    },
    body: JSON.stringify({
      query:
        'query($id:ID!){node(id:$id){... on DiscussionCategory{repository{id nameWithOwner}}}}',
      variables: { id: input.categoryId },
    }),
  }).then((r) => r.json());
  const categoryRepo = categoryResult.data?.node?.repository;
  if (
    categoryRepo?.nameWithOwner.toLowerCase() !== session.repo ||
    categoryRepo.id !== input.repositoryId ||
    !/^giscus-post-[a-f0-9]{16}$/.test(input.title) ||
    typeof input.body !== 'string' ||
    input.body.length > 10000
  )
    throw new Error('Invalid discussion scope.');
  const response = await createDiscussion(appToken, { input });
  const id = response?.data?.createDiscussion?.discussion?.id;
  if (!id) {
    res.status(400).json({ error: 'Unable to create discussion.' });
    return;
  }
  res.json({ id });
}

export default async function DiscussionsApi(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (req.method === 'POST') {
      await post(req, res);
      return;
    }
    await get(req, res);
  } catch (cause) {
    console.error('Comment access failed:', cause instanceof Error ? cause.message : 'unknown');
    res.status(403).json({ error: 'Repository access or comment session is invalid.' });
  }
}
