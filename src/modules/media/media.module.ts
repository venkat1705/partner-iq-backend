import { Module } from '@nestjs/common';
import { MediaController, PublicMediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController, PublicMediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
