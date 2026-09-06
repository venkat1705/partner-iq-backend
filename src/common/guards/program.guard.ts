import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { dbStore } from '../../database/store';
import { RequestWithUser } from '../interfaces/request-with-user.interface';
import { ProgramAccessType } from '../enums/rbac';

@Injectable()
export class ProgramGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser & { program?: any }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User is not authenticated');
    }

    const organizationId =
      request.params?.organizationId ||
      request.user?.organizationId ||
      request.tenantId;

    const programId =
      request.params?.programId ||
      request.body?.programId ||
      (request.query?.programId as string | undefined);

    // If no programId is specified in the request, allow route to proceed (aggregated org context)
    if (!programId) {
      return true;
    }

    // Verify program exists
    const program = dbStore.programs.find((p) => p.id === programId && !p.deletedAt);
    if (!program) {
      throw new NotFoundException('Program not found');
    }

    // Verify program belongs to the active organization
    if (organizationId && program.organizationId !== organizationId) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PROGRAM_ORGANIZATION_MISMATCH',
        message: 'Program does not belong to the specified organization (IDOR violation)',
      });
    }

    // If user has restricted program access, verify membership in programIds
    if (
      user.programAccessType === ProgramAccessType.SELECTED &&
      !user.isSuperAdmin &&
      user.role !== 'OWNER' &&
      user.role !== 'SUPER_ADMIN'
    ) {
      const allowedProgramIds = user.programIds || [];
      if (!allowedProgramIds.includes(programId)) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'PROGRAM_ACCESS_RESTRICTED',
          message: 'User does not have permission to access this program',
        });
      }
    }

    // Attach program context to request
    request.program = program;
    if (request.partnerIqContext) {
      request.partnerIqContext.programId = programId;
    }

    return true;
  }
}
