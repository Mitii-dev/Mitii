import type { Review } from './reviews.service';

/** In-memory-style persistence layer for Review rows. Swap for a real DB client in production. */
export class ReviewsRepository {
  private rows = new Map<string, Review>();

  async insert(data: Partial<Review>): Promise<Review> {
    const id = `reviews_${this.rows.size + 1}`;
    const row = { id, ...data } as Review;
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<Review | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<Review[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<Review>): Promise<Review> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`Review ${id} not found`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
