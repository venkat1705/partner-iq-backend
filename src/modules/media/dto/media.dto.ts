import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadImageDto {
  @ApiProperty({ example: 'program-logo' })
  @IsIn(['program-logo', 'program-banner', 'organization-logo', 'asset'])
  purpose!: 'program-logo' | 'program-banner' | 'organization-logo' | 'asset';

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
