import { Role } from '../enums';
import { BUILT_IN_ROLES, PERMISSION_ALIASES } from './permission-catalog';

type BuiltInRole = {
  name: string;
  code: string;
  description: string;
  permissions: string[];
};

export const ROLE_PERMISSIONS: Record<Role, string[]> = (() => {
  const map = {} as Record<Role, string[]>;
  Object.entries(BUILT_IN_ROLES).forEach(([role, roleData]) => {
    map[role as Role] = (roleData as BuiltInRole).permissions;
  });
  return map;
})();

export function getRolePermissions(role: Role): string[] {
  return ROLE_PERMISSIONS[role] || [];
}

function permissionMatches(permissionRequirements: string[], permission: string): boolean {
  if (permissionRequirements.includes('*')) return true;
  if (permissionRequirements.includes(permission)) return true;

  const [resource, action] = permission.split('.');
  if (!resource || !action) {
    return false;
  }

  return permissionRequirements.some((p) => p === `${resource}.*`);
}

export function hasPermission(role: Role, requiredPermission: string): boolean {
  const normalized = requiredPermission.trim();
  const rolePermissions = getRolePermissions(role);

  if (permissionMatches(rolePermissions, normalized)) {
    return true;
  }

  const aliases = PERMISSION_ALIASES[normalized] || [normalized];
  return aliases.some((permission) => permissionMatches(rolePermissions, permission));
}
