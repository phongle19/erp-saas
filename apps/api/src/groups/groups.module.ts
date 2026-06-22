import { Module } from '@nestjs/common';
import { GroupsService } from './groups.service.js';
import { GroupsController } from './groups.controller.js';

@Module({
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
