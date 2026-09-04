import { getConnector, listConnectors } from '../registry.js';
import type { ConnectIo, ConnectStopResult } from '../types.js';

export async function stopAllConnectors(
  io: ConnectIo,
): Promise<ConnectStopResult & { executed: number }> {
  let stoppedProcesses = 0;
  let executed = 0;
  for (const entry of listConnectors()) {
    const connector = await getConnector(entry.name);
    if (!connector?.stopAll) {
      continue;
    }
    executed += 1;
    const result = await connector.stopAll(io);
    stoppedProcesses += result.stoppedProcesses;
  }
  return { stoppedProcesses, executed };
}

export async function runStopAllConnectors(io: ConnectIo): Promise<number> {
  const { stoppedProcesses, executed } = await stopAllConnectors(io);
  if (executed === 0) {
    io.writeln('[connect] no adapters support stop yet');
    return 0;
  }
  io.writeln(`[connect] stopped processes=${stoppedProcesses}`);
  return 0;
}

export async function runStopConnector(
  adapterName: string,
  io: ConnectIo,
): Promise<number> {
  const connector = await getConnector(adapterName);
  if (!connector) {
    io.writeErr(`unknown connect adapter "${adapterName}"`);
    return 1;
  }
  if (!connector.stopAll) {
    io.writeErr(`connect adapter "${adapterName}" does not support stop`);
    return 1;
  }
  const result: ConnectStopResult = await connector.stopAll(io);
  io.writeln(
    `[connect] ${connector.name} stopped processes=${result.stoppedProcesses}`,
  );
  return 0;
}

export async function runConnectAdapter(
  adapterName: string,
  passthroughArgs: string[],
  io: ConnectIo,
): Promise<number> {
  const connector = await getConnector(adapterName);
  if (!connector) {
    io.writeErr(`unknown connect adapter "${adapterName}"`);
    return 1;
  }
  return connector.run(passthroughArgs, io);
}

export function formatAdapterList(): string {
  const lines: string[] = [];
  for (const connector of listConnectors()) {
    lines.push(`  ${connector.name.padEnd(12)} ${connector.description}`);
  }
  return lines.join('\n');
}

export function sessionIoToConnectIo(io: {
  writeStdout: (chunk: string) => void;
  writeStderr: (chunk: string) => void;
}): ConnectIo {
  return {
    writeln: (text = '') => {
      io.writeStdout(`${text}\n`);
    },
    writeErr: (text) => {
      io.writeStderr(`${text}\n`);
    },
  };
}
