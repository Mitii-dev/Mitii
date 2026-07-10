export interface PageRequest {
  page: number;
  pageSize: number;
}

export function paginate<T>(items: T[], { page, pageSize }: PageRequest): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
