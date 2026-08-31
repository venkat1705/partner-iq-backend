import { BadRequestException } from '@nestjs/common';
import { EnvironmentType } from '../enums';
import { PartnerIqRequestContext } from '../interfaces/request-with-user.interface';

export class EnvironmentUtils {
  /**
   * Normalizes a string representation to EnvironmentType enum
   */
  static normalizeEnvironment(env?: string | null): EnvironmentType {
    if (!env) {
      return EnvironmentType.LIVE;
    }
    const upper = env.toUpperCase().trim();
    if (upper === 'TEST' || upper === 'SANDBOX') {
      return EnvironmentType.TEST;
    }
    if (upper === 'LIVE' || upper === 'PRODUCTION') {
      return EnvironmentType.LIVE;
    }
    throw new BadRequestException(`Invalid environment '${env}'. Expected 'TEST' or 'LIVE'.`);
  }

  /**
   * Builds a safe tenant + environment where clause for database and store queries
   */
  static buildTenantEnvironmentWhere<T extends Record<string, any>>(
    context: { organizationId: string; environment: EnvironmentType | string },
    additionalWhere?: T,
  ): { organizationId: string; environment: EnvironmentType } & T {
    const environment = this.normalizeEnvironment(context.environment);
    return {
      organizationId: context.organizationId,
      environment,
      ...(additionalWhere || {} as T),
    };
  }

  /**
   * Asserts that cross-environment relations are prohibited
   */
  static assertEnvironmentIntegrity(
    parent: { environment?: string | EnvironmentType; organizationId?: string; id?: string },
    child: { environment?: string | EnvironmentType; organizationId?: string; id?: string },
    resourceName = 'Entity',
  ) {
    if (parent.environment && child.environment) {
      const parentEnv = this.normalizeEnvironment(parent.environment);
      const childEnv = this.normalizeEnvironment(child.environment);
      if (parentEnv !== childEnv) {
        throw new BadRequestException(
          `Cross-environment violation: Cannot link ${resourceName} in ${childEnv} to a parent in ${parentEnv}.`,
        );
      }
    }
    if (parent.organizationId && child.organizationId && parent.organizationId !== child.organizationId) {
      throw new BadRequestException(
        `Cross-tenant violation: Cannot link ${resourceName} across different organizations.`,
      );
    }
  }
}
