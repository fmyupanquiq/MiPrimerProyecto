import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { BootstrapAdminService } from './bootstrap-admin.service.js';
import { PasswordHasher } from './password-hasher.js';

@Module({
  imports: [UsersModule],
  providers: [PasswordHasher, BootstrapAdminService],
  exports: [PasswordHasher, BootstrapAdminService],
})
export class AuthModule {}
