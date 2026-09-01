import { Module } from '@nestjs/common';
import { EmailDesignController } from './email-design.controller';
import { EmailDesignService } from './email-design.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [EmailDesignController],
  providers: [EmailDesignService],
  exports: [EmailDesignService],
})
export class EmailDesignModule {}

export default EmailDesignModule;
