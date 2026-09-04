import { createPaymentsEntry } from './service.js';
import { toPaymentsResponseDto, type PaymentsResponseDto } from './dto.js';

export function handleCreatePayments(customerId: string, total: number): PaymentsResponseDto {
  const order = createPaymentsEntry(customerId, total);
  return toPaymentsResponseDto(order);
}
