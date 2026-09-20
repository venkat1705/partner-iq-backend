import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadImageDto {
  @ApiProperty({ example: 'organization-logo' })
  @IsIn(['program-logo', 'program-banner', 'organization-logo', 'asset', 'affiliate-avatar', 'user-avatar'])
  purpose!: 'program-logo' | 'program-banner' | 'organization-logo' | 'asset' | 'affiliate-avatar' | 'user-avatar';

  @ApiProperty({ example: 'logo.png' })
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ example: 'image/png' })
  @IsString()
  @Matches(/^image\/(png|jpe?g|webp|gif)$/)
  mimeType!: string;

  @ApiProperty({ example: 'data:image/png;base64,...' })
  @IsString()
  dataUrl!: string;
}
