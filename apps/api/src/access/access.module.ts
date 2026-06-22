import { Module } from '@nestjs/common';
import { AccessService } from './access.service.js';
import { AccessController } from './access.controller.js';

@Module({
  controllers: [AccessController],
  providers: [AccessService],
})
export class AccessModule {}
