export interface Order {
  id: string;
  customerId: string;
  total: { amount: number; currency: string };
  createdAt: string;
}
