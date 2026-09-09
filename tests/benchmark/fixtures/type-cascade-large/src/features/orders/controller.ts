import { createOrdersEntry } from './service.js';
import { toOrdersResponseDto, type OrdersResponseDto } from './dto.js';

export function handleCreateOrders(customerId: string, total: number): OrdersResponseDto {
  const order = createOrdersEntry(customerId, total);
  return toOrdersResponseDto(order);
}
