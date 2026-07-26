import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { ReviewsRepository } from './reviews.repository';

/** Wires the Reviews controller/service/repository together for the app module. */
export class ReviewsModule {
  readonly repository = new ReviewsRepository();
  readonly service = new ReviewsService(this.repository);
  readonly controller = new ReviewsController(this.service);
}
