import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';

describe('AppService', () => {
  let appService: AppService;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      providers: [AppService],
    }).compile();

    appService = app.get<AppService>(AppService);
  });

  describe('getHello', () => {
    it('should return "Hello Nest Benchmark!"', () => {
      expect(appService.getHello()).toBe('Hello Nest Benchmark!');
    });
  });

  describe('createUser', () => {
    it('should create a user with valid data', () => {
      const result = appService.createUser({
        name: 'John Doe',
        email: 'john@example.com'
      });
      
      expect(result).toContain('Creating user with name: John Doe and email: john@example.com');
    });
  });
});