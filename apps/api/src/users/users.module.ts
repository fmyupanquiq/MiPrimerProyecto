import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [SessionsModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
