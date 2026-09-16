import { Module } from '@nestjs/common';
import { DealsGateway } from './deals.gateway';

@Module({
  providers: [DealsGateway],
  exports: [DealsGateway],
})
export class RealtimeModule {}
