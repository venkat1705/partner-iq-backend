import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DemoBookingsService } from './demo-bookings.service';
import { CreateDemoBookingDto, UpdateDemoBookingStatusDto } from './demo-bookings.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Demo Bookings')
@Controller('api/v1')
export class DemoBookingsController {
  constructor(private readonly demoBookingsService: DemoBookingsService) {}

  @Post('demo-bookings')
  @ApiOperation({ summary: 'Create a public demo booking request' })
  async create(@Body() dto: CreateDemoBookingDto) {
    return this.demoBookingsService.create(dto);
  }

  @Get('demo-bookings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List demo bookings for the admin console' })
  async list(@Query('status') status?: string) {
    return this.demoBookingsService.list(status);
  }

  @Patch('demo-bookings/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a demo booking status' })
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateDemoBookingStatusDto) {
    return this.demoBookingsService.updateStatus(id, dto.status);
  }
}
