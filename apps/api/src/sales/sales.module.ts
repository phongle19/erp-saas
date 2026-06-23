import { Module } from '@nestjs/common';
import { PartnersService } from './partners.service.js';
import { PartnersController } from './partners.controller.js';

@Module({
  controllers: [PartnersController],
  providers: [PartnersService],
  exports: [PartnersService],
})
export class SalesModule {}
