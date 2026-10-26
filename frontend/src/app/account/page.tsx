'use client';

import { useEffect, useState } from 'react';
import { api, type LinkedAccounts } from '@/lib/api';
import { ProviderIcon } from '@/components/auth/SocialButtons';
import { oauthErrorMessage, providerLabel, linkErrorCode } from '@/components/auth/oauth-messages';

type User = { id: number; email: string; firstName: string | null };

export default function AccountPage() {
  const [user, setUser]           = useState<User | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [links, setLinks]         = useState<LinkedAccounts | null>(null);
  const [loading, setLoading]     = useState(true);
  const [busy, setBusy]           = useState<string | null>(null);
  const [error, setError]         = useState('');
  const [notice, setNotice]       = useState('');

  useEffect(() => {
    (async () => {
      const me = await api.authMe().catch(() => null);
      if (!me) { location.href = '/login?next=/account'; return; }
      setUser(me);

      // Back from a provider: finish linking, or show why it didn't work.
      const q = new URLSearchParams(location.search);
      const provider = q.get('provider');
      const token = q.get('link_token');
      const err = oauthErrorMessage(q.get('oauth_error'), provider);
      if (q.toString()) history.replaceState(null, '', '/account');

      let current: LinkedAccounts | null = null;
      if (provider && token) {
        try {
          current = await api.oauthLink(provider, token);
          setNotice(`${providerLabel(provider)} is now linked.`);
        } catch (e) {
          setError(oauthErrorMessage(linkErrorCode(e), provider) ?? '');
        }
      } else if (err) {
        setError(err);
      } else if (provider && q.get('linked')) {
        setNotice(`${providerLabel(provider)} is linked.`);
      }

      const [p, l] = await Promise.all([
        api.oauthProviders().catch(() => [] as string[]),
        current ? Promise.resolve(current) : api.oauthLinks().catch(() => null),
      ]);
      setProviders(p);
      setLinks(l);
      setLoading(false);
    })();
  }, []);

  const unlink = async (provider: string) => {
    setBusy(provider); setError(''); setNotice('');
    try {
      setLinks(await api.oauthUnlink(provider));
      setNotice(`${providerLabel(provider)} was unlinked.`);
    } catch (e: any) {
      setError(e?.message ?? `Couldn't unlink ${providerLabel(provider)}.`);
    } finally {
      setBusy(null);
    }
  };

  // Configured providers plus any linked one whose button is currently switched off.
  const rows = Array.from(new Set([...providers, ...(links?.linked.map(l => l.provider) ?? [])]));

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">✈</span>
            <h1 className="text-xl font-bold tracking-tight">Your account</h1>
          </div>
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground">← Back</a>
        </div>

        {loading || !user ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <dl className="mb-6 space-y-1 text-sm">
              <div className="flex gap-2"><dt className="text-muted-foreground">Name</dt><dd>{user.firstName ?? '—'}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground">Email</dt><dd>{user.email}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground">Password</dt><dd>{links?.hasPassword ? 'Set' : 'Not set'}</dd></div>
            </dl>

            {error && (
              <div role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
            {notice && (
              <div role="status" className="mb-4 rounded-lg border border-border bg-accent px-4 py-3 text-sm text-foreground">
                {notice}
              </div>
            )}

            <section aria-labelledby="linked-accounts">
              <h2 id="linked-accounts" className="mb-3 text-base font-semibold">Linked accounts</h2>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sign-in providers are set up on this site.</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {rows.map(p => {
                    const linked = links?.linked.find(l => l.provider === p);
                    return (
                      <li key={p} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ProviderIcon provider={p} />
                          <div>
                            <p className="text-sm font-medium">{providerLabel(p)}</p>
                            <p className="text-xs text-muted-foreground">{linked ? `Linked · ${linked.email}` : 'Not linked'}</p>
                          </div>
                        </div>
                        {linked ? (
                          <button
                            onClick={() => unlink(p)}
                            disabled={busy === p}
                            className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
                          >
                            {busy === p ? 'Unlinking…' : 'Unlink'}
                          </button>
                        ) : providers.includes(p) ? (
                          <a
                            href={api.oauthStartUrl(p, { intent: 'link' })}
                            className="rounded-lg border border-input px-3 py-1.5 text-sm font-medium transition hover:bg-accent"
                          >
                            Link {providerLabel(p)}
                          </a>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
