import { Module, forwardRef } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OAuthModule } from './oauth/oauth.module';
import { RiskEngineService } from './risk-engine.service';
import { EmailDesignModule } from '../email-design/email-design.module';

@Module({
  imports: [forwardRef(() => OAuthModule), forwardRef(() => EmailDesignModule)],
  controllers: [AuthController],
  providers: [AuthService, RiskEngineService],
  exports: [AuthService, RiskEngineService, OAuthModule],
})
export class AuthModule {}
