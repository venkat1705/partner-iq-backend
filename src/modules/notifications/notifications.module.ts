import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationGateway, NotificationsService],
  exports: [NotificationGateway, NotificationsService],
})
export class NotificationsModule {}
