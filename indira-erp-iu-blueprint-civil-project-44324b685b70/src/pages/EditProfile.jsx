import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import RequiredMark from '../components/RequiredMark.jsx';
import { isNonEmpty, isTenDigitPhone, digitsOnly, validate } from '../lib/validators.js';
import BackButton from '../components/BackButton.jsx';

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const EDITABLE_FIELDS = ['first_name', 'middle_name', 'last_name', 'mobile_number', 'emergency_contact_number'];

const RULES = {
  first_name: [{ test: isNonEmpty, message: 'First name is required.' }],
  last_name: [{ test: isNonEmpty, message: 'Last name is required.' }],
  mobile_number: [
    { test: (v) => v === '' || v == null || isTenDigitPhone(v), message: 'Mobile must be exactly 10 digits (numbers only).' },
  ],
  emergency_contact_number: [
    { test: (v) => v === '' || v == null || isTenDigitPhone(v), message: 'Emergency contact must be exactly 10 digits (numbers only).' },
  ],
};

export default function EditProfile() {
  const { profile, refreshProfile } = useAuth();
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [topError, setTopError] = useState('');
  const [info, setInfo] = useState('');
  const fileInputRef = useRef(null);

  async function handleAvatarPick(file) {
    if (!file) return;
    setTopError(''); setInfo('');
    if (!AVATAR_ALLOWED.includes(file.type)) {
      setTopError('Photo must be JPEG, PNG, WebP or GIF.'); return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setTopError('Photo must be under 2 MB.'); return;
    }
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) throw new Error('No active session.');
      // Owner-prefixed path so the RLS policy accepts the write. Bust caches with a timestamp.
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const path = `${uid}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, {
        cacheControl: '3600', upsert: false, contentType: file.type,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = pub?.publicUrl ?? null;
      const { error: updErr } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', profile.id);
      if (updErr) throw updErr;
      await refreshProfile();
      setInfo('Photo updated.');
    } catch (err) {
      setTopError(err?.message || 'Photo upload failed.');
    } finally { setUploading(false); }
  }

  async function handleAvatarRemove() {
    if (!profile?.avatar_url) return;
    setUploading(true); setTopError(''); setInfo('');
    try {
      const { error: updErr } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', profile.id);
      if (updErr) throw updErr;
      await refreshProfile();
      setInfo('Photo removed.');
    } catch (err) {
      setTopError(err?.message || 'Failed to remove photo.');
    } finally { setUploading(false); }
  }

  useEffect(() => {
    if (profile) {
      const initial = {};
      EDITABLE_FIELDS.forEach((k) => { initial[k] = profile[k] ?? ''; });
      setForm(initial);
      setErrors({});
    }
  }, [profile]);

  if (!profile || !form) return null;

  function onChange(key, value) {
    let next = value;
    if (key === 'mobile_number' || key === 'emergency_contact_number') {
      next = digitsOnly(value).slice(0, 10);
    }
    setForm((f) => ({ ...f, [key]: next }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setInfo('');
    setTopError('');
  }

  async function handleSave(e) {
    e.preventDefault();
    const nextErrors = validate(RULES, form);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      const firstKey = Object.keys(nextErrors)[0];
      document.getElementById(`field-${firstKey}`)?.focus();
      return;
    }
    setBusy(true);
    setTopError('');
    setInfo('');
    const patch = {};
    EDITABLE_FIELDS.forEach((k) => { patch[k] = form[k]?.trim() || null; });
    const { error: updErr } = await supabase.from('profiles').update(patch).eq('id', profile.id);
    if (updErr) {
      setTopError(updErr.message);
      setBusy(false);
      return;
    }
    await refreshProfile();
    setBusy(false);
    setInfo('Profile updated.');
  }

  return (
    <>
      <BackButton label="Back" />
      <h2 className="page-title">Edit Profile</h2>
      <div className="card edit-profile-card">
        <div className="edit-profile__avatar-row">
          <div className="edit-profile__avatar" aria-label="Current profile photo">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" />
            ) : (
              <span className="edit-profile__avatar-initial">{(profile.first_name?.[0] || profile.email?.[0] || '?').toUpperCase()}</span>
            )}
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Profile photo</div>
            <div className="form-hint" style={{ marginBottom: 6 }}>JPEG / PNG / WebP / GIF · max 2 MB.</div>
            <input
              ref={fileInputRef}
              type="file"
              accept={AVATAR_ALLOWED.join(',')}
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarPick(f); e.target.value = ''; }}
            />
            <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : (profile.avatar_url ? 'Replace photo' : 'Upload photo')}
            </button>
            {profile.avatar_url && (
              <button type="button" className="btn-secondary btn-secondary--sm" onClick={handleAvatarRemove} disabled={uploading} style={{ marginLeft: 6 }}>
                Remove
              </button>
            )}
          </div>
        </div>
        <form onSubmit={handleSave} className="login-form" noValidate>
          <div className="edit-profile__grid">
            <Field
              id="field-first_name"
              label="First name"
              required
              value={form.first_name}
              onChange={(v) => onChange('first_name', v)}
              error={errors.first_name}
            />
            <Field
              id="field-middle_name"
              label="Middle name"
              value={form.middle_name}
              onChange={(v) => onChange('middle_name', v)}
            />
            <Field
              id="field-last_name"
              label="Last name"
              required
              value={form.last_name}
              onChange={(v) => onChange('last_name', v)}
              error={errors.last_name}
            />
            <Field
              id="field-mobile_number"
              label="Mobile"
              hint="10 digits, numbers only"
              value={form.mobile_number}
              onChange={(v) => onChange('mobile_number', v)}
              error={errors.mobile_number}
              inputMode="numeric"
              maxLength={10}
            />
            <Field
              id="field-emergency_contact_number"
              label="Emergency contact"
              hint="10 digits, numbers only"
              value={form.emergency_contact_number}
              onChange={(v) => onChange('emergency_contact_number', v)}
              error={errors.emergency_contact_number}
              inputMode="numeric"
              maxLength={10}
            />
          </div>

          <div className="edit-profile__meta">
            <div><span className="edit-profile__label">Email:</span> {profile.email}</div>
            <div><span className="edit-profile__label">Role:</span> {profile.role === 'project_admin' ? 'Project Admin' : profile.role === 'it_admin' ? 'IT Admin' : profile.role === 'project_manager' ? 'Project Manager' : 'Member'}</div>
            {profile.employee_number && (
              <div><span className="edit-profile__label">Employee #:</span> {profile.employee_number}</div>
            )}
          </div>

          {topError && <div className="login-error">{topError}</div>}
          {info && <div className="login-info">{info}</div>}

          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </div>
    </>
  );
}

function Field({ id, label, required, value, onChange, error, hint, ...rest }) {
  return (
    <label className={`login-field${error ? ' login-field--invalid' : ''}`} htmlFor={id}>
      <span>{label}{required && <RequiredMark />}</span>
      <input
        id={id}
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        {...rest}
      />
      {error && <span id={`${id}-err`} className="form-error-inline">{error}</span>}
      {!error && hint && <span id={`${id}-hint`} className="form-hint">{hint}</span>}
    </label>
  );
}
