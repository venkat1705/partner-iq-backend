import { Module, forwardRef } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OAuthModule } from './oauth/oauth.module';
import { RiskEngineService } from './risk-engine.service';
import { LegalAcceptanceService } from './legal-acceptance.service';
import { EmailDesignModule } from '../email-design/email-design.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [forwardRef(() => OAuthModule), forwardRef(() => EmailDesignModule), NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, RiskEngineService, LegalAcceptanceService],
  exports: [AuthService, RiskEngineService, LegalAcceptanceService, OAuthModule],
})
export class AuthModule {}
