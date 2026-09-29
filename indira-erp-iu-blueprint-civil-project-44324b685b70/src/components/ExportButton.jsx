import { exportToCsv } from '../lib/exportCsv.js';
import { IconDownload } from './Icons.jsx';

export default function ExportButton({ filename, columns, rows, disabled = false, label = 'Export' }) {
  return (
    <button
      type="button"
      className="export-button"
      onClick={() => exportToCsv({ filename, columns, rows })}
      disabled={disabled || !rows?.length}
      title="Export to Excel (CSV)"
      aria-label={`${label} to Excel`}
    >
      <IconDownload />
      <span>{label}</span>
    </button>
  );
}
