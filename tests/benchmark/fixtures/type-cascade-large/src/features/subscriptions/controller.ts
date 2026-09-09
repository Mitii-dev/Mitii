import { createSubscriptionsEntry } from './service.js';
import { toSubscriptionsResponseDto, type SubscriptionsResponseDto } from './dto.js';

export function handleCreateSubscriptions(customerId: string, total: number): SubscriptionsResponseDto {
  const order = createSubscriptionsEntry(customerId, total);
  return toSubscriptionsResponseDto(order);
}
