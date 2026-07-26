export function createModuleLogger(scope: string) {
  return {
    info: (msg: string) => console.log(`[${scope}] ${msg}`),
    error: (msg: string) => console.error(`[${scope}] ${msg}`),
  };
}
