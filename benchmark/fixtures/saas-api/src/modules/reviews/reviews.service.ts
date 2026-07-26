import { ReviewsRepository } from './reviews.repository';
import type { CreateReviewDto } from './dto/create-review.dto';
import type { ModerateReviewDto } from './dto/moderate-review.dto';

const FLAG_THRESHOLD = 5;
export interface Review {
  id: string;
  productId: string;
  rating: number;
  body: string;
}

export class ReviewsService {
  constructor(private readonly repository: ReviewsRepository) {}

  async create(dto: CreateReviewDto): Promise<Review> {
    return this.repository.insert(dto as Partial<Review>);
  }

  async findById(id: string): Promise<Review> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(`Review ${id} not found`);
    return row;
  }

  async list(): Promise<Review[]> {
    return this.repository.findAll();
  }

  /**
   * Flags a review for moderator attention when it is reported by another user; hides it from public listing once FLAG_THRESHOLD is reached.
   */
  async flagReview(id: string, flaggedBy: string): Promise<Review> {
    const review = await this.repository.incrementFlagCount(id, flaggedBy);
    if (review.flagCount >= FLAG_THRESHOLD) return this.repository.update(id, { status: 'hidden' });
    return review;
  }

  /**
   * Computes the rolling average rating for a product across all published (non-hidden) reviews.
   */
  async computeAverageRating(productId: string): Promise<number> {
    return this.repository.averageRatingForProduct(productId);
  }
}
