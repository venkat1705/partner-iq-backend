import {
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagsService } from '../../modules/admin/feature-flags/feature-flags.service';

export const FEATURE_FLAG_KEY = 'FEATURE_FLAG_KEY';

export interface FeatureFlagOptions {
  failClosed?: boolean;
}

export const FeatureFlag = (flagKey: string, options?: FeatureFlagOptions) =>
  SetMetadata(FEATURE_FLAG_KEY, { flagKey, options });

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlagsService: FeatureFlagsService
  ) { }

  canActivate(context: ExecutionContext): boolean {
    const meta = this.reflector.get<{ flagKey: string; options?: FeatureFlagOptions }>(
      FEATURE_FLAG_KEY,
      context.getHandler()
    );

    if (!meta) {
      return true; // No feature flag decorator on this handler
    }

    const request = context.switchToHttp().getRequest();
    const env =
      request.headers['x-environment'] ||
      (process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'DEVELOPMENT');

    const evalResult = this.featureFlagsService.evaluate(meta.flagKey, {
      environment: env,
      organizationId: request.user?.organizationId || request.organization?.id,
      userId: request.user?.id,
      role: request.user?.role,
      plan: request.organization?.plan,
    });

    if (!evalResult.enabled) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: `Feature '${meta.flagKey}' is disabled for this organization/environment.`,
        code: 'FEATURE_DISABLED',
        flagKey: meta.flagKey,
      });
    }

    return true;
  }
}
