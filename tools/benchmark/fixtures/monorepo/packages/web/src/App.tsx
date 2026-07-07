import React, { useState } from 'react';
import { validateEmail } from '@mono/shared';

export function App() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    if (!validateEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setError(null);
  }

  return (
    <div>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <button onClick={handleSubmit}>Sign up</button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
