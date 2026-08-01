import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';

/** Wires the Auth controller/service/repository together for the app module. */
export class AuthModule {
  readonly repository = new AuthRepository();
  readonly service = new AuthService(this.repository);
  readonly controller = new AuthController(this.service);
}
