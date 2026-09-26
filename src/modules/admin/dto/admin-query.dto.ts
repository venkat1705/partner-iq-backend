import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AdminOverviewQueryDto {
  @ApiPropertyOptional({
    description: 'Time window for platform telemetry and growth calculations',
    enum: ['today', '7d', '30d', '90d', '1y', 'all'],
    default: '30d',
  })
  @IsOptional()
  @IsString()
  @IsIn(['today', '7d', '30d', '90d', '1y', 'all', 'Today', '7 Days', '30 Days', '90 Days', '1 Year', 'All Time'])
  period?: string = '30d';

  @ApiPropertyOptional({
    description: 'Filter metrics to a specific organization or ALL for platform-wide',
  })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({
    description: 'Filter metrics by organization lifecycle status',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Filter metrics by billing plan code or ID',
  })
  @IsOptional()
  @IsString()
  planId?: string;
}
