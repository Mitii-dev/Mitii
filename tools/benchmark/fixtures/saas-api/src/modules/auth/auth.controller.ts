import { AuthService } from './auth.service';
import type { RegisterDto } from './dto/register.dto';

/** HTTP entry points for the Auth module, mounted at /auth. */
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  async create(req: { body: RegisterDto }) {
    return this.authService.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.authService.findById(req.params.id);
  }

  async findAll() {
    return this.authService.list();
  }

  async hashPasswordRoute(req: { params: { id?: string }; body: unknown }) {
    return this.authService.hashPassword(req.params.id as string, req.body as never);
  }

  async generateAccessTokenRoute(req: { params: { id?: string }; body: unknown }) {
    return this.authService.generateAccessToken(req.params.id as string, req.body as never);
  }

  async refreshAccessTokenRoute(req: { params: { id?: string }; body: unknown }) {
    return this.authService.refreshAccessToken(req.params.id as string, req.body as never);
  }
}
