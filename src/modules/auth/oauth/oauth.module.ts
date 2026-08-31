import { Module, forwardRef } from '@nestjs/common';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { GoogleOAuthService } from './providers/google/google-oauth.service';
import { OAuthStateService } from './state/oauth-state.service';
import { AuthService } from '../auth.service';
import { MembershipsModule } from '../../memberships/memberships.module';
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [
    NotificationsModule,
    forwardRef(() => MembershipsModule),
  ],
  controllers: [OAuthController],
  providers: [
    OAuthService,
    GoogleOAuthService,
    OAuthStateService,
    AuthService,
  ],
  exports: [OAuthService, GoogleOAuthService, OAuthStateService],
})
export class OAuthModule {}
