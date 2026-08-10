import { IsEmail, IsEnum, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../../common/enums';

export class InviteMemberDto {
  @ApiProperty({ example: 'colleague@company.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: Role, example: Role.ADMIN })
  @IsEnum(Role)
  role!: Role;
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: Role, example: Role.PROGRAM_MANAGER })
  @IsEnum(Role)
  role!: Role;
}

export class AcceptInvitationDto {
  @ApiPropertyOptional({ example: 'Jane' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiProperty({ example: 'StrongPassword123!' })
  @IsString()
  @MinLength(12)
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message: 'Password must contain uppercase, lowercase, number and special character',
  })
  password!: string;
}
