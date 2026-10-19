/**
 * Domain types for the account / credit system.
 *
 * Persistence is intentionally file-based (data/*.json): the app runs as a
 * single instance for the dissertation experiment, so a database would add
 * setup cost without changing the architecture under study.
 */

export type UserRole = 'admin' | 'user';
export type UserStatus = 'pending' | 'approved' | 'rejected';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  /** Remaining credits. Ignored for admins (unlimited access). */
  credits: number;
  /** Credits granted at approval — used by the UI to render "X of Y left". */
  creditLimit: number;
  createdAt: string;
  approvedAt?: string;
}

/** Anonymous try-on session. Gets the admin-configured guest credit limit. */
export interface GuestRecord {
  id: string;
  credits: number;
  creditLimit: number;
  createdAt: string;
}

export interface AppSettings {
  /** Credits granted to each new guest session. Editable in the admin panel. */
  guestCreditLimit: number;
}

/** Shape of the JWT payload attached to authenticated requests. */
export interface AuthPrincipal {
  sub: string;
  role: UserRole | 'guest';
  name?: string;
  email?: string;
}

/** User record with the password hash stripped, safe to return to clients. */
export type PublicUser = Omit<UserRecord, 'passwordHash'>;

export function toPublicUser(user: UserRecord): PublicUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}
