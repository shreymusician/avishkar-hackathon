import { useEffect, useId, useState } from 'react';
import { useAuth } from './auth.jsx';
import { usePrefs } from './prefs.jsx';
import { BrandLogo } from './BrandLogo.jsx';
import { SitePrefs } from './Landing.jsx';
import SafeImg from './SafeImg.jsx';
import { Eye } from './marks.jsx';

const GENDERS = ['female', 'male'];
const FARM_TYPES = ['crop', 'orchard', 'vegetable', 'dairy', 'poultry', 'mixed', 'other'];
const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry',
];

const tenDigits = (value) => {
  let digits = String(value).replace(/[\s\-().]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits);
};

/** Same rules as the server, so a mistake is caught before the request. The server still has the last word. */
function check(form) {
  const errors = {};
  if (form.name.trim().length < 2) errors.name = 'name_short';
  if (!GENDERS.includes(form.gender)) errors.gender = 'gender_required';
  if (!tenDigits(form.phone)) errors.phone = 'phone_invalid';
  if (!form.farmType) errors.farmType = 'farm_type_required';
  else if (form.farmType === 'other' && form.farmTypeOther.trim().length < 2) errors.farmTypeOther = 'farm_type_other_required';
  if (form.district.trim().length < 2) errors.district = 'district_required';
  if (form.state.trim().length < 2) errors.state = 'state_required';
  if (form.password.length < 8) errors.password = 'password_short';
  else if (form.confirmPassword !== form.password) errors.confirmPassword = 'password_mismatch';
  return errors;
}

/** Turns a server answer into the code the page translates. */
export function failure(data) {
  if (data.error === 'slow down') return 'slow';
  return ['invalid', 'bad_credentials', 'network', 'starting', 'database', 'server', 'phone_taken', 'wrong_password', 'demo_account', 'signed_out'].includes(data.error)
    ? data.error
    : 'server';
}

export function Field({ label, hint, error, optional, children, id }) {
  const { t } = usePrefs();
  return (
    <div className="field" data-invalid={error ? '' : undefined}>
      <label htmlFor={id}>
        {label}
        {optional && <span className="optional"> · {t('auth.optional')}</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-err" id={`${id}-err`} role="alert">
          {t(`err.${error}`)}
        </p>
      )}
    </div>
  );
}

export function PasswordInput({ id, value, onChange, autoComplete, invalid, describedBy }) {
  const { t } = usePrefs();
  const [shown, setShown] = useState(false);
  return (
    <div className="pw">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        maxLength={128}
      />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={shown ? t('auth.hide') : t('auth.show')}
        title={shown ? t('auth.hide') : t('auth.show')}
      >
        <Eye off={shown} />
      </button>
    </div>
  );
}

function PhoneInput({ id, value, onChange, invalid, describedBy }) {
  return (
    <div className="phone">
      <span className="phone-prefix mono" aria-hidden="true">
        +91
      </span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        value={value}
        onChange={onChange}
        maxLength={16}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder="98450 12345"
      />
    </div>
  );
}

function Shell({ mode, children }) {
  const { t } = usePrefs();
  const login = mode === 'login';
  return (
    <div className="auth">
      <aside className="auth-art" aria-hidden="true">
        <SafeImg src="/landing-field.jpg" alt="" fallback={null} />
        <div className="auth-art-shade" />
        <p className="auth-art-quote">{t('land.hero.title')}</p>
      </aside>
      <div className="auth-side">
        <header className="auth-top">
          <a className="site-brand" href="#/" aria-label={t('auth.back')}>
            <BrandLogo />
          </a>
          <SitePrefs compact />
        </header>
        <main className="auth-card">
          <h1>{login ? t('auth.login.title') : t('auth.signup.title')}</h1>
          <p className="auth-sub">{login ? t('auth.login.sub') : t('auth.signup.sub')}</p>
          {children}
          <p className="auth-switch">
            <a href={login ? '#/signup' : '#/login'}>{login ? t('auth.toSignup') : t('auth.toLogin')}</a>
          </p>
          <p className="auth-switch">
            <a href="#/">{t('auth.back')}</a>
          </p>
        </main>
      </div>
    </div>
  );
}

function LoginForm() {
  const { t } = usePrefs();
  const { login, demo } = useAuth();
  const uid = useId();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  // The server says whether it offers the demo button (DEMO_LOGIN=0 turns it off).
  const [demoOn, setDemoOn] = useState(false);
  useEffect(() => {
    let stale = false;
    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => !stale && setDemoOn(h.demoLogin === true))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, []);

  const tryDemo = async () => {
    setErrors({});
    setProblem('');
    setBusy(true);
    const result = await demo();
    setBusy(false);
    if (result.ok) window.location.hash = '#/control';
    else setProblem(failure(result.data));
  };

  const submit = async (event) => {
    event.preventDefault();
    const found = {};
    if (!tenDigits(phone)) found.phone = 'phone_invalid';
    if (!password) found.password = 'password_required';
    setErrors(found);
    setProblem('');
    if (Object.keys(found).length) return;
    setBusy(true);
    const result = await login(phone, password);
    setBusy(false);
    if (result.ok) window.location.hash = '#/control';
    else setProblem(failure(result.data));
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      {problem && (
        <p className="form-problem" role="alert">
          {t(`err.${problem}`)}
        </p>
      )}
      <Field id={`${uid}-phone`} label={t('auth.phone')} error={errors.phone}>
        <PhoneInput id={`${uid}-phone`} value={phone} onChange={(e) => setPhone(e.target.value)} invalid={Boolean(errors.phone)} describedBy={errors.phone ? `${uid}-phone-err` : undefined} />
      </Field>
      <Field id={`${uid}-pw`} label={t('auth.password')} error={errors.password}>
        <PasswordInput id={`${uid}-pw`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" invalid={Boolean(errors.password)} describedBy={errors.password ? `${uid}-pw-err` : undefined} />
      </Field>
      <button type="submit" className="btn solid big block" disabled={busy}>
        {busy ? t('auth.busy') : t('auth.submit.login')}
      </button>
      {demoOn && (
        <>
          <p className="auth-or mono" aria-hidden="true">
            <span>{t('auth.or').toUpperCase()}</span>
          </p>
          <button type="button" className="btn ghost big block" onClick={tryDemo} disabled={busy}>
            {t('auth.demo')}
          </button>
          <p className="field-hint demo-note">{t('auth.demo.note')}</p>
        </>
      )}
    </form>
  );
}

const EMPTY = {
  name: '', gender: '', phone: '', farmType: '', farmTypeOther: '', village: '', district: '', state: '', password: '', confirmPassword: '',
};

function SignupForm() {
  const { t } = usePrefs();
  const { signup } = useAuth();
  const uid = useId();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [place, setPlace] = useState('idle'); // idle | looking | done | failed

  const set = (name) => (event) => {
    const value = event.target.value;
    setForm((f) => ({ ...f, [name]: value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };
  const idOf = (name) => `${uid}-${name}`;
  const fieldProps = (name) => ({
    id: idOf(name),
    value: form[name],
    onChange: set(name),
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${idOf(name)}-err` : undefined,
  });

  const suggestPlace = async () => {
    setPlace('looking');
    try {
      const res = await fetch('/api/auth/place');
      if (!res.ok) throw new Error('upstream');
      const found = await res.json();
      if (!found.district && !found.state && !found.village) throw new Error('empty');
      setForm((f) => ({ ...f, village: found.village || f.village, district: found.district || f.district, state: found.state || f.state }));
      setErrors((e) => ({ ...e, district: undefined, state: undefined }));
      setPlace('done');
    } catch {
      setPlace('failed');
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    const found = check(form);
    setErrors(found);
    setProblem('');
    if (Object.keys(found).length) {
      setProblem('invalid');
      document.getElementById(idOf(Object.keys(found)[0]))?.focus();
      return;
    }
    setBusy(true);
    const result = await signup(form);
    setBusy(false);
    if (result.ok) {
      window.location.hash = '#/control';
      return;
    }
    setErrors(result.data.fields ?? {});
    setProblem(failure(result.data));
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      {problem && (
        <p className="form-problem" role="alert">
          {t(`err.${problem}`)}
        </p>
      )}

      <fieldset>
        <legend>{t('auth.section.you')}</legend>
        <Field id={idOf('name')} label={t('auth.name')} error={errors.name}>
          <input {...fieldProps('name')} type="text" autoComplete="name" maxLength={60} />
        </Field>
        <Field id={idOf('gender')} label={t('auth.gender')} error={errors.gender}>
          <select {...fieldProps('gender')}>
            <option value="">{t('auth.choose')}</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {t(`gender.${g}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id={idOf('phone')} label={t('auth.phone')} hint={t('auth.phone.hint')} error={errors.phone}>
          <PhoneInput {...fieldProps('phone')} invalid={Boolean(errors.phone)} describedBy={errors.phone ? `${idOf('phone')}-err` : `${idOf('phone')}-hint`} />
        </Field>
      </fieldset>

      <fieldset>
        <legend>{t('auth.section.farm')}</legend>
        <Field id={idOf('farmType')} label={t('auth.farmType')} error={errors.farmType}>
          <select {...fieldProps('farmType')}>
            <option value="">{t('auth.choose')}</option>
            {FARM_TYPES.map((f) => (
              <option key={f} value={f}>
                {t(`farm.${f}`)}
              </option>
            ))}
          </select>
        </Field>
        {form.farmType === 'other' && (
          <Field id={idOf('farmTypeOther')} label={t('auth.farmTypeOther')} error={errors.farmTypeOther}>
            <input {...fieldProps('farmTypeOther')} type="text" maxLength={60} />
          </Field>
        )}

        <p className="field-group-title">{t('auth.farmLocation')}</p>
        <button type="button" className="btn ghost small" onClick={suggestPlace} disabled={place === 'looking'}>
          {place === 'looking' ? t('auth.locating') : t('auth.locate')}
        </button>
        {place === 'done' && <p className="field-hint">{t('auth.locate.note')}</p>}
        {place === 'failed' && (
          <p className="field-hint warn" role="status">
            {t('auth.locate.failed')}
          </p>
        )}
        <Field id={idOf('village')} label={t('auth.village')} optional error={errors.village}>
          <input {...fieldProps('village')} type="text" autoComplete="address-level3" maxLength={80} />
        </Field>
        <div className="field-pair">
          <Field id={idOf('district')} label={t('auth.district')} error={errors.district}>
            <input {...fieldProps('district')} type="text" autoComplete="address-level2" maxLength={80} />
          </Field>
          <Field id={idOf('state')} label={t('auth.state')} error={errors.state}>
            <input {...fieldProps('state')} type="text" autoComplete="address-level1" maxLength={80} list={`${uid}-states`} />
            <datalist id={`${uid}-states`}>
              {STATES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend>{t('auth.section.password')}</legend>
        <Field id={idOf('password')} label={t('auth.password')} hint={t('auth.password.hint')} error={errors.password}>
          <PasswordInput
            id={idOf('password')}
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            describedBy={errors.password ? `${idOf('password')}-err` : `${idOf('password')}-hint`}
          />
        </Field>
        <Field id={idOf('confirmPassword')} label={t('auth.password.confirm')} error={errors.confirmPassword}>
          <PasswordInput
            id={idOf('confirmPassword')}
            value={form.confirmPassword}
            onChange={set('confirmPassword')}
            autoComplete="new-password"
            invalid={Boolean(errors.confirmPassword)}
            describedBy={errors.confirmPassword ? `${idOf('confirmPassword')}-err` : undefined}
          />
        </Field>
      </fieldset>

      <button type="submit" className="btn solid big block" disabled={busy}>
        {busy ? t('auth.busy') : t('auth.submit.signup')}
      </button>
    </form>
  );
}

export default function AuthPage({ mode }) {
  return <Shell mode={mode}>{mode === 'login' ? <LoginForm /> : <SignupForm />}</Shell>;
}
