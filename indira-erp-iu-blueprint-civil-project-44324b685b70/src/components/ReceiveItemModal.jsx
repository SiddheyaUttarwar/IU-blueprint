import { useEffect, useState } from 'react';
import NumberInput from './NumberInput.jsx';

export default function ReceiveItemModal({ item, onClose, onSave }) {
  const [qty, setQty] = useState(String(item.received_qty ?? item.buy_qty ?? 0));
  const [date, setDate] = useState(item.received_on ?? new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState(item.received_note ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave({ receivedQty: qty, receivedOn: date, receivedNote: note });
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h3 style={{ marginTop: 0 }}>Record receipt — {item.item_name}</h3>
        <div className="form-hint" style={{ marginBottom: 12 }}>
          Quantity Indented: <b>{item.buy_qty}</b> · Currently received: <b>{item.received_qty ?? 0}</b>
        </div>
        <form onSubmit={submit}>
          <label className="login-field">
            <span>Received Qty</span>
            <NumberInput value={qty} onChange={setQty} min={0} required autoFocus className="tpl-input tpl-input--num" />
          </label>
          <label className="login-field">
            <span>Received On</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="login-field">
            <span>Note (optional)</span>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </label>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn-secondary btn-secondary--sm" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary btn-primary--sm" disabled={busy}>{busy ? 'Saving…' : 'Save Receipt'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
