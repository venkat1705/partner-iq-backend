/**
 * The application's storage errors. Every provider error is converted to one of these inside the storage module;
 * features never see SDK error types. They extend Nest HTTP exceptions so a feature can let them propagate and the
 * client gets a meaningful status code.
 */
import { HttpException, HttpStatus } from '@nestjs/common';

export abstract class StorageError extends HttpException {
  abstract readonly code: string;
}

export class StorageNotFoundError extends StorageError {
  readonly code = 'STORAGE_OBJECT_NOT_FOUND';
  constructor(message = 'The file does not exist in storage.') {
    super({ statusCode: HttpStatus.NOT_FOUND, code: 'STORAGE_OBJECT_NOT_FOUND', message }, HttpStatus.NOT_FOUND);
  }
}

/** The storage service refused our credentials or policy — a server configuration problem, not the user's fault. */
export class StorageAccessDeniedError extends StorageError {
  readonly code = 'STORAGE_ACCESS_DENIED';
  constructor(message = 'File storage refused the request. Please try again later.') {
    super({ statusCode: HttpStatus.SERVICE_UNAVAILABLE, code: 'STORAGE_ACCESS_DENIED', message }, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

export class StorageTimeoutError extends StorageError {
  readonly code = 'STORAGE_TIMEOUT';
  constructor(message = 'File storage did not answer in time. Nothing was saved; please retry.') {
    super({ statusCode: HttpStatus.GATEWAY_TIMEOUT, code: 'STORAGE_TIMEOUT', message }, HttpStatus.GATEWAY_TIMEOUT);
  }
}

export class StorageUnavailableError extends StorageError {
  readonly code = 'STORAGE_UNAVAILABLE';
  constructor(message = 'File storage is not reachable. Nothing was saved; please retry.') {
    super({ statusCode: HttpStatus.SERVICE_UNAVAILABLE, code: 'STORAGE_UNAVAILABLE', message }, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

export class StorageTooLargeError extends StorageError {
  readonly code = 'STORAGE_FILE_TOO_LARGE';
  constructor(message: string, readonly limitBytes?: number) {
    super({ statusCode: HttpStatus.PAYLOAD_TOO_LARGE, code: 'STORAGE_FILE_TOO_LARGE', message, details: limitBytes !== undefined ? { limitBytes } : undefined }, HttpStatus.PAYLOAD_TOO_LARGE);
  }
}

export class StorageRejectedTypeError extends StorageError {
  readonly code = 'STORAGE_FILE_TYPE_REJECTED';
  constructor(message: string) {
    super({ statusCode: HttpStatus.UNSUPPORTED_MEDIA_TYPE, code: 'STORAGE_FILE_TYPE_REJECTED', message }, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
  }
}

/** The upload stream ended early (client disconnected / cancelled). */
export class StorageUploadAbortedError extends StorageError {
  readonly code = 'STORAGE_UPLOAD_ABORTED';
  constructor(message = 'The upload was interrupted before the file was complete. Nothing was saved.') {
    super({ statusCode: HttpStatus.BAD_REQUEST, code: 'STORAGE_UPLOAD_ABORTED', message }, HttpStatus.BAD_REQUEST);
  }
}

/** Stored size differs from the bytes we counted — the object is deleted and the upload fails. */
export class StorageIntegrityError extends StorageError {
  readonly code = 'STORAGE_INTEGRITY_FAILED';
  constructor(message: string) {
    super({ statusCode: HttpStatus.BAD_GATEWAY, code: 'STORAGE_INTEGRITY_FAILED', message }, HttpStatus.BAD_GATEWAY);
  }
}

export class StorageKeyError extends StorageError {
  readonly code = 'STORAGE_INVALID_KEY';
  constructor(message: string) {
    super({ statusCode: HttpStatus.BAD_REQUEST, code: 'STORAGE_INVALID_KEY', message }, HttpStatus.BAD_REQUEST);
  }
}
