import { useNavigate } from 'react-router-dom';
import { IconArrowLeft } from './Icons.jsx';

export default function BackButton({ to, label = 'Back' }) {
  const navigate = useNavigate();
  function go() {
    if (to) navigate(to);
    else navigate(-1);
  }
  return (
    <button type="button" className="back-button" onClick={go} aria-label={label}>
      <IconArrowLeft />
      <span>{label}</span>
    </button>
  );
}
