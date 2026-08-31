import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OAuthModule } from './oauth/oauth.module';

@Module({
  imports: [OAuthModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, OAuthModule],
})
export class AuthModule {}
