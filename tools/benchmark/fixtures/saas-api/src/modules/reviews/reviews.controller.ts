import { ReviewsService } from './reviews.service';
import type { CreateReviewDto } from './dto/create-review.dto';

/** HTTP entry points for the Reviews module, mounted at /reviews. */
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  async create(req: { body: CreateReviewDto }) {
    return this.reviewsService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.reviewsService.findById(req.params.id);
  }

  async findAll() {
    return this.reviewsService.list();
  }

  async flagReviewRoute(req: { params: { id?: string }; body: unknown }) {
    return this.reviewsService.flagReview(req.params.id as string, req.body as never);
  }

  async computeAverageRatingRoute(req: { params: { id?: string }; body: unknown }) {
    return this.reviewsService.computeAverageRating(req.params.id as string, req.body as never);
  }
}
