import { Module } from '@nestjs/common';
import { DemoBookingsController } from './demo-bookings.controller';
import { DemoBookingsService } from './demo-bookings.service';
import { GoogleCalendarService } from './google-calendar.service';
import { GoogleCalendarOAuthService } from './google-calendar-oauth.service';
import { GoogleCalendarOAuthController } from './google-calendar-oauth.controller';
import { EmailDesignModule } from '../email-design/email-design.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [EmailDesignModule, IntegrationsModule],
  controllers: [DemoBookingsController, GoogleCalendarOAuthController],
  providers: [DemoBookingsService, GoogleCalendarService, GoogleCalendarOAuthService],
  exports: [DemoBookingsService],
})
export class DemoBookingsModule {}
