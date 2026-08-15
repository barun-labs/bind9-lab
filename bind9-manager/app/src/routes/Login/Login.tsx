import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { Input } from '../../components/Input/Input';
import { Button } from '../../components/Button/Button';
import { InlineAlert } from '../../components/InlineAlert/InlineAlert';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError('Please enter a username');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await login(trimmedUsername, password);
      navigate('/configurations');
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg)',
        padding: '24px',
      }}
    >
      <div
        className="blueprint"
        style={{
          width: '100%',
          maxWidth: '380px',
          background: 'var(--color-surface)',
          padding: '32px 28px',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <i className="corner tl" aria-hidden="true" />
        <i className="corner tr" aria-hidden="true" />
        <i className="corner bl" aria-hidden="true" />
        <i className="corner br" aria-hidden="true" />

        {/* Brand header */}
        <div style={{ marginBottom: '24px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '2px 6px',
              background: 'var(--color-accent)',
              color: 'var(--color-text-inverse)',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.05em',
              marginBottom: '10px',
            }}
          >
            BIND9-MANAGER
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '24px',
              fontWeight: 600,
              lineHeight: 1.2,
              letterSpacing: 'var(--tracking-heading-lg, -0.01em)',
              color: 'var(--color-text)',
              margin: '0 0 6px 0',
              textTransform: 'uppercase',
            }}
          >
            Sign In
          </h1>
          <p
            style={{
              fontSize: '13px',
              color: 'var(--color-text-secondary)',
              margin: 0,
            }}
          >
            Authenticate to manage DNS zones, records, and servers.
          </p>
        </div>

        {error && (
          <div style={{ marginBottom: '16px' }}>
            <InlineAlert tone="error">{error}</InlineAlert>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label
              htmlFor="username"
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--color-text-secondary)',
                marginBottom: '6px',
              }}
            >
              Username
            </label>
            <Input
              id="username"
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. admin, editor, or viewer"
              autoFocus
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--color-text-secondary)',
                marginBottom: '6px',
              }}
            >
              Password
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            loading={isSubmitting}
            style={{ width: '100%', marginTop: '6px', height: '36px' }}
          >
            Sign in
          </Button>
        </form>

        <div
          style={{
            marginTop: '24px',
            paddingTop: '16px',
            borderTop: '1px solid var(--color-divider)',
            fontSize: '11px',
            color: 'var(--color-text-tertiary)',
          }}
        >
          <div
            style={{
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontSize: '10px',
              marginBottom: '4px',
              color: 'var(--color-text-secondary)',
            }}
          >
            Demo Accounts
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
            <code>admin</code>, <code>editor</code>, <code>viewer</code> (any password)
          </div>
        </div>
      </div>
    </div>
  );
}
