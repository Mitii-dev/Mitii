import Button from './components/Button';

/**
 * Baseline app for Mitii frontend agent benchmarks.
 * Agents extend this app according to each case prompt.
 */
export default function App() {
  return (
    <main className="app">
      <h1>Mitii Frontend Benchmark</h1>
      <p>Welcome to the Mitii frontend coding-agent fixture.</p>
      <Button label="Primary" />
      <Button label="Secondary" variant="secondary" />
    </main>
  );
}
