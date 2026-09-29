import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import NumberInput from './NumberInput.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { listDeliveries, addDelivery } from '../services/indentDeliveries.js';

function fmtName(p) {
  if (!p) return 'Someone';
  return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email || 'Someone';
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : ''; }

export default function IndentDeliveryModal({ item, projectName, onClose, onSaved }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [rounds, setRounds] = useState([]);
  const [, setLoadingRounds] = useState(true);
  const [received, setReceived] = useState(Number(item.received_qty ?? 0));
  const [pending, setPending] = useState([{ delivery_date: new Date().toISOString().slice(0, 10), qty: '' }]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const target = Number(item.buy_qty ?? 0);
  const remaining = Math.max(0, target - received);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listDeliveries(item.id);
        if (!cancelled) setRounds(rows);
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load history.');
      } finally { if (!cancelled) setLoadingRounds(false); }
    })();
    return () => { cancelled = true; };
  }, [item.id, toast]);

  function addRow() {
    setPending((prev) => [...prev, { delivery_date: new Date().toISOString().slice(0, 10), qty: '' }]);
  }
  function removeRow(i) {
    setPending((prev) => prev.filter((_, idx) => idx !== i));
  }
  function updateRow(i, patch) {
    setPending((prev) => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  async function submit(e) {
    e.preventDefault();
    const valid = pending.filter((r) => Number(r.qty) > 0);
    if (valid.length === 0) { toast.error('Enter at least one delivery quantity.'); return; }
    setBusy(true);
    try {
      let newTotal = received;
      for (const r of valid) {
        const saved = await addDelivery(item.id, profile?.id, { deliveryDate: r.delivery_date, qty: r.qty, note });
        newTotal += Number(saved.qty);
        setRounds((prev) => [saved, ...prev]);
      }
      setReceived(newTotal);
      setPending([{ delivery_date: new Date().toISOString().slice(0, 10), qty: '' }]);
      setNote('');
      toast.success(`Recorded ${valid.length} delivery round${valid.length === 1 ? '' : 's'}.`);
      onSaved?.({ id: item.id, received_qty: newTotal });
    } catch (err) { toast.error(err.message || 'Failed to save.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card modal-card--wide">
        <h3 style={{ marginTop: 0 }}>Material delivered — {item.item_name}</h3>
        {projectName && <div className="form-hint">{projectName}</div>}

        <div className="delivery-stats">
          <div><span className="delivery-stats__label">Target</span><span className="delivery-stats__value">{target}{item.unit ? ` ${item.unit}` : ''}</span></div>
          <div><span className="delivery-stats__label">Received</span><span className="delivery-stats__value delivery-stats__value--recv">{received}</span></div>
          <div><span className="delivery-stats__label">Remaining</span><span className={`delivery-stats__value delivery-stats__value--${remaining === 0 ? 'done' : 'pending'}`}>{remaining}</span></div>
        </div>

        <form onSubmit={submit}>
          <div className="delivery-rows">
            <div className="delivery-rows__head"><div>Date</div><div>Qty received</div><div /></div>
            {pending.map((r, i) => (
              <div key={i} className="delivery-rows__row">
                <input type="date" value={r.delivery_date} onChange={(e) => updateRow(i, { delivery_date: e.target.value })} max={new Date().toISOString().slice(0, 10)} required />
                <NumberInput min={0} placeholder="e.g. 15" value={r.qty} onChange={(v) => updateRow(i, { qty: v })} className="" />
                {pending.length > 1 && (
                  <button type="button" className="icon-btn icon-btn--danger" onClick={() => removeRow(i)} aria-label="Remove row">×</button>
                )}
              </div>
            ))}
            <button type="button" className="btn-secondary btn-secondary--sm" onClick={addRow}>+ Add Row</button>
          </div>
          <div className="form-hint" style={{ margin: '6px 0' }}>Log each delivery round separately until the target is fully received.</div>

          <label className="login-field">
            <span>Comments (optional)</span>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was delivered / condition / receiver…" maxLength={500} />
          </label>

          {rounds.length > 0 && (
            <div className="update-history">
              <div className="update-history__title">Delivery history</div>
              <ul>
                {rounds.map((r) => (
                  <li key={r.id} className="update-history__row">
                    <div>
                      <b>{fmtDate(r.delivery_date)}</b> — {r.qty}{item.unit ? ` ${item.unit}` : ''} · <span className="form-hint">{fmtName(r.author)}</span>
                      {r.note && <div className="form-hint">{r.note}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn-secondary btn-secondary--sm" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary btn-primary--sm" disabled={busy}>{busy ? 'Saving…' : 'Submit progress'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
