import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuth, hashPassword, normalizePhone, validateSignup, verifyPassword } from '../src/auth.js';
import { createFileUsers } from '../src/users.js';

const signup = (over = {}) => ({
  name: 'Lakshmi Gowda',
  gender: 'female',
  phone: '98450 12345',
  farmType: 'crop',
  village: 'Hosahalli',
  district: 'Mandya',
  state: 'Karnataka',
  password: 'sugarcane-2026',
  confirmPassword: 'sugarcane-2026',
  ...over,
});

const memoryUsers = () => {
  const rows = [];
  return {
    rows,
    findByPhone: async (phone) => rows.find((u) => u.phone === phone) ?? null,
    findById: async (id) => rows.find((u) => u.id === id) ?? null,
    count: async () => rows.length,
    countAdmins: async () => rows.filter((u) => u.role === 'admin').length,
    updatePassword: async (id, passwordHash, passwordChangedAt) => {
      Object.assign(rows.find((u) => u.id === id), { passwordHash, passwordChangedAt });
    },
    create: async (u) => void rows.push(u),
  };
};

const makeAuth = (users = memoryUsers(), clock = { t: 1_000_000 }) => ({
  users,
  clock,
  auth: createAuth({ getUsers: async () => users, secret: 'test-secret', now: () => clock.t }),
});

test('phone numbers are accepted with or without a country code and spacing', () => {
  for (const typed of ['9845012345', '98450 12345', '+91 98450-12345', '919845012345', '09845012345']) {
    assert.equal(normalizePhone(typed), '9845012345', typed);
  }
  for (const typed of ['', '12345', '5845012345', '98450123456', 'abcdefghij', null]) {
    assert.equal(normalizePhone(typed), null, String(typed));
  }
});

test('passwords are salted and verify only when right', () => {
  const a = hashPassword('correct horse');
  const b = hashPassword('correct horse');
  assert.notEqual(a, b);
  assert.ok(!a.includes('correct horse'));
  assert.ok(verifyPassword('correct horse', a));
  assert.ok(!verifyPassword('correct horse!', a));
  assert.ok(!verifyPassword('x', 'garbage'));
});

test('signup validation names each bad field and normalises the good ones', () => {
  const bad = validateSignup({ name: 'A', phone: '123', farmType: 'cattle', password: 'short' });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.fields).sort(), ['district', 'farmType', 'gender', 'name', 'password', 'phone', 'state']);

  const good = validateSignup(signup({ name: '  Lakshmi   Gowda ' }));
  assert.equal(good.ok, true);
  assert.equal(good.value.name, 'Lakshmi Gowda');
  assert.equal(good.value.phone, '9845012345');
  assert.equal(good.value.gender, 'female');
  for (const g of [undefined, '', 'other', 'undisclosed']) assert.equal(validateSignup(signup({ gender: g })).fields.gender, 'gender_required', String(g));
  assert.equal(validateSignup(signup({ gender: 'male' })).ok, true);

  assert.equal(validateSignup(signup({ confirmPassword: 'different-one' })).fields.confirmPassword, 'password_mismatch');
  assert.equal(validateSignup(signup({ farmType: 'other' })).fields.farmTypeOther, 'farm_type_other_required');
  assert.equal(validateSignup(signup({ farmType: 'other', farmTypeOther: 'Beekeeping' })).ok, true);
  assert.equal(validateSignup(null).ok, false);
});

test('the first account is the admin, later ones are farmers, and the hash is never returned', async () => {
  const { auth, users } = makeAuth();
  const first = await auth.signup(signup());
  assert.equal(first.ok, true);
  assert.equal(first.user.role, 'admin');
  assert.equal(first.user.passwordHash, undefined);
  assert.equal(JSON.stringify(first).includes('sugarcane'), false);
  assert.notEqual(users.rows[0].passwordHash, 'sugarcane-2026');

  const second = await auth.signup(signup({ phone: '9000000001', name: 'Ravi Kumar' }));
  assert.equal(second.user.role, 'farmer');
});

test('a phone number can only sign up once, however it is typed', async () => {
  const { auth } = makeAuth();
  await auth.signup(signup());
  const again = await auth.signup(signup({ phone: '+91 9845012345', name: 'Someone Else' }));
  assert.equal(again.ok, false);
  assert.equal(again.status, 409);
  assert.equal(again.fields.phone, 'phone_taken');
});

test('login works with the right password and gives the same answer for a wrong password and an unknown number', async () => {
  const { auth } = makeAuth();
  await auth.signup(signup());

  const ok = await auth.login({ phone: '+91 98450 12345', password: 'sugarcane-2026' });
  assert.equal(ok.ok, true);
  assert.equal(ok.user.name, 'Lakshmi Gowda');

  const wrong = await auth.login({ phone: '9845012345', password: 'sugarcane-2027' });
  const unknown = await auth.login({ phone: '9111111111', password: 'sugarcane-2026' });
  assert.deepEqual(wrong, { ok: false, status: 401, error: 'bad_credentials' });
  assert.deepEqual(unknown, wrong);
  assert.equal((await auth.login({})).ok, false);
});

test('session tokens identify the user, and forged, altered or expired ones are refused', async () => {
  const { auth, clock } = makeAuth();
  const made = await auth.signup(signup());
  assert.equal((await auth.userFor(made.token)).phone, '9845012345');

  const [payload, signature] = made.token.split('.');
  assert.equal(await auth.userFor(`${payload}.${signature.slice(0, -2)}AA`), null);
  const forged = Buffer.from(JSON.stringify({ sub: 'someone', exp: clock.t + 1e9 })).toString('base64url');
  assert.equal(await auth.userFor(`${forged}.${signature}`), null);
  assert.equal(await auth.userFor(undefined), null);
  assert.equal(await auth.userFor('not-a-token'), null);
  assert.equal(await auth.userFor(`${payload}.${signature}.x`), null);

  // a token signed with another secret is no good here
  const other = createAuth({ getUsers: async () => memoryUsers(), secret: 'other', now: () => clock.t });
  assert.equal(other.readToken(made.token), null);

  clock.t += 8 * 86_400_000;
  assert.equal(await auth.userFor(made.token), null);
});

test('a token for an account that no longer exists is refused', async () => {
  const { auth, users } = makeAuth();
  const made = await auth.signup(signup());
  users.rows.length = 0;
  assert.equal(await auth.userFor(made.token), null);
});

test('accounts in the JSON file survive a restart and refuse duplicate numbers', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'agrirover-')), 'nested', 'users.json');
  const one = createFileUsers(path);
  const { auth } = makeAuth(one);
  await auth.signup(signup());

  const reopened = createFileUsers(path);
  assert.equal(await reopened.count(), 1);
  assert.equal((await reopened.findByPhone('9845012345')).name, 'Lakshmi Gowda');
  assert.equal(JSON.parse(readFileSync(path, 'utf8'))[0].passwordHash.startsWith('scrypt$'), true);

  const { auth: second } = makeAuth(reopened);
  assert.equal((await second.signup(signup())).status, 409);
  assert.equal((await second.login({ phone: '9845012345', password: 'sugarcane-2026' })).ok, true);
});

test('a duplicate caught by the store itself is also reported as phone_taken', async () => {
  const users = memoryUsers();
  users.create = async () => {
    throw Object.assign(new Error('E11000'), { code: 11000 });
  };
  const { auth } = makeAuth(users);
  const result = await auth.signup(signup());
  assert.equal(result.status, 409);
  assert.equal(result.error, 'phone_taken');
});

test('the demo login works without a password, is not an admin, and does not take the admin place', async () => {
  const { auth, users } = makeAuth();
  const demo = await auth.demo();
  assert.equal(demo.ok, true);
  assert.equal(demo.user.role, 'demo');
  assert.equal(demo.user.passwordHash, undefined);
  assert.equal((await auth.userFor(demo.token)).name, 'Demo Farmer');

  // pressing it again reuses the same account
  const again = await auth.demo();
  assert.equal(again.user.id, demo.user.id);
  assert.equal(users.rows.length, 1);

  // nobody can sign in to it with a password
  assert.equal((await auth.login({ phone: '9000000000', password: 'anything-at-all' })).ok, false);

  // the first real person is still the admin
  const first = await auth.signup(signup());
  assert.equal(first.user.role, 'admin');
});

test('changing the password needs the current one, and ends older sessions', async () => {
  const { auth, clock } = makeAuth();
  const made = await auth.signup(signup());
  const id = made.user.id;
  clock.t += 5000;

  const wrong = await auth.changePassword(id, { currentPassword: 'not-it-at-all', newPassword: 'brand-new-pass', confirmPassword: 'brand-new-pass' });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.status, 403);
  assert.equal(wrong.fields.currentPassword, 'wrong_password');

  assert.equal((await auth.changePassword(id, { currentPassword: 'sugarcane-2026', newPassword: 'short' })).fields.newPassword, 'password_short');
  assert.equal((await auth.changePassword(id, { currentPassword: 'sugarcane-2026', newPassword: 'brand-new-pass', confirmPassword: 'other-thing-1' })).fields.confirmPassword, 'password_mismatch');
  assert.equal((await auth.changePassword(id, { currentPassword: 'sugarcane-2026', newPassword: 'sugarcane-2026' })).fields.newPassword, 'same_password');
  assert.equal((await auth.changePassword(id, {})).ok, false);

  // nothing above changed the password, so the old session still works
  assert.ok(await auth.userFor(made.token));

  const changed = await auth.changePassword(id, { currentPassword: 'sugarcane-2026', newPassword: 'brand-new-pass', confirmPassword: 'brand-new-pass' });
  assert.equal(changed.ok, true);
  assert.equal(JSON.stringify(changed).includes('brand-new-pass'), false);

  assert.equal(await auth.userFor(made.token), null, 'the old session is over');
  assert.ok(await auth.userFor(changed.token), 'the session that made the change continues');
  assert.equal((await auth.login({ phone: '9845012345', password: 'sugarcane-2026' })).ok, false);
  assert.equal((await auth.login({ phone: '9845012345', password: 'brand-new-pass' })).ok, true);
});

test('the demo account has no password to change', async () => {
  const { auth } = makeAuth();
  const demo = await auth.demo();
  const result = await auth.changePassword(demo.user.id, { currentPassword: 'x', newPassword: 'longenough1' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'demo_account');
});
