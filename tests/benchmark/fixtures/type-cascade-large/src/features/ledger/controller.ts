import { createLedgeEntry } from './service.js';
import { toLedgeResponseDto, type LedgeResponseDto } from './dto.js';

export function handleCreateLedge(customerId: string, total: number): LedgeResponseDto {
  const order = createLedgeEntry(customerId, total);
  return toLedgeResponseDto(order);
}
