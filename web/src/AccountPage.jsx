import { useId, useState } from 'react';
import { useAuth } from './auth.jsx';
import { usePrefs } from './prefs.jsx';
import { Field, PasswordInput, failure } from './AuthPage.jsx';

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' };

/** The signed-in person's details, and a form to change their own password. */
export default function AccountPage() {
  const { t } = usePrefs();
  const { user, changePassword } = useAuth();
  const uid = useId();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [problem, setProblem] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user) return null;
  const demo = user.role === 'demo';
  const idOf = (name) => `${uid}-${name}`;
  const farm = user.farmType === 'other' ? user.farmTypeOther : t(`farm.${user.farmType}`);
  const place = [user.village, user.district, user.state].filter(Boolean).join(', ');
  const rows = [
    [t('auth.phone'), `+91 ${user.phone}`],
    [t('auth.gender'), t(`gender.${user.gender}`)],
    [t('auth.farmType'), farm],
    [t('auth.farmLocation'), place],
  ];

  const set = (name) => (event) => {
    const value = event.target.value;
    setForm((f) => ({ ...f, [name]: value }));
    setSaved(false);
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  };
  const field = (name, autoComplete) => ({
    id: idOf(name),
    value: form[name],
    onChange: set(name),
    autoComplete,
    invalid: Boolean(errors[name]),
    describedBy: errors[name] ? `${idOf(name)}-err` : undefined,
  });

  const submit = async (event) => {
    event.preventDefault();
    setSaved(false);
    setProblem('');
    const found = {};
    if (!form.currentPassword) found.currentPassword = 'password_required';
    if (form.newPassword.length < 8) found.newPassword = 'password_short';
    else if (form.newPassword === form.currentPassword) found.newPassword = 'same_password';
    else if (form.confirmPassword !== form.newPassword) found.confirmPassword = 'password_mismatch';
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById(idOf(Object.keys(found)[0]))?.focus();
      return;
    }
    setBusy(true);
    const result = await changePassword(form);
    setBusy(false);
    if (result.ok) {
      setForm(EMPTY);
      setSaved(true);
      return;
    }
    setErrors(result.data.fields ?? {});
    // A field error already says what is wrong; a general one (server down, slow down) is shown at the top.
    if (!result.data.fields) setProblem(failure(result.data));
  };

  return (
    <div className="account">
      <section className="card" aria-label={t('account.profile')}>
        <h2 className="card-title">
          {t('account.profile')}
          <span className="mono card-note">{(user.role === 'admin' ? t('acct.admin') : t(`account.role.${user.role}`)).toUpperCase()}</span>
        </h2>
        <div className="account-who">
          <span className="avatar big" aria-hidden="true">
            {user.name.trim().charAt(0).toUpperCase()}
          </span>
          <p className="account-name">{user.name}</p>
        </div>
        <dl className="account-list">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="mono">{label.toUpperCase()}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card" aria-label={t('account.password.title')}>
        <h2 className="card-title">{t('account.password.title')}</h2>
        {demo ? (
          <p className="muted">{t('account.demoNote')}</p>
        ) : (
          <form className="auth-form account-form" onSubmit={submit} noValidate>
            <p className="muted account-sub">{t('account.password.sub')}</p>
            {problem && (
              <p className="form-problem" role="alert">
                {t(`err.${problem}`)}
              </p>
            )}
            {saved && (
              <p className="form-saved" role="status">
                {t('account.saved')}
              </p>
            )}
            <Field id={idOf('currentPassword')} label={t('account.current')} error={errors.currentPassword}>
              <PasswordInput {...field('currentPassword', 'current-password')} />
            </Field>
            <Field id={idOf('newPassword')} label={t('account.new')} hint={t('auth.password.hint')} error={errors.newPassword}>
              <PasswordInput {...field('newPassword', 'new-password')} />
            </Field>
            <Field id={idOf('confirmPassword')} label={t('account.confirm')} error={errors.confirmPassword}>
              <PasswordInput {...field('confirmPassword', 'new-password')} />
            </Field>
            <button type="submit" className="btn solid big block" disabled={busy}>
              {busy ? t('auth.busy') : t('account.save')}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
