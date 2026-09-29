import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

const PROJECT_ADMIN_CARDS = [
  { title: 'Users', desc: 'Enrol users and manage their roles.', to: '/masters/users' },
  { title: 'Campus', desc: 'Manage campuses used across projects.', to: '/masters/campus' },
  { title: 'School', desc: 'Manage schools within each campus.', to: '/masters/school' },
  { title: 'Location Tags', desc: 'Campus → School → Location Tag (optional on projects).', to: '/masters/location-tags' },
  { title: 'Notification Modules', desc: 'Modules users can subscribe to for email notifications.', to: '/masters/notification-modules' },
  { title: 'Project Type', desc: 'Define project types available across templates.', to: '/masters/project-type' },
  { title: 'Project Templates', desc: 'View and manage project templates in use.', to: '/masters/project-templates' },
  { title: 'RAG Rules', desc: 'Define Amber thresholds (versioned per month). Red = anything beyond Amber.', to: '/masters/rag-rules' },
  { title: 'Progress Units', desc: 'Manage units for Quantity Based progress metric.', to: '/masters/progress-units' },
];

const IT_ADMIN_CARDS = [
  { title: 'Project Template', desc: 'Create and edit project templates.', to: '/masters/it/project-template' },
  { title: 'Task', desc: 'Manage template tasks and subtasks.', to: '/masters/it/task' },
  { title: 'Milestone', desc: 'Manage template milestones.', to: '/masters/it/milestone' },
];

export default function MastersHome() {
  const { activeRole } = useAuth();
  const showProjectAdmin = activeRole === 'project_admin';
  const showItAdmin = activeRole === 'it_admin';

  return (
    <>
      <h2 className="page-title">Masters</h2>
      {showProjectAdmin && (
        <MasterSection title="Project Admin" cards={PROJECT_ADMIN_CARDS} />
      )}
      {showItAdmin && (
        <MasterSection title="IT Admin" cards={IT_ADMIN_CARDS} />
      )}
      {!showProjectAdmin && !showItAdmin && (
        <div className="card">Switch to your Project Admin or IT Admin role to see Masters.</div>
      )}
    </>
  );
}

function MasterSection({ title, cards }) {
  return (
    <section className="masters-section">
      <h3 className="masters-section__title">{title}</h3>
      <div className="masters-grid">
        {cards.map((c) => (
          <div key={c.to} className="masters-card">
            <div className="masters-card__body">
              <h4 className="masters-card__title">{c.title}</h4>
              <p className="masters-card__desc">{c.desc}</p>
            </div>
            <Link to={c.to} className="btn-primary btn-primary--sm">Manage</Link>
          </div>
        ))}
      </div>
    </section>
  );
}
