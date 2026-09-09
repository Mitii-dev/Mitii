import { createInvoicesEntry } from './service.js';
import { toInvoicesResponseDto, type InvoicesResponseDto } from './dto.js';

export function handleCreateInvoices(customerId: string, total: number): InvoicesResponseDto {
  const order = createInvoicesEntry(customerId, total);
  return toInvoicesResponseDto(order);
}
