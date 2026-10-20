'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';
import { api } from '@/lib/api';

export default function LoginPage() {
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [emailErr, setEmailErr]   = useState('');
  const [formErr, setFormErr]     = useState('');
  const [loading, setLoading]     = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  const validateEmail = (v: string) => {
    if (!v) return 'Email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email address.';
    return '';
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormErr('');

    const ev = validateEmail(email);
    if (ev) { setEmailErr(ev); emailRef.current?.focus(); return; }
    if (!password) {
      setFormErr('Password is required.');
      return;
    }

    setLoading(true);
    try {
      await api.authLogin(email, password);
      const next = new URLSearchParams(location.search).get('next') ?? '/';
      location.href = next;
    } catch (err: any) {
      setFormErr(err?.message ?? 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-2">
          <span className="text-2xl">✈</span>
          <h1 className="text-xl font-bold tracking-tight">Flight Tracker</h1>
        </div>

        <h2 className="mb-6 text-lg font-semibold text-foreground">Sign in</h2>

        {formErr && (
          <div role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {formErr}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-foreground">
              Email
            </label>
            <input
              ref={emailRef}
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => { setEmail(e.target.value); if (emailErr) setEmailErr(''); }}
              onBlur={() => setEmailErr(validateEmail(email))}
              aria-describedby={emailErr ? 'email-error' : undefined}
              aria-invalid={!!emailErr}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary aria-[invalid=true]:border-destructive"
              placeholder="you@example.com"
            />
            {emailErr && (
              <p id="email-error" className="mt-1 text-xs text-destructive">{emailErr}</p>
            )}
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-foreground">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  );
}
