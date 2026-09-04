import { createExportsEntry } from './service.js';
import { toExportsResponseDto, type ExportsResponseDto } from './dto.js';

export function handleCreateExports(customerId: string, total: number): ExportsResponseDto {
  const order = createExportsEntry(customerId, total);
  return toExportsResponseDto(order);
}
