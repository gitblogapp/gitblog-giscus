// No external cache: installation access and repository visibility are rechecked per request.
export const TokenCache = {
  async get(_id: number) {
    void _id;
    return null;
  },
  async set(_value: unknown) {
    void _value;
    return true;
  },
};
