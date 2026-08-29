import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  Min,
  Max,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  AutomationTriggerType,
  AutomationWorkflowStatus,
  AutomationNodeType,
  AutomationActionType,
} from '../../../common/enums';

export class AutomationNodeConfigDto {
  // DELAY node config
  @IsNumber()
  @IsOptional()
  delayAmount?: number;

  @IsString()
  @IsOptional()
  delayUnit?: 'MINUTES' | 'HOURS' | 'DAYS';

  @IsString()
  @IsOptional()
  delayUntilTime?: string; // '09:00'

  // CONDITION node config
  @IsArray()
  @IsOptional()
  conditions?: Array<{
    field: string;
    operator: string;
    value: any;
  }>;

  @IsString()
  @IsOptional()
  matchType?: 'ALL' | 'ANY';

  // ACTION node config
  @IsEnum(AutomationActionType)
  @IsOptional()
  actionType?: AutomationActionType;

  @IsString()
  @IsOptional()
  emailTemplateCode?: string;

  @IsString()
  @IsOptional()
  notificationTitle?: string;

  @IsString()
  @IsOptional()
  notificationBody?: string;

  @IsString()
  @IsOptional()
  tierId?: string;

  @IsString()
  @IsOptional()
  badgeName?: string;

  @IsNumber()
  @IsOptional()
  bonusAmountCents?: number;

  @IsString()
  @IsOptional()
  tag?: string;

  @IsString()
  @IsOptional()
  webhookUrl?: string;

  // GOAL node config
  @IsString()
  @IsOptional()
  goalType?: string;

  @IsOptional()
  goalConfig?: Record<string, any>;
}

export class AutomationNodeDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsEnum(AutomationNodeType)
  type!: AutomationNodeType;

  @IsString()
  @IsOptional()
  name?: string;

  @IsOptional()
  config!: Record<string, any>;

  @IsOptional()
  position?: { x: number; y: number };
}

export class AutomationEdgeDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  sourceNodeId!: string;

  @IsString()
  @IsNotEmpty()
  targetNodeId!: string;

  @IsString()
  @IsOptional()
  branchKey?: string; // 'YES' | 'NO' | 'DEFAULT'
}

export class CreateAutomationWorkflowDto {
  @IsString()
  @IsOptional()
  programId?: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(AutomationTriggerType)
  triggerType!: AutomationTriggerType;

  @IsEnum(AutomationWorkflowStatus)
  @IsOptional()
  status?: AutomationWorkflowStatus;

  @IsString()
  @IsOptional()
  goalType?: string;

  @IsOptional()
  goalConfig?: Record<string, any>;

  @IsNumber()
  @Min(1)
  @Max(20)
  @IsOptional()
  maxEmailsPerDay?: number;

  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  maxEmailsPerWeek?: number;

  @IsBoolean()
  @IsOptional()
  quietHoursEnabled?: boolean;

  @IsString()
  @IsOptional()
  quietHoursStart?: string;

  @IsString()
  @IsOptional()
  quietHoursEnd?: string;

  @IsArray()
  @IsOptional()
  nodes?: AutomationNodeDto[];

  @IsArray()
  @IsOptional()
  edges?: AutomationEdgeDto[];
}

export class UpdateAutomationWorkflowDto extends CreateAutomationWorkflowDto {}

export class InstallTemplateDto {
  @IsString()
  @IsNotEmpty()
  templateId!: string;

  @IsString()
  @IsOptional()
  programId?: string;

  @IsString()
  @IsOptional()
  customName?: string;
}
