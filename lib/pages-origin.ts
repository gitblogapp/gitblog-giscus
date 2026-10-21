// Trust GitHub's current assignment for this repository, never a wildcard or
// a caller-supplied custom hostname. Website/homepage remains an independent opt-in.
export function verifiedPagesOrigin(pages: {
  cname?: string | null;
  html_url?: string;
  protected_domain_state?: string;
  https_enforced?: boolean;
  https_certificate?: { state?: string } | null;
}): string | null {
  if (
    !pages.cname ||
    pages.protected_domain_state !== 'verified' ||
    !pages.https_enforced ||
    pages.https_certificate?.state !== 'approved'
  )
    return null;
  try {
    const url = new URL(pages.html_url || '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hostname !== pages.cname.toLowerCase()
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
