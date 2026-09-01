import { IsArray, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateDemoBookingDto {
  @IsString() @IsNotEmpty() firstName!: string;
  @IsString() @IsNotEmpty() lastName!: string;
  @IsEmail() email!: string;
  @IsString() @IsNotEmpty() company!: string;
  @IsString() @IsNotEmpty() partnerCount!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() jobTitle?: string;
  @IsOptional() @IsString() businessModel?: string;
  @IsOptional() @IsString() companySize?: string;
  @IsOptional() @IsString() programStatus?: string;
  @IsOptional() @IsArray() interests?: string[];
  @IsString() @IsNotEmpty() challenge!: string;
  @IsString() @IsNotEmpty() scheduledAt!: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() host?: string;
}

export class UpdateDemoBookingStatusDto {
  @IsString() @IsIn(['new', 'confirmed', 'completed', 'rescheduled', 'cancelled'])
  status!: 'new' | 'confirmed' | 'completed' | 'rescheduled' | 'cancelled';
}
