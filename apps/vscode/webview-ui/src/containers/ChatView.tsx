import { type AppApi } from '../app/appApi';
import { ComposerDock } from '../containers/ComposerDock';
import { MessageListContainer } from '../containers/MessageListContainer';

export function ChatView({ api }: { api: AppApi }) {
  const {
    running,
  } = api;

  return (
    <div className={`chat-view${running ? ' chat-view--running' : ''}`}>
      <MessageListContainer api={api} />
      <ComposerDock api={api} />
    </div>
  );
}
