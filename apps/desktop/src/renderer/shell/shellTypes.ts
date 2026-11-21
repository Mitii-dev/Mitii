/** Shell-level view / layout unions. */



export type View = 'chat' | 'settings';

export type ChatLayout = 'chat' | 'code';

export type WorkspaceSide =
  | 'explorer'
  | 'git'
  | 'mcp'
  | 'skills'
  | 'recipes';
