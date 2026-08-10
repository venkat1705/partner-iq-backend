import { IsUrl, IsArray, IsEnum, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WebhookEvent } from '../../../common/enums';

export class CreateWebhookEndpointDto {
  @ApiProperty({ example: 'https://acme.com/api/partneriq-webhook' })
  @IsUrl()
  url!: string;

  @ApiProperty({ enum: WebhookEvent, isArray: true, example: [WebhookEvent.CONVERSION_CREATED, WebhookEvent.COMMISSION_CREATED] })
  @IsArray()
  @IsEnum(WebhookEvent, { each: true })
  subscribedEvents!: WebhookEvent[];
}

export class UpdateWebhookEndpointDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: WebhookEvent, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(WebhookEvent, { each: true })
  subscribedEvents?: WebhookEvent[];
}
