import { Module, forwardRef } from '@nestjs/common';
import { AffiliatesController } from './affiliates.controller';
import { AffiliatePortalController } from './affiliate-portal.controller';
import { AffiliatesService } from './affiliates.service';
import { AffiliateAuthController } from './auth/affiliate-auth.controller';
import { AffiliateAuthService } from './auth/affiliate-auth.service';
import { MembershipsModule } from '../memberships/memberships.module';
import { GamificationModule } from '../gamification/gamification.module';
import { AutomationsModule } from '../automations/automations.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [MembershipsModule, GamificationModule, AutomationsModule, forwardRef(() => AuthModule)],
  controllers: [AffiliatesController, AffiliatePortalController, AffiliateAuthController],
  providers: [AffiliatesService, AffiliateAuthService],
  exports: [AffiliatesService],
})
export class AffiliatesModule {}

