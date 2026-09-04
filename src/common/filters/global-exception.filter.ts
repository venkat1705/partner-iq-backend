import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomBytes } from 'crypto';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    let message = 'Internal server error';
    let errorCode = 'INTERNAL_ERROR';
    let details: any = undefined;

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const resObj = exceptionResponse as any;
      message = resObj.message || message;
      errorCode = resObj.code || resObj.errorCode || (typeof resObj.error === 'string' && resObj.error !== 'Forbidden' && resObj.error !== 'Unauthorized' && resObj.error !== 'Conflict' && resObj.error !== 'Bad Request' ? resObj.error : undefined) || errorCode;
      details = resObj.details || resObj.errors || undefined;
      if (Array.isArray(message)) {
        message = message.join('; ');
      }
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled Exception: ${exception.message}`, exception.stack);
    }

    if (errorCode === 'INTERNAL_ERROR') {
      if (status === HttpStatus.UNAUTHORIZED) {
        errorCode = 'UNAUTHENTICATED';
      } else if (status === HttpStatus.FORBIDDEN) {
        errorCode = 'PERMISSION_DENIED';
      } else if (status === HttpStatus.NOT_FOUND) {
        errorCode = 'RESOURCE_NOT_FOUND';
      } else if (status === HttpStatus.CONFLICT) {
        errorCode = 'CONFLICT';
      } else if (status === HttpStatus.BAD_REQUEST || status === HttpStatus.UNPROCESSABLE_ENTITY) {
        errorCode = 'VALIDATION_ERROR';
      }
    }

    const requestId = (request.headers['x-request-id'] as string) || `req_${randomBytes(12).toString('hex')}`;

    response.status(status).json({
      success: false,
      statusCode: status,
      code: errorCode,
      message,
      details,
      error: {
        code: errorCode,
        message,
        requestId,
      },
      correlationId: requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
