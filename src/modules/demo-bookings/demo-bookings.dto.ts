import {
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateDemoBookingDto {
  @IsString() @IsNotEmpty() firstName!: string;
  @IsString() @IsNotEmpty() lastName!: string;
  @IsEmail() email!: string;
  @IsString() @IsNotEmpty() company!: string;
  @IsOptional() @IsString() partnerCount?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() companyWebsite?: string;
  @IsOptional() @IsString() jobTitle?: string;
  @IsOptional() @IsString() jobRole?: string;
  @IsOptional() @IsString() businessModel?: string;
  @IsOptional() @IsString() companySize?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsString() programStatus?: string;
  @IsOptional() @IsString() currentSolution?: string;
  @IsOptional() @IsString() monthlyRevenueRange?: string;
  @IsOptional() @IsArray() goals?: string[];
  @IsOptional() @IsArray() requestedFeatures?: string[];
  @IsOptional() @IsArray() interests?: string[];
  @IsOptional() @IsString() preferredFormat?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() challenge?: string;
  @IsString() @IsNotEmpty() scheduledAt!: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsString() meetingProvider?: string;
  @IsOptional() @IsString() idempotencyKey?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() medium?: string;
  @IsOptional() @IsString() campaign?: string;
  @IsOptional() @IsString() utmSource?: string;
  @IsOptional() @IsString() utmMedium?: string;
  @IsOptional() @IsString() utmCampaign?: string;
  @IsOptional() @IsString() utmTerm?: string;
  @IsOptional() @IsString() utmContent?: string;
  @IsOptional() @IsString() referrer?: string;
  @IsOptional() @IsString() landingPage?: string;
}

export class AssignOwnerDto {
  @IsString() @IsNotEmpty() ownerId!: string;
  @IsString() @IsNotEmpty() ownerName!: string;
}

export class DemoAvailabilityQueryDto {
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() timezone?: string;
}

export class UpdateDemoBookingStatusDto {
  @IsString()
  @IsIn(['new', 'confirmed', 'completed', 'rescheduled', 'cancelled'])
  status!: 'new' | 'confirmed' | 'completed' | 'rescheduled' | 'cancelled';
}

export class RescheduleDemoBookingDto {
  @IsString() @IsNotEmpty() scheduledAt!: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() reason?: string;
}

export class CancelDemoBookingDto {
  @IsString() @IsNotEmpty() reason!: string;
  @IsOptional() @IsString() notes?: string;
}

export class MarkAttendanceDto {
  @IsString()
  @IsIn(['ATTENDED', 'PARTIALLY_ATTENDED', 'NO_SHOW', 'CANCELLED'])
  attendanceStatus!: 'ATTENDED' | 'PARTIALLY_ATTENDED' | 'NO_SHOW' | 'CANCELLED';

  @IsOptional() @IsNumber() durationMinutes?: number;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateQualificationDto {
  @IsString()
  @IsIn(['UNREVIEWED', 'QUALIFIED', 'DISQUALIFIED', 'NEEDS_INFO'])
  qualificationStatus!: 'UNREVIEWED' | 'QUALIFIED' | 'DISQUALIFIED' | 'NEEDS_INFO';

  @IsOptional() @IsArray() signals?: string[];
  @IsOptional() @IsString() notes?: string;
}

export class CreateFollowUpDto {
  @IsString() @IsNotEmpty() dueDate!: string;
  @IsString() @IsNotEmpty() action!: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() owner?: string;
}

export class CreateOpportunityDto {
  @IsString() @IsNotEmpty() stage!: string;
  @IsNumber() estimatedValueRupees!: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() closeDate?: string;
  @IsOptional() @IsString() notes?: string;
}
