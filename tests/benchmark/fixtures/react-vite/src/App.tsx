import Button from './components/Button';

export default function App() {
  return (
    <main>
      <h1>Benchmark React App</h1>
      {/* Intentionally wrong secondary label for bugfix cases */}
      <Button label="Primary" />
      <Button label="Secondry" variant="secondary" />
    </main>
  );
}
