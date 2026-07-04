import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CreateUserDto } from './create-user.dto';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get<AppService>(AppService);
  });

  describe('root', () => {
    it('should return "Hello Nest Benchmark!"', () => {
      expect(appController.getHello()).toBe('Hello Nest Benchmark!');
    });
  });

  describe('createUser', () => {
    it('should create a user with valid data', () => {
      const createUserDto: CreateUserDto = {
        name: 'John Doe',
        email: 'john@example.com'
      };
      
      expect(appController.createUser(createUserDto)).toBe(
        'Creating user with name: John Doe and email: john@example.com'
      );
    });
  });
});