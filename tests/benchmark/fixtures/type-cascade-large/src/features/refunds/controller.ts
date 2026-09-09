import { createRefundsEntry } from './service.js';
import { toRefundsResponseDto, type RefundsResponseDto } from './dto.js';

export function handleCreateRefunds(customerId: string, total: number): RefundsResponseDto {
  const order = createRefundsEntry(customerId, total);
  return toRefundsResponseDto(order);
}
