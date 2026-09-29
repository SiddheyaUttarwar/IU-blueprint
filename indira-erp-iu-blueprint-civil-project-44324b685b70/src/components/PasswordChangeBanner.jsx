import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function PasswordChangeBanner() {
  const { profile } = useAuth();
  if (!profile?.must_change_password) return null;
  return (
    <div className="banner banner--warn" role="alert">
      <div>
        <strong>Set your password.</strong> You must set a password before using the system.
      </div>
      <Link to="/set-password" className="banner__cta">Set password</Link>
    </div>
  );
}
