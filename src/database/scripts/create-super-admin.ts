/**
 * One-time bootstrap for the platform's first super admin.
 *
 * Usage:
 *   npm run create-super-admin -- --email you@company.com
 *   npm run create-super-admin -- --email you@company.com --password 'Some$trongP4ssword!'
 *   npm run create-super-admin -- --email you@company.com --force   (create another even if one exists)
 *
 * - If --password is omitted, a random strong password is generated and
 *   printed ONCE. It is never written to a file, never logged again, and
 *   never stored anywhere but the (hashed) database column.
 * - The account is created with mustChangePassword=true, so the very first
 *   authenticated request other than /auth/set-password, /auth/me or
 *   /auth/logout is rejected until the password is changed (enforced by
 *   JwtAuthGuard).
 * - Refuses to run if a super admin already exists, unless --force is passed.
 */
import { randomBytes } from 'crypto';
import { IsNull } from 'typeorm';
import { initializeDataSource } from '../data-source';
import { User } from '../schema';
import { PlatformRole, UserStatus } from '../../common/enums';
import { SecurityUtils } from '../../common/utils/security.utils';

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function generateStrongPassword(): string {
  // 24 random bytes, base64url-encoded -> 32 chars, mixed case + digits + symbols.
  // Guaranteed to clear any reasonable strength policy without needing a
  // dictionary/entropy check.
  return randomBytes(24).toString('base64url');
}

const PASSWORD_MIN_LENGTH = 12;

function assertStrongPassword(password: string) {
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSymbol = /[^a-zA-Z0-9]/.test(password);
  const varietyCount = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;

  if (password.length < PASSWORD_MIN_LENGTH || varietyCount < 3) {
    throw new Error(
      `--password must be at least ${PASSWORD_MIN_LENGTH} characters and include at least 3 of: ` +
      'lowercase, uppercase, digit, symbol. Omit --password to have one generated for you.',
    );
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = typeof args.email === 'string' ? args.email.trim().toLowerCase() : undefined;
  const force = args.force === true;
  const explicitPassword = typeof args.password === 'string' ? args.password : undefined;

  if (!email || !isValidEmail(email)) {
    console.error('Usage: npm run create-super-admin -- --email you@company.com [--password ...] [--force]');
    process.exit(1);
    return;
  }

  const dataSource = await initializeDataSource();
  const users = dataSource.getRepository(User);

  const existingSuperAdmin = await users.findOne({
    where: { platformRole: PlatformRole.SUPER_ADMIN, deletedAt: IsNull() },
  });

  if (existingSuperAdmin && !force) {
    console.error(
      `A super admin already exists (${existingSuperAdmin.email}). ` +
      'Pass --force to create another one anyway.',
    );
    process.exit(1);
    return;
  }

  const existingUserWithEmail = await users.findOne({ where: { email, deletedAt: IsNull() } });
  if (existingUserWithEmail) {
    console.error(`A user with email ${email} already exists (id: ${existingUserWithEmail.id}).`);
    process.exit(1);
    return;
  }

  let password: string;
  if (explicitPassword) {
    assertStrongPassword(explicitPassword);
    password = explicitPassword;
  } else {
    password = generateStrongPassword();
  }

  const passwordHash = await SecurityUtils.hashPassword(password);

  const admin = users.create({
    email,
    passwordHash,
    firstName: 'Super',
    lastName: 'Admin',
    status: UserStatus.ACTIVE,
    emailVerified: true,
    platformRole: PlatformRole.SUPER_ADMIN,
    failedLoginAttempts: 0,
    mustChangePassword: true,
  });
  const saved = await users.save(admin);

  console.log('──────────────────────────────────────────────────────────────');
  console.log(' Super admin created.');
  console.log(` Email:    ${saved.email}`);
  console.log(` User ID:  ${saved.id}`);
  if (!explicitPassword) {
    console.log(` Password: ${password}`);
    console.log(' (shown once — it is not stored anywhere in plaintext, save it now)');
  }
  console.log(' A password change will be required on first login.');
  console.log('──────────────────────────────────────────────────────────────');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
