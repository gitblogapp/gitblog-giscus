import type { NextApiRequest, NextApiResponse } from 'next';
import { sessionFrom, requireSameOrigin } from '../../../lib/gitblog-session';
import { getAppAccessToken, githubJson } from '../../../services/github/getAppAccessToken';
import { ADD_DISCUSSION_COMMENT_QUERY } from '../../../services/github/addDiscussionComment';
import { ADD_DISCUSSION_REPLY_QUERY } from '../../../services/github/addDiscussionReply';
import { TOGGLE_REACTION_QUERY } from '../../../services/github/toggleReaction';
import { TOGGLE_UPVOTE_QUERY } from '../../../services/github/toggleUpvote';
const queries = new Set([
  ADD_DISCUSSION_COMMENT_QUERY,
  ADD_DISCUSSION_REPLY_QUERY,
  TOGGLE_REACTION_QUERY('add'),
  TOGGLE_REACTION_QUERY('remove'),
  TOGGLE_UPVOTE_QUERY('Add'),
  TOGGLE_UPVOTE_QUERY('Remove'),
]);
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    requireSameOrigin(req);
    const session = sessionFrom(req);
    const { query, variables: v } = req.body;
    if (!queries.has(query) || !v || JSON.stringify(v).length > 20000) throw new Error();
    const appToken = await getAppAccessToken(session.repo);
    const ids = [v.discussionId, v.replyToId, v.subjectId, v.upvoteInput?.subjectId].filter(
      Boolean,
    );
    if (!ids.length || ids.some((id) => typeof id !== 'string' || id.length > 200))
      throw new Error();
    let discussionId: string;
    for (const id of ids) {
      const result = await githubJson('/graphql', appToken, {
        method: 'POST',
        body: JSON.stringify({
          query:
            'query($id:ID!){node(id:$id){__typename ... on Discussion{id repository{nameWithOwner}} ... on DiscussionComment{discussion{id repository{nameWithOwner}}}}}',
          variables: { id },
        }),
      });
      const node = result.data?.node;
      const discussion = node?.__typename === 'Discussion' ? node : node?.discussion;
      if (
        discussion?.repository?.nameWithOwner.toLowerCase() !== session.repo ||
        (discussionId && discussionId !== discussion.id)
      )
        throw new Error();
      discussionId = discussion.id;
    }
    if (
      v.body !== undefined &&
      (typeof v.body !== 'string' || !v.body.trim() || v.body.length > 10000)
    )
      throw new Error();
    res.json(
      await githubJson('/graphql', session.token, {
        method: 'POST',
        body: JSON.stringify({ query, variables: v }),
      }),
    );
  } catch {
    res
      .status(403)
      .json({ errors: [{ message: 'Comment request is not authorized. Please sign in again.' }] });
  }
}
export const config = { api: { bodyParser: { sizeLimit: '32kb' } } };
