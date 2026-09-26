import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DemoBookingsService } from './demo-bookings.service';
import {
  CreateDemoBookingDto,
  UpdateDemoBookingStatusDto,
  RescheduleDemoBookingDto,
  CancelDemoBookingDto,
  MarkAttendanceDto,
  UpdateQualificationDto,
  CreateFollowUpDto,
  CreateOpportunityDto,
  AssignOwnerDto,
  DemoAvailabilityQueryDto,
} from './demo-bookings.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../../common/interfaces/request-with-user.interface';

@ApiTags('Demo Bookings')
@Controller('api/v1')
export class DemoBookingsController {
  constructor(private readonly demoBookingsService: DemoBookingsService) { }

  // 1a. Public Endpoint: Get Real-Time Slot Availability
  @Get('demo-bookings/availability')
  @ApiOperation({ summary: 'Get available dates and time slots for demo booking' })
  async getAvailability(@Query() query: DemoAvailabilityQueryDto) {
    return this.demoBookingsService.getAvailability(query);
  }

  // 1b. Public Endpoint: Create demo booking request
  @Post('demo-bookings')
  @ApiOperation({ summary: 'Create a public demo booking request' })
  async create(@Body() dto: CreateDemoBookingDto) {
    return this.demoBookingsService.create(dto);
  }

  // 1c. Public Endpoint: Get booking details by secure customer token
  @Get('demo-bookings/token/:token')
  @ApiOperation({ summary: 'Retrieve public demo booking details using secure token' })
  async getByToken(@Param('token') token: string) {
    return this.demoBookingsService.getByToken(token);
  }

  // 1d. Public Endpoint: Reschedule booking by secure customer token
  @Post('demo-bookings/token/:token/reschedule')
  @ApiOperation({ summary: 'Reschedule demo booking using secure token' })
  async rescheduleByToken(
    @Param('token') token: string,
    @Body() dto: RescheduleDemoBookingDto,
  ) {
    return this.demoBookingsService.rescheduleByToken(token, dto);
  }

  // 1e. Public Endpoint: Cancel booking by secure customer token
  @Post('demo-bookings/token/:token/cancel')
  @ApiOperation({ summary: 'Cancel demo booking using secure token' })
  async cancelByToken(
    @Param('token') token: string,
    @Body() dto: CancelDemoBookingDto,
  ) {
    return this.demoBookingsService.cancelByToken(token, dto);
  }

  // 2. Admin Endpoint: Aggregated Performance Analytics
  @Get('admin/demo-bookings/analytics')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get demo bookings KPI analytics and funnel performance' })
  async analytics(@Query('period') period?: string) {
    return this.demoBookingsService.analytics(period);
  }

  // 3. Admin Endpoint: Today's Scheduled Demos
  @Get('admin/demo-bookings/today')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get today's scheduled demos" })
  async today() {
    return this.demoBookingsService.todayDemos();
  }

  // 4. Admin Endpoint: Calendar Workspace Events
  @Get('admin/demo-bookings/calendar')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get calendar events for scheduling workspace' })
  async calendar(
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('host') host?: string,
    @Query('status') status?: string,
  ) {
    return this.demoBookingsService.calendar(start, end, host, status);
  }

  // 5. Admin Endpoint: Follow-Up Queue
  @Get('admin/demo-bookings/follow-ups')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get follow-up action queue' })
  async followUps(@Query('status') status?: string) {
    return this.demoBookingsService.followUpsList(status);
  }

  // 6. Admin Endpoint: Commercial Opportunities
  @Get('admin/demo-bookings/opportunities')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get sales opportunities tied to demo bookings' })
  async opportunities() {
    return this.demoBookingsService.opportunitiesList();
  }

  // 7. Admin Endpoint: Exceptions & Anomaly Alerts
  @Get('admin/demo-bookings/exceptions')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get operational booking anomalies and attention alerts' })
  async exceptions() {
    return this.demoBookingsService.exceptionsList();
  }

  // 8. Admin Endpoint: Audit Trail
  @Get('admin/demo-bookings/audit-logs')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get immutable audit trail of demo booking events' })
  async auditLogs(@Query('bookingId') bookingId?: string) {
    return this.demoBookingsService.auditLogs(bookingId);
  }

  // 9. Admin Endpoint: List Demo Bookings (with multi-field search & filters)
  @Get('admin/demo-bookings')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List demo bookings for the admin console' })
  async list(
    @Query('status') status?: string,
    @Query('attendanceStatus') attendanceStatus?: string,
    @Query('qualificationStatus') qualificationStatus?: string,
    @Query('host') host?: string,
    @Query('source') source?: string,
    @Query('search') search?: string,
  ) {
    return this.demoBookingsService.list({
      status,
      attendanceStatus,
      qualificationStatus,
      host,
      source,
      search,
    });
  }

  // 10. Admin Endpoint: Admin Created Booking
  @Post('admin/demo-bookings')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a demo booking from admin console' })
  async adminCreate(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateDemoBookingDto,
  ) {
    return this.demoBookingsService.create(dto, user?.userId);
  }

  // 11. Admin Endpoint: Get Single Booking Detail
  @Get('admin/demo-bookings/:id')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get demo booking details' })
  async getById(@Param('id') id: string) {
    return this.demoBookingsService.getById(id);
  }

  // 12. Admin Endpoint: Update Booking Status
  @Patch('admin/demo-bookings/:id/status')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a demo booking status' })
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpdateDemoBookingStatusDto,
  ) {
    return this.demoBookingsService.updateStatus(id, dto.status, user?.userId);
  }

  // 13. Admin Endpoint: Reschedule Booking
  @Post('admin/demo-bookings/:id/reschedule')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reschedule demo meeting' })
  async reschedule(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: RescheduleDemoBookingDto,
  ) {
    return this.demoBookingsService.reschedule(id, dto, user?.userId);
  }

  // 14. Admin Endpoint: Cancel Booking
  @Post('admin/demo-bookings/:id/cancel')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel demo meeting with reason' })
  async cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CancelDemoBookingDto,
  ) {
    return this.demoBookingsService.cancel(id, dto, user?.userId);
  }

  // 15. Admin Endpoint: Mark Attendance
  @Post('admin/demo-bookings/:id/attendance')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record demo attendance outcome and duration' })
  async markAttendance(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: MarkAttendanceDto,
  ) {
    return this.demoBookingsService.markAttendance(id, dto, user?.userId);
  }

  // 16. Admin Endpoint: Update Qualification Status
  @Post('admin/demo-bookings/:id/qualification')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update prospect qualification status and signals' })
  async updateQualification(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpdateQualificationDto,
  ) {
    return this.demoBookingsService.updateQualification(id, dto, user?.userId);
  }

  // 17. Admin Endpoint: Create Follow-up Action
  @Post('admin/demo-bookings/:id/follow-up')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create follow-up action item' })
  async createFollowUp(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateFollowUpDto,
  ) {
    return this.demoBookingsService.createFollowUp(id, dto, user?.userId);
  }

  // 18. Admin Endpoint: Complete Follow-up Action
  @Post('admin/demo-bookings/:id/follow-up/complete')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark follow-up action as completed' })
  async completeFollowUp(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.demoBookingsService.completeFollowUp(id, user?.userId);
  }

  // 19. Admin Endpoint: Create Opportunity
  @Post('admin/demo-bookings/:id/opportunity')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Convert demo prospect to commercial sales opportunity' })
  async createOpportunity(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateOpportunityDto,
  ) {
    return this.demoBookingsService.createOpportunity(id, dto, user?.userId);
  }

  // 20. Admin Endpoint: Assign Owner
  @Post('admin/demo-bookings/:id/assign')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assign sales owner or specialist to demo booking' })
  async assignOwner(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: AssignOwnerDto,
  ) {
    return this.demoBookingsService.assignOwner(id, dto, user?.userId);
  }
}
