import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './create-user.dto';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello Nest Benchmark!';
  }

  createUser(createUserDto: CreateUserDto) {
    return `Creating user with name: ${createUserDto.name} and email: ${createUserDto.email}`;
  }
}
