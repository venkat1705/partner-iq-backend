import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { STEP_UP_KEY, StepUpOptions } from '../decorators/require-step-up.decorator';
import { initializeDataSource } from '../../database/data-source';
import { AuthSession } from '../../database/schema';
import { IsNull } from 'typeorm';
import { RequestWithUser } from '../interfaces/request-with-user.interface';

/**
 * Guard that enforces step-up MFA verification on sensitive endpoints.
 * Works with @RequireStepUpMfa() decorator.
 *
 * Checks:
 * 1. Session exists and is active
 * 2. Session has mfaVerifiedAt set
 * 3. mfaVerifiedAt is within the configured maxAgeSeconds window
 *
 * If MFA is not recently verified, throws 403 STEP_UP_REQUIRED.
 * The frontend intercepts this and shows the step-up modal.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<StepUpOptions>(STEP_UP_KEY, context.getHandler());
    if (!options) {
      // No step-up requirement on this handler
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user?.sessionId) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'STEP_UP_REQUIRED',
        message: 'Step-up authentication is required for this action.',
      });
    }

    const maxAgeSeconds = options.maxAgeSeconds ?? 600;

    try {
      const dataSource = await initializeDataSource();
      const session = await dataSource.getRepository(AuthSession).findOne({
        where: { id: user.sessionId, revokedAt: IsNull() },
      });

      if (!session) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'SESSION_EXPIRED',
          message: 'Your session has expired. Please log in again.',
        });
      }

      if (!session.mfaVerifiedAt) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'STEP_UP_REQUIRED',
          message: 'Step-up authentication is required for this action.',
        });
      }

      const ageSeconds = (Date.now() - new Date(session.mfaVerifiedAt).getTime()) / 1000;
      if (ageSeconds > maxAgeSeconds) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'STEP_UP_EXPIRED',
          message: `Recent verification expired. Please verify again to continue.`,
        });
      }

      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      throw new ForbiddenException({
        statusCode: 403,
        error: 'STEP_UP_REQUIRED',
        message: 'Step-up authentication is required for this action.',
      });
    }
  }
}
