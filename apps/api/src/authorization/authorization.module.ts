import { Global, Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service.js';
import { RbacBootstrap } from './rbac-bootstrap.js';

@Global()
@Module({
  providers: [RbacBootstrap, AuthorizationService],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
