import BackButton from '../components/BackButton.jsx';

export default function Help() {
  return (
    <>
      <BackButton label="Back" />
      <h2 className="page-title">Help</h2>
      <div className="card help-card">
        <h3>Getting started</h3>
        <ul>
          <li><b>Sign in</b> with your Indira University Microsoft account or with the email + password shared with you.</li>
          <li><b>Change your default password</b> from the banner on your Dashboard.</li>
          <li><b>Notifications</b> appear in the bell icon at the top-right.</li>
        </ul>

        <h3>For Project Admins</h3>
        <ul>
          <li>Enrol new users from <b>Masters &rarr; Users</b>.</li>
          <li>You&apos;ll receive an in-app notification the first time an enrolled user signs in.</li>
        </ul>

        <h3>Need more help?</h3>
        <p>Contact the Indira BluePrint support team at <a href="mailto:support@indirauniversity.edu.in">support@indirauniversity.edu.in</a>.</p>
      </div>
    </>
  );
}
