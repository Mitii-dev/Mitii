import { AppShell } from './app/AppShell.js';
import { useAppModel } from './app/useAppModel.js';

export function App() {
  const model = useAppModel();
  return <AppShell m={model} />;
}
