// Social login (US-012): labels and the messages for the backend's `oauth_error` codes.

export const PROVIDER_LABELS: Record<string, string> = { google: 'Google', github: 'GitHub' };

export const providerLabel = (provider: string | null | undefined) =>
  (provider && PROVIDER_LABELS[provider]) || 'the provider';

/** Only a path on this site; anything else (https://…, //host, /\host) goes home. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\\]/.test(next)) return '/';
  return next;
}

/** Error code for a failed POST /link: 409 means the provider account belongs to someone else. */
export const linkErrorCode = (err: any) => (err?.status === 409 ? 'linked_other' : 'expired');

export function oauthErrorMessage(code: string | null, provider: string | null): string | null {
  if (!code) return null;
  const label = providerLabel(provider);
  switch (code) {
    case 'cancelled':    return 'Sign-in was cancelled.';
    case 'no_email':     return `Your ${label} account has no verified email address.`;
    case 'exists':       return `An account with this email already exists. Log in with your password to link ${label}.`;
    case 'linked_other': return `This ${label} account is linked to another user.`;
    case 'expired':      return 'This sign-in link has expired or was already used. Please try again.';
    default:             return `Couldn't sign in with ${label}. Please try again.`;
  }
}
