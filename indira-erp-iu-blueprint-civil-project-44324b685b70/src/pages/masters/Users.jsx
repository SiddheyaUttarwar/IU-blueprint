import { useState } from 'react';
import UsersUmsPanel from './UsersUmsPanel.jsx';
import UsersEnrolledPanel from './UsersEnrolledPanel.jsx';
import UsersEntraPanel from './UsersEntraPanel.jsx';
import BackButton from '../../components/BackButton.jsx';
import AddUserModal from '../../components/AddUserModal.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { enrollManualUser } from '../../services/enrollment.js';
import { listProfiles } from '../../services/profiles.js';
import { IconPlus } from '../../components/Icons.jsx';

const TABS = [
  { key: 'enrolled', label: 'Enrolled Users' },
  { key: 'ums', label: 'UMS Employees' },
  { key: 'entra', label: 'Directory (Entra)' },
];

export default function MastersUsers() {
  const { profile } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('enrolled');
  const [reloadKey, setReloadKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addUserApiError, setAddUserApiError] = useState(null);
  const [existingEmails, setExistingEmails] = useState([]);

  async function openAddModal() {
    try {
      const rows = await listProfiles();
      setExistingEmails(rows.map((r) => r.email).filter(Boolean));
    } catch {
      setExistingEmails([]);
    }
    setModalOpen(true);
  }

  async function handleAdd(payload) {
    setSaving(true);
    setAddUserApiError(null);
    try {
      await enrollManualUser({
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        mobileNumber: payload.mobileNumber,
        roles: payload.roles,
      });
      toast.success(`Invite sent to ${payload.email}.`);
      setModalOpen(false);
      setReloadKey((k) => k + 1);
      setTab('enrolled');
    } catch (err) {
      const msg = err.message || 'Failed to enrol user.';
      setAddUserApiError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <BackButton to="/masters" label="Back to Masters" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Masters — Users</h2>
        <button
          type="button"
          className="btn-primary btn-primary--sm"
          onClick={openAddModal}
          disabled={!profile}
        >
          <IconPlus /> Add User
        </button>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`tabs__tab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ums' && <UsersUmsPanel onEnrolledChange={() => setReloadKey((k) => k + 1)} />}
      {tab === 'entra' && <UsersEntraPanel onEnrolledChange={() => setReloadKey((k) => k + 1)} />}
      {tab === 'enrolled' && <UsersEnrolledPanel reloadKey={reloadKey} />}

      <AddUserModal
        open={modalOpen}
        existingEmails={existingEmails}
        onCancel={() => { setModalOpen(false); setAddUserApiError(null); }}
        onSave={handleAdd}
        busy={saving}
        apiError={addUserApiError}
      />
    </>
  );
}
