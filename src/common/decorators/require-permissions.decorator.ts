import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const PERMISSIONS_MODE_KEY = 'permissionsMode';

export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
export const RequireAllPermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_MODE_KEY, 'ANY')(
    SetMetadata(PERMISSIONS_KEY, permissions),
  );
