import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'agrirover_session';
export const SESSION_DAYS = 7;

// The shared account behind the Demo login button. Nobody can sign in to it with a password.
export const DEMO_PHONE = '9000000000';

export const GENDERS = ['female', 'male'];
export const FARM_TYPES = ['crop', 'orchard', 'vegetable', 'dairy', 'poultry', 'mixed', 'other'];

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

// scrypt with a per-user salt. Parameters travel with the hash, so they can be raised later without locking anyone out.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, n, r, p, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

// Compared against when the phone number is unknown, so "no such user" costs the same time as "wrong password".
const DUMMY_HASH = hashPassword('not-a-real-password');

/**
 * Indian mobile numbers: ten digits starting 6-9, typed with or without +91 / 0 / spaces / dashes.
 * Returns the ten digits, or null.
 */
export function normalizePhone(input) {
  let digits = String(input ?? '').replace(/[\s\-().]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Checks a signup body. Returns `{ ok: true, value }` or `{ ok: false, fields }` where `fields` maps a field to an
 * error code the page translates. Nothing here ever echoes the password back.
 */
export function validateSignup(body) {
  const fields = {};
  const b = body && typeof body === 'object' ? body : {};

  const name = clean(b.name, 60);
  if (name.length < 2) fields.name = 'name_short';

  const gender = String(b.gender ?? '');
  if (!GENDERS.includes(gender)) fields.gender = 'gender_required';

  const phone = normalizePhone(b.phone);
  if (!phone) fields.phone = 'phone_invalid';

  const farmType = String(b.farmType ?? '');
  const farmTypeOther = clean(b.farmTypeOther, 60);
  if (!FARM_TYPES.includes(farmType)) fields.farmType = 'farm_type_required';
  else if (farmType === 'other' && farmTypeOther.length < 2) fields.farmTypeOther = 'farm_type_other_required';

  const village = clean(b.village, 80);
  const district = clean(b.district, 80);
  const state = clean(b.state, 80);
  if (district.length < 2) fields.district = 'district_required';
  if (state.length < 2) fields.state = 'state_required';

  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < PASSWORD_MIN) fields.password = 'password_short';
  else if (password.length > PASSWORD_MAX) fields.password = 'password_long';
  else if (b.confirmPassword !== undefined && b.confirmPassword !== password) fields.confirmPassword = 'password_mismatch';

  if (Object.keys(fields).length) return { ok: false, fields };
  return {
    ok: true,
    value: {
      name,
      gender,
      phone,
      farmType,
      farmTypeOther: farmType === 'other' ? farmTypeOther : '',
      village,
      district,
      state,
      password,
    },
  };
}

/** What the page may know about a user. Never the hash. */
export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    gender: user.gender,
    phone: user.phone,
    farmType: user.farmType,
    farmTypeOther: user.farmTypeOther,
    village: user.village,
    district: user.district,
    state: user.state,
    role: user.role,
  };
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Accounts and sessions. `getUsers()` returns the user repository (find by phone / id, count, create) and may throw
 * `Error('starting')` while the database is still connecting. A session token is `payload.signature`: the signature
 * is an HMAC over the payload, so a token cannot be made or altered without `secret`.
 */
export function createAuth({ getUsers, secret, now = Date.now, newId = () => randomBytes(12).toString('hex') }) {
  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');

  function issue(user) {
    const payload = b64(JSON.stringify({ sub: user.id, iat: now(), exp: now() + SESSION_DAYS * 86_400_000 }));
    return { token: `${payload}.${sign(payload)}`, maxAgeSeconds: SESSION_DAYS * 86_400 };
  }

  /** The `{ sub, iat }` a token carries, or null when it is missing, forged, malformed or expired. */
  function claims(token) {
    if (typeof token !== 'string') return null;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return null;
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const { sub, exp, iat } = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return typeof sub === 'string' && typeof exp === 'number' && exp > now() ? { sub, iat: Number.isFinite(iat) ? iat : 0 } : null;
    } catch {
      return null;
    }
  }

  /** Returns the user id a token belongs to, or null when it is missing, forged, malformed or expired. */
  const readToken = (token) => claims(token)?.sub ?? null;

  return {
    async signup(body) {
      const checked = validateSignup(body);
      if (!checked.ok) return { ok: false, status: 400, error: 'invalid', fields: checked.fields };
      const { password, ...profile } = checked.value;
      const users = await getUsers();
      if (await users.findByPhone(profile.phone)) return { ok: false, status: 409, error: 'phone_taken', fields: { phone: 'phone_taken' } };
      const user = {
        id: newId(),
        ...profile,
        passwordHash: hashPassword(password),
        // Whoever creates the very first account looks after the rest.
        // (the demo account does not count: it must not take the admin place from the first real person)
        role: (await users.countAdmins()) === 0 ? 'admin' : 'farmer',
        createdAt: new Date(now()).toISOString(),
      };
      try {
        await users.create(user);
      } catch (err) {
        // Two signups for one number at the same moment: the store's unique index lets only one through.
        if (err?.code === 11000) return { ok: false, status: 409, error: 'phone_taken', fields: { phone: 'phone_taken' } };
        throw err;
      }
      return { ok: true, user: publicUser(user), ...issue(user) };
    },

    async login(body) {
      const phone = normalizePhone(body?.phone);
      const password = typeof body?.password === 'string' ? body.password : '';
      if (!phone || !password || password.length > PASSWORD_MAX) return { ok: false, status: 401, error: 'bad_credentials' };
      const user = await (await getUsers()).findByPhone(phone);
      const good = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !good) return { ok: false, status: 401, error: 'bad_credentials' };
      return { ok: true, user: publicUser(user), ...issue(user) };
    },

    /** The user a cookie value belongs to, or null. A token made before the last password change no longer counts. */
    async userFor(token) {
      const found = claims(token);
      if (!found) return null;
      const user = await (await getUsers()).findById(found.sub);
      if (!user || (user.passwordChangedAt && found.iat < user.passwordChangedAt)) return null;
      return publicUser(user);
    },

    /** Signs in as the shared demo account, creating it the first time. */
    async demo() {
      const users = await getUsers();
      let user = await users.findByPhone(DEMO_PHONE);
      if (!user) {
        user = {
          id: newId(),
          name: 'Demo Farmer',
          gender: 'male',
          phone: DEMO_PHONE,
          farmType: 'crop',
          farmTypeOther: '',
          village: '',
          district: 'Mandya',
          state: 'Karnataka',
          passwordHash: hashPassword(randomBytes(24).toString('hex')),
          role: 'demo',
          createdAt: new Date(now()).toISOString(),
        };
        try {
          await users.create(user);
        } catch (err) {
          if (err?.code !== 11000) throw err;
          user = await users.findByPhone(DEMO_PHONE); // another request made it a moment ago
        }
      }
      return { ok: true, user: publicUser(user), ...issue(user) };
    },

    /**
     * Changes the signed-in person's own password. Needs the current one, so a borrowed session or phone cannot lock the
     * owner out. Every older session stops working; the caller gets a fresh one.
     */
    async changePassword(userId, body) {
      const b = body && typeof body === 'object' ? body : {};
      const current = typeof b.currentPassword === 'string' ? b.currentPassword : '';
      const next = typeof b.newPassword === 'string' ? b.newPassword : '';
      const fields = {};
      if (!current) fields.currentPassword = 'password_required';
      if (next.length < PASSWORD_MIN) fields.newPassword = 'password_short';
      else if (next.length > PASSWORD_MAX) fields.newPassword = 'password_long';
      else if (b.confirmPassword !== undefined && b.confirmPassword !== next) fields.confirmPassword = 'password_mismatch';
      if (Object.keys(fields).length) return { ok: false, status: 400, error: 'invalid', fields };

      const users = await getUsers();
      const user = await users.findById(userId);
      if (!user) return { ok: false, status: 401, error: 'signed_out' };
      if (user.role === 'demo') return { ok: false, status: 403, error: 'demo_account' };
      if (current.length > PASSWORD_MAX || !verifyPassword(current, user.passwordHash)) {
        return { ok: false, status: 403, error: 'wrong_password', fields: { currentPassword: 'wrong_password' } };
      }
      if (next === current) return { ok: false, status: 400, error: 'invalid', fields: { newPassword: 'same_password' } };

      const changedAt = now();
      await users.updatePassword(user.id, hashPassword(next), changedAt);
      return { ok: true, user: publicUser(user), ...issue(user) };
    },

    readToken,
  };
}
