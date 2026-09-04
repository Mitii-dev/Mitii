import { useState } from 'react';
import type { FormEvent } from 'react';

export type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

export interface SignupFormProps {
  onSubmit: (email: string) => Promise<void>;
}

export default function SignupForm({ onSubmit }: SignupFormProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<SubmitStatus>('idle');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('submitting');
    try {
      await onSubmit(email);
      setStatus('success');
    } catch {
      setStatus('error');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="signup-email">Email</label>
      <input id="signup-email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <button type="submit" disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Submitting…' : 'Sign up'}
      </button>
      {status === 'success' && <p role="status">Signed up successfully</p>}
      {status === 'error' && <p role="alert">Something went wrong</p>}
    </form>
  );
}
