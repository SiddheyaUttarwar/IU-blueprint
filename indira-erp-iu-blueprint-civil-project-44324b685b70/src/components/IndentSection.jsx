import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  listIndentsForProject, listIndentItemsForProject,
  createIndent, createIndentWithItems, removeIndent,
  addIndentItem, updateIndentItem, removeIndentItem,
  uploadIndentFile, getIndentFileSignedUrl,
  extractIndentFromFile,
  recordReceipt,
  computeItemTotals, groupItemsByParent,
  listIndentItemHistory,
} from '../services/indents.js';
import { parseIndentWorkbook, buildIndentTemplate, downloadBlob } from '../lib/indentExcel.js';
import { getUnitNames, cachedUnitNames } from '../services/progressUnits.js';
import ReceiveItemModal from './ReceiveItemModal.jsx';
import NumberInput from './NumberInput.jsx';
import BudgetSection from './BudgetSection.jsx';
import AmountChangeBaselineModal from './AmountChangeBaselineModal.jsx';
import { createBaselineChangeRequest } from '../services/baselineChangeRequests.js';
import { IconPlus, IconTrash } from './Icons.jsx';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}
function fmtMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function UnitSelect({ value, onChange, disabled }) {
  const [units, setUnits] = useState(cachedUnitNames());
  useEffect(() => { getUnitNames().then(setUnits); }, []);
  const known = units.includes(value);
  const [custom, setCustom] = useState(!!value && !known);
  useEffect(() => { if (value && !units.includes(value)) setCustom(true); }, [value, units]);
  if (custom) {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          type="text"
          className="tpl-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="unit"
          autoFocus
        />
        <button
          type="button"
          className="icon-btn"
          onClick={() => { setCustom(false); onChange(''); }}
          disabled={disabled}
          aria-label="Back to unit list"
          title="Pick from list"
        >↺</button>
      </div>
    );
  }
  return (
    <select
      className="tpl-select"
      value={value}
      onChange={(e) => {
        if (e.target.value === '__other__') { setCustom(true); onChange(''); return; }
        onChange(e.target.value);
      }}
      disabled={disabled}
    >
      <option value="">—</option>
      {units.map((u) => <option key={u} value={u}>{u}</option>)}
      <option value="__other__">Other…</option>
    </select>
  );
}

export default function IndentSection({ project, tasks, profiles }) {
  const { profile, isProjectManager } = useAuth();
  const toast = useToast();
  const [indents, setIndents] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('items'); // 'items' | 'budgets'
  const [historyFor, setHistoryFor] = useState(null); // { item, history }

  async function openItemHistory(item) {
    try {
      const history = await listIndentItemHistory(item.id);
      setHistoryFor({ item, history });
    } catch (err) { toast.error(err.message || 'Failed to load history.'); }
  }
  const [addMode, setAddMode] = useState('manual'); // 'manual' | 'upload' | 'excel'
  const [addForm, setAddForm] = useState({
    indent_number: '', indent_date: new Date().toISOString().slice(0, 10),
    activity_name: project?.name ?? '', notes: '',
  });
  const [addFile, setAddFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [excelPreview, setExcelPreview] = useState(null); // { header, items, errors }
  const [excelParsing, setExcelParsing] = useState(false);
  const [receiveItem, setReceiveItem] = useState(null);
  const [itemDrafts, setItemDrafts] = useState({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [inds, its] = await Promise.all([
          listIndentsForProject(project.id),
          listIndentItemsForProject(project.id),
        ]);
        if (!cancelled) { setIndents(inds); setItems(its); }
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load indent items.');
      } finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [project.id, toast]);

  const itemsByIndent = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      if (!m.has(it.indent_id)) m.set(it.indent_id, []);
      m.get(it.indent_id).push(it);
    }
    return m;
  }, [items]);

  function toggleExpanded(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleSubmit(e) {
    if (addMode === 'excel') return handleSaveExcel(e);
    return handleAddIndent(e);
  }

  async function handleAddIndent(e) {
    e.preventDefault();
    if (addMode === 'upload' && !addFile) { toast.error('Upload the indent PDF first.'); return; }
    if (!addForm.indent_number.trim()) { toast.error('Indent number is required.'); return; }
    setBusy(true);
    try {
      let sourceFilePath = null;
      let sourceFileName = null;
      if (addFile) {
        const uploaded = await uploadIndentFile(project.id, addFile);
        sourceFilePath = uploaded.path;
        sourceFileName = uploaded.name;
      }
      const created = await createIndent(project.id, {
        indentNumber: addForm.indent_number,
        indentDate: addForm.indent_date,
        activityName: addForm.activity_name,
        sourceFilePath, sourceFileName,
        notes: addForm.notes,
        createdBy: profile?.id,
      });
      setIndents((prev) => [created, ...prev]);
      setExpanded((prev) => new Set(prev).add(created.id));
      resetAddState();
      toast.success(`Indent ${created.indent_number} added.${sourceFilePath ? ' Source file uploaded.' : ''}`);
    } catch (err) { toast.error(err.message || 'Failed to add indent.'); }
    finally { setBusy(false); }
  }

  function resetAddState() {
    setAddOpen(false);
    setAddFile(null);
    setAddMode('manual');
    setExcelPreview(null);
    setAddForm({
      indent_number: '', indent_date: new Date().toISOString().slice(0, 10),
      activity_name: project?.name ?? '', notes: '',
    });
  }

  async function handleExcelFile(file) {
    if (!file) { setExcelPreview(null); return; }
    setExcelParsing(true);
    try {
      const parsed = await parseIndentWorkbook(file);
      setExcelPreview(parsed);
      if (parsed.errors.length) {
        toast.error(parsed.errors[0]);
      } else {
        toast.info(`Parsed ${parsed.items.length} item${parsed.items.length === 1 ? '' : 's'}. Review and save.`);
      }
    } catch (err) {
      setExcelPreview(null);
      toast.error(err.message || 'Could not read the Excel file.');
    } finally { setExcelParsing(false); }
  }

  async function handleDownloadTemplate() {
    try {
      const blob = await buildIndentTemplate();
      downloadBlob(blob, 'indent-template.xlsx');
    } catch (err) { toast.error(err.message || 'Could not build the template.'); }
  }

  async function handleSaveExcel(e) {
    e.preventDefault();
    if (!excelPreview) { toast.error('Choose an Excel file first.'); return; }
    const { header, items } = excelPreview;
    if (!header.indentNumber) { toast.error('Indent number is missing in the Excel.'); return; }
    if (!header.indentDate) { toast.error('Indent date is missing in the Excel.'); return; }
    if (items.length === 0) { toast.error('No items found in the Excel.'); return; }
    setBusy(true);
    try {
      const { indent: created, items: createdItems } = await createIndentWithItems(project.id, {
        indentNumber: header.indentNumber,
        indentDate: header.indentDate,
        activityName: header.activity || project?.name || '',
        createdBy: profile?.id,
      }, items);
      setIndents((prev) => [created, ...prev]);
      setItems((prev) => [...prev, ...createdItems]);
      setExpanded((prev) => new Set(prev).add(created.id));
      resetAddState();
      toast.success(`Indent ${created.indent_number} imported with ${createdItems.length} item${createdItems.length === 1 ? '' : 's'}.`);
    } catch (err) { toast.error(err.message || 'Import failed.'); }
    finally { setBusy(false); }
  }

  async function handleExtractFromFile() {
    if (!addFile) { toast.error('Choose a file first.'); return; }
    setExtracting(true);
    try {
      const result = await extractIndentFromFile(project.id, addFile);
      if (result.header) {
        setAddForm((prev) => ({
          ...prev,
          indent_number: result.header.indentNumber || prev.indent_number,
          indent_date: result.header.indentDate || prev.indent_date,
          activity_name: result.header.activity || prev.activity_name,
        }));
      }
      toast.success(`Extracted ${result.items?.length ?? 0} item${result.items?.length === 1 ? '' : 's'} — review the fields and save.`);
    } catch (err) {
      toast.error(err.message || 'Extraction failed.');
    } finally { setExtracting(false); }
  }

  async function handleOpenFile(indent) {
    if (!indent.source_file_path) return;
    try {
      const url = await getIndentFileSignedUrl(indent.source_file_path, 300);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) { toast.error(err.message || 'Could not open the file.'); }
  }

  async function handleRemoveIndent(indent) {
    if (!window.confirm(`Delete indent "${indent.indent_number}" and all its items?`)) return;
    setBusy(true);
    try {
      await removeIndent(indent.id);
      setIndents((prev) => prev.filter((i) => i.id !== indent.id));
      setItems((prev) => prev.filter((i) => i.indent_id !== indent.id));
      toast.success('Indent deleted.');
    } catch (err) { toast.error(err.message || 'Failed to delete.'); }
    finally { setBusy(false); }
  }

  const [addItemChoice, setAddItemChoice] = useState(null); // { indentId }
  const [addSubItem, setAddSubItem] = useState(null); // { indentId, parentItem, buy_qty, unit_price }
  const [baselineItem, setBaselineItem] = useState(null); // indent item pending change-baseline

  async function submitIndentBaseline({ afterValues, reason }) {
    const before = {
      indent_items: [{
        id: baselineItem.id, item_name: baselineItem.item_name,
        buy_qty: baselineItem.buy_qty, unit_price: baselineItem.unit_price,
        planned_amount: baselineItem.planned_amount,
      }],
    };
    const after = {
      indent_items: [{
        id: baselineItem.id, item_name: baselineItem.item_name,
        buy_qty: afterValues.buy_qty, unit_price: afterValues.unit_price,
        planned_amount: afterValues.planned_amount,
      }],
    };
    await createBaselineChangeRequest({
      projectId: project.id, requestedBy: profile?.id, reason,
      beforeSnapshot: before, afterSnapshot: after,
    });
    toast.success('Amount baseline change submitted for leadership approval.');
  }

  async function handleAddNewItem(indentId) {
    setBusy(true);
    try {
      const sort = (itemsByIndent.get(indentId)?.length ?? 0) + 1;
      const created = await addIndentItem(indentId, {
        item_name: 'New item', unit: '', have_qty: 0, buy_qty: 0, unit_price: null, sort_order: sort,
      });
      setItems((prev) => [...prev, created]);
    } catch (err) { toast.error(err.message || 'Failed to add item.'); }
    finally { setBusy(false); setAddItemChoice(null); }
  }

  async function handleAddSubItem() {
    if (!addSubItem?.parentItem) return;
    const parent = addSubItem.parentItem;
    const buy = Number(addSubItem.buy_qty || 0);
    const price = addSubItem.unit_price === '' || addSubItem.unit_price == null ? null : Number(addSubItem.unit_price);
    if (!(buy > 0)) { toast.error('Enter Buy quantity greater than 0.'); return; }
    setBusy(true);
    try {
      const sort = (itemsByIndent.get(addSubItem.indentId)?.length ?? 0) + 1;
      const created = await addIndentItem(addSubItem.indentId, {
        item_name: parent.item_name,
        item_description: parent.item_description,
        unit: parent.unit,
        have_qty: 0, buy_qty: buy, unit_price: price,
        parent_indent_item_id: parent.id,
        sort_order: sort,
      });
      setItems((prev) => [...prev, created]);
      toast.success(`Added ${buy} more of "${parent.item_name}" as a sub-row.`);
      setAddSubItem(null);
    } catch (err) { toast.error(err.message || 'Failed to add sub-item.'); }
    finally { setBusy(false); }
  }

  // Local pending edits per row: { [itemId]: patch }
  function handleUpdateItem(id, patch) {
    setItemDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }));
  }
  function getDraftValue(item, field) {
    const draft = itemDrafts[item.id];
    if (draft && field in draft) return draft[field];
    return item[field];
  }
  function isItemDirty(id) {
    const d = itemDrafts[id];
    return d && Object.keys(d).length > 0;
  }
  async function handleSaveItem(item) {
    const draft = itemDrafts[item.id];
    if (!draft) return;
    setBusy(true);
    try {
      const updated = await updateIndentItem(item.id, draft, { actorId: profile?.id });
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
      setItemDrafts((prev) => { const rest = { ...prev }; delete rest[item.id]; return rest; });
      toast.success(`Saved "${updated.item_name}".`);
    } catch (err) { toast.error(err.message || 'Failed to save.'); }
    finally { setBusy(false); }
  }
  function handleDiscardItem(itemId) {
    setItemDrafts((prev) => { const rest = { ...prev }; delete rest[itemId]; return rest; });
  }

  async function handleRemoveItem(item) {
    if (!window.confirm(`Delete item "${item.item_name}"?`)) return;
    try {
      await removeIndentItem(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (err) { toast.error(err.message || 'Failed to delete.'); }
  }

  function canReceive(item) {
    if (!profile?.id) return false;
    const ids = Array.isArray(item.assigned_to_ids) ? item.assigned_to_ids : [];
    return ids.includes(profile.id) || isProjectManager;
  }

  async function handleSaveReceipt(patch) {
    if (!receiveItem) return;
    try {
      const updated = await recordReceipt(receiveItem.id, patch);
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      toast.success('Receipt recorded.');
    } catch (err) { toast.error(err.message || 'Failed to save.'); }
  }

  // Shared row renderer — parent rows and sub-rows share the same columns; sub-rows are visually indented
  // and their item name is derived from the parent (locked).
  function renderItemRow(it, wbs, isSub, parent) {
    const price = getDraftValue(it, 'unit_price');
    const buy = getDraftValue(it, 'buy_qty');
    const lineTotal = (price != null && price !== '') ? Number(buy || 0) * Number(price || 0) : null;
    const receivedQty = Number(it.received_qty ?? 0);
    const receivedActual = receivedQty * Number(price || 0);
    return (
      <div className={`indent-items-table__row${isItemDirty(it.id) ? ' is-dirty' : ''}${isSub ? ' indent-items-table__row--sub' : ''}`}>
        <div className="indent-items-table__num">{wbs}</div>
        <div>
          <input
            type="text" className="tpl-input"
            value={getDraftValue(it, 'item_name') ?? ''}
            onChange={(e) => handleUpdateItem(it.id, { item_name: e.target.value })}
            disabled={!isProjectManager || isSub}
            title={isSub ? `Sub-row of "${parent?.item_name}" — name is inherited.` : ''}
            style={isSub ? { background: '#f5f7fa' } : undefined}
          />
        </div>
        <div>
          <input
            type="text" className="tpl-input"
            value={getDraftValue(it, 'item_description') ?? ''}
            onChange={(e) => handleUpdateItem(it.id, { item_description: e.target.value })}
            disabled={!isProjectManager}
            placeholder="Details / spec"
          />
        </div>
        <div>
          <UnitSelect
            value={getDraftValue(it, 'unit') ?? ''}
            onChange={(v) => handleUpdateItem(it.id, { unit: v })}
            disabled={!isProjectManager || isSub}
          />
        </div>
        <div>
          <NumberInput
            value={getDraftValue(it, 'have_qty') ?? 0}
            onChange={(v) => handleUpdateItem(it.id, { have_qty: v })}
            min={0} disabled={!isProjectManager || isSub}
          />
        </div>
        <div>
          <NumberInput
            value={getDraftValue(it, 'buy_qty') ?? 0}
            onChange={(v) => handleUpdateItem(it.id, { buy_qty: v })}
            min={0} disabled={!isProjectManager}
          />
        </div>
        <div>
          <NumberInput
            value={getDraftValue(it, 'unit_price') ?? ''}
            onChange={(v) => handleUpdateItem(it.id, { unit_price: v })}
            placeholder="—" min={0} disabled={!isProjectManager}
          />
        </div>
        <div className="indent-items-table__total">
          {lineTotal != null
            ? <>
                <span className="form-hint">{buy} × {price} =</span>{' '}
                <b>{fmtMoney(lineTotal)}</b>
                <span className="indent-planned-tag">(Planned Amount)</span>
              </>
            : <span className="form-hint">—</span>}
        </div>
        <div>
          <NumberInput
            value={getDraftValue(it, 'planned_amount') ?? ''}
            onChange={(v) => handleUpdateItem(it.id, { planned_amount: v })}
            placeholder="—" min={0} disabled={!isProjectManager}
          />
        </div>
        <div className="indent-items-table__total">
          {price != null && price !== '' && receivedQty > 0
            ? <>
                <span className="form-hint">{receivedQty} × {price} =</span>{' '}
                <b>{fmtMoney(receivedActual)}</b>
              </>
            : <span className="form-hint">—</span>}
        </div>
        <div>
          <input
            type="text" className="tpl-input"
            value={getDraftValue(it, 'remark') ?? ''}
            onChange={(e) => handleUpdateItem(it.id, { remark: e.target.value })}
            disabled={!isProjectManager}
            placeholder="Remark"
          />
        </div>
        <div className="indent-items-table__received">
          {(() => {
            const rec = Number(it.received_qty ?? 0);
            const b = Number(it.buy_qty ?? 0);
            const state = rec >= b && b > 0 ? 'done' : rec > 0 ? 'partial' : 'none';
            return <span className={`recv-pill recv-pill--${state}`}>{rec} / {b}</span>;
          })()}
          {it.received_on && <div className="form-hint">on {fmtDate(it.received_on)}</div>}
        </div>
        <div className="indent-items-table__act">
          {canReceive(it) && (
            <button type="button" className="icon-btn" onClick={() => setReceiveItem(it)} title="Record receipt" aria-label="Record receipt">Receive</button>
          )}
          {isProjectManager && isItemDirty(it.id) && (
            <>
              <button type="button" className="btn-primary btn-primary--sm" style={{ padding: '4px 8px' }} onClick={() => handleSaveItem(it)} disabled={busy}>Save</button>
              <button type="button" className="btn-secondary btn-secondary--sm" style={{ padding: '4px 8px' }} onClick={() => handleDiscardItem(it.id)} disabled={busy}>Discard</button>
            </>
          )}
          <button type="button" className="btn-secondary btn-secondary--sm" style={{ padding: '4px 8px' }} onClick={() => openItemHistory(it)} title="View change history">History</button>
          {isProjectManager && (
            <button type="button" className="btn-secondary btn-secondary--sm" style={{ padding: '4px 8px' }} onClick={() => setBaselineItem(it)} title="Change baseline (planned amount) — sent to leadership">Change Baseline</button>
          )}
          {isProjectManager && (
            <button type="button" className="icon-btn icon-btn--danger" onClick={() => handleRemoveItem(it)} aria-label={`Remove ${it.item_name}`}>
              <IconTrash />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 className="masters-section__title" style={{ marginTop: 0 }}>Indent Cum Budget</h3>
          <div className="form-hint">
            {activeTab === 'items'
              ? 'Materials required for this project. Items can be mapped to tasks.'
              : 'Planned + actual amount per task. Every change is snapshotted automatically.'}
          </div>
        </div>
        {isProjectManager && !addOpen && activeTab === 'items' && (
          <button type="button" className="btn-primary btn-primary--sm" onClick={() => setAddOpen(true)}>
            <IconPlus /> Add Indent Cum Budget
          </button>
        )}
      </div>

      <div className="icb-tabs" role="tablist" aria-label="Indent Cum Budget view">
        <button
          type="button" role="tab"
          aria-selected={activeTab === 'items'}
          className={`icb-tabs__tab${activeTab === 'items' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('items')}
        >Material Items</button>
        <button
          type="button" role="tab"
          aria-selected={activeTab === 'budgets'}
          className={`icb-tabs__tab${activeTab === 'budgets' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('budgets')}
        >Task Budgets</button>
      </div>

      {activeTab === 'budgets' && <BudgetSection project={project} embedded />}

      {activeTab === 'items' && (<>
      {addOpen && (
        <form onSubmit={handleSubmit} className="indent-add-form">
          <div className="indent-add-form__modes" role="tablist" aria-label="Add indent mode">
            <button
              type="button"
              role="tab"
              aria-selected={addMode === 'manual'}
              className={`indent-add-form__mode ${addMode === 'manual' ? 'is-active' : ''}`}
              onClick={() => setAddMode('manual')}
            >
              Enter Manually
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={addMode === 'excel'}
              className={`indent-add-form__mode ${addMode === 'excel' ? 'is-active' : ''}`}
              onClick={() => setAddMode('excel')}
            >
              Import from Excel
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={addMode === 'upload'}
              className={`indent-add-form__mode ${addMode === 'upload' ? 'is-active' : ''}`}
              onClick={() => setAddMode('upload')}
            >
              Upload PDF / Image
            </button>
          </div>

          {addMode === 'upload' && (
            <div className="indent-add-form__upload">
              <label className="login-field" style={{ margin: 0 }}>
                <span>Indent PDF</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f && !/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
                      toast.error('Only PDF files are supported. Convert images to PDF first.');
                      e.target.value = '';
                      return;
                    }
                    setAddFile(f);
                  }}
                  required={addMode === 'upload'}
                />
                {addFile && <span className="form-hint">Selected: {addFile.name} ({Math.round(addFile.size / 1024)} KB)</span>}
                <span className="form-hint" style={{ marginTop: 4 }}>
                  Handwritten or unclear PDFs are still processed — whatever the OCR can read appears in the editable grid below, ready for you to correct in place.
                </span>
              </label>
              <button
                type="button"
                className="btn-secondary btn-secondary--sm"
                onClick={handleExtractFromFile}
                disabled={!addFile || extracting}
              >
                {extracting ? 'Extracting…' : 'Extract fields from file'}
              </button>
              <div className="form-hint">
                We&apos;ll read Indent No., Date, Activity and line items from the file. Review before saving.
              </div>
            </div>
          )}

          {addMode === 'excel' && (
            <div className="indent-add-form__upload">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                <label className="login-field" style={{ margin: 0, flex: 1, minWidth: 220 }}>
                  <span>Indent Excel (.xlsx)</span>
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(e) => handleExcelFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <button type="button" className="btn-secondary btn-secondary--sm" onClick={handleDownloadTemplate}>
                  Download template
                </button>
              </div>
              {excelParsing && <div className="form-hint">Reading workbook…</div>}
              {excelPreview && (
                <div className="indent-excel-preview">
                  <div className="indent-excel-preview__meta">
                    <div><b>Indent No:</b> {excelPreview.header.indentNumber || <em>missing</em>}</div>
                    <div><b>Date:</b> {excelPreview.header.indentDate || <em>missing</em>}</div>
                    <div><b>Activity:</b> {excelPreview.header.activity || <em>—</em>}</div>
                    <div><b>Items:</b> {excelPreview.items.length}</div>
                  </div>
                  {excelPreview.errors.length > 0 && (
                    <ul className="indent-excel-preview__errors">
                      {excelPreview.errors.map((err, i) => <li key={i}>{err}</li>)}
                    </ul>
                  )}
                  {excelPreview.items.length > 0 && (
                    <div className="indent-excel-preview__table">
                      <table>
                        <thead>
                          <tr>
                            <th>#</th><th>Item</th><th>Item Detailed Description</th><th>Unit</th>
                            <th>Quantity in Stock</th><th>Quantity Indented</th><th>Amount per Item</th><th>Remark</th>
                          </tr>
                        </thead>
                        <tbody>
                          {excelPreview.items.map((it, i) => (
                            <tr key={i}>
                              <td>{i + 1}</td>
                              <td>{it.item_name}</td>
                              <td>{it.item_description || '—'}</td>
                              <td>{it.unit || '—'}</td>
                              <td>{it.have_qty}</td>
                              <td>{it.buy_qty}</td>
                              <td>{it.unit_price ?? '—'}</td>
                              <td>{it.remark || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              <div className="form-hint">
                Excel needs labels &ldquo;Indent Number&rdquo;, &ldquo;Indent Date&rdquo;, &ldquo;Activity&rdquo; and an item table with columns &ldquo;Item Name&rdquo;, &ldquo;Quantity Indented&rdquo; (others optional). Use the template if unsure.
              </div>
            </div>
          )}

          {addMode !== 'excel' && (
            <div className="indent-add-form__grid">
              <label className="login-field">
                <span>Indent No.</span>
                <input type="text" value={addForm.indent_number} onChange={(e) => setAddForm({ ...addForm, indent_number: e.target.value })} required autoFocus={addMode === 'manual'} />
              </label>
              <label className="login-field">
                <span>Indent Date</span>
                <input type="date" value={addForm.indent_date} onChange={(e) => setAddForm({ ...addForm, indent_date: e.target.value })} required />
              </label>
              <label className="login-field">
                <span>Activity Name</span>
                <input type="text" value={addForm.activity_name} onChange={(e) => setAddForm({ ...addForm, activity_name: e.target.value })} placeholder={project?.name || 'Project / activity'} />
              </label>
              <label className="login-field" style={{ gridColumn: '1 / -1' }}>
                <span>Notes (optional)</span>
                <input type="text" value={addForm.notes} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })} maxLength={300} />
              </label>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn-secondary btn-secondary--sm" onClick={resetAddState} disabled={busy}>Cancel</button>
            <button
              type="submit"
              className="btn-primary btn-primary--sm"
              disabled={busy || (addMode === 'excel' && (!excelPreview || excelPreview.errors.length > 0 || excelPreview.items.length === 0))}
            >
              {busy ? 'Saving…' : addMode === 'excel' ? `Import ${excelPreview?.items.length ?? 0} item${excelPreview?.items.length === 1 ? '' : 's'}` : 'Save Indent'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="masters-users__empty">Loading…</div>
      ) : indents.length === 0 ? (
        <div className="masters-users__empty">No entries yet{isProjectManager ? ' — click Add Indent Cum Budget above.' : '.'}</div>
      ) : (
        <div className="indent-list">
          {indents.map((ind) => {
            const its = itemsByIndent.get(ind.id) ?? [];
            const groups = groupItemsByParent(its);
            const totals = computeItemTotals(its);
            const isOpen = expanded.has(ind.id);
            return (
              <div key={ind.id} className="indent-block">
                <div className="indent-block__head" onClick={() => toggleExpanded(ind.id)}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="indent-block__title">
                      <b>#{ind.indent_number}</b> · {fmtDate(ind.indent_date)}
                    </div>
                    {ind.activity_name && (
                      <div className="form-hint">Activity: {ind.activity_name}</div>
                    )}
                    <div className="form-hint">
                      {its.length} item{its.length === 1 ? '' : 's'} · Estimated: {fmtMoney(totals.totalCost)}
                      {ind.notes ? ` · ${ind.notes}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {ind.source_file_path && (
                      <button
                        type="button"
                        className="btn-secondary btn-secondary--sm"
                        onClick={(e) => { e.stopPropagation(); handleOpenFile(ind); }}
                        title={ind.source_file_name || 'View source file'}
                      >
                        View file
                      </button>
                    )}
                    {isProjectManager && (
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        onClick={(e) => { e.stopPropagation(); handleRemoveIndent(ind); }}
                        aria-label={`Delete indent ${ind.indent_number}`}
                      >
                        <IconTrash />
                      </button>
                    )}
                    <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                  </div>
                </div>

                {isOpen && (
                  <div className="indent-items-table">
                    <div className="indent-items-table__row indent-items-table__row--head">
                      <div>#</div>
                      <div>Item</div>
                      <div>Item Detailed Description</div>
                      <div>Unit</div>
                      <div>Quantity in Stock</div>
                      <div>Quantity Indented</div>
                      <div>Amount per Item</div>
                      <div>Planned (Indented × Amount per Item)</div>
                      <div>Planned Amt Override</div>
                      <div>Actual (Received × Amount per Item)</div>
                      <div>Remark</div>
                      <div>Received</div>
                      <div />
                    </div>
                    {its.length === 0 && (
                      <div className="masters-users__empty" style={{ padding: 12 }}>No items yet.</div>
                    )}
                    {groups.map((parent, gi) => (
                      <React.Fragment key={parent.id}>
                        {renderItemRow(parent, `${gi + 1}`, false)}
                        {parent.subRows.map((sub, si) => renderItemRow(sub, `${gi + 1}.${si + 1}`, true, parent))}
                        {parent.subRows.length > 0 && (
                          <div className="indent-items-table__rollup">
                            <span>↳ Rolled-up Planned for <b>{parent.item_name}</b> (parent + {parent.subRows.length} sub-row{parent.subRows.length === 1 ? '' : 's'})</span>
                            <b>{fmtMoney(parent.rolledPlanned)}</b>
                          </div>
                        )}
                      </React.Fragment>
                    ))}
                    {its.length > 0 && (
                      <div className="indent-items-table__total-row">
                        <span>Total ({its.length} item{its.length === 1 ? '' : 's'})</span>
                        <b>{fmtMoney(totals.totalCost)}</b>
                      </div>
                    )}
                    {isProjectManager && (
                      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--color-border)' }}>
                        <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setAddItemChoice({ indentId: ind.id })}>
                          <IconPlus /> Add Item
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {receiveItem && (
        <ReceiveItemModal
          item={receiveItem}
          onClose={() => setReceiveItem(null)}
          onSave={handleSaveReceipt}
        />
      )}
      {addItemChoice && (
        <AddItemChoiceModal
          existingItems={(itemsByIndent.get(addItemChoice.indentId) ?? []).filter((x) => !x.parent_indent_item_id)}
          onClose={() => setAddItemChoice(null)}
          onNew={() => handleAddNewItem(addItemChoice.indentId)}
          onExisting={(parentItem) => {
            setAddItemChoice(null);
            setAddSubItem({ indentId: addItemChoice.indentId, parentItem, buy_qty: '', unit_price: '' });
          }}
        />
      )}
      {addSubItem && (
        <AddSubItemModal
          parent={addSubItem.parentItem}
          buy_qty={addSubItem.buy_qty}
          unit_price={addSubItem.unit_price}
          onChangeQty={(v) => setAddSubItem((prev) => ({ ...prev, buy_qty: v }))}
          onChangePrice={(v) => setAddSubItem((prev) => ({ ...prev, unit_price: v }))}
          onClose={() => setAddSubItem(null)}
          onSave={handleAddSubItem}
          busy={busy}
        />
      )}
      {baselineItem && (
        <AmountChangeBaselineModal
          target="indent_item"
          entity={{ name: baselineItem.item_name }}
          currentValues={{
            buy_qty: baselineItem.buy_qty,
            unit_price: baselineItem.unit_price,
            planned_amount: baselineItem.planned_amount,
          }}
          onClose={() => setBaselineItem(null)}
          onSubmit={submitIndentBaseline}
        />
      )}
      </>)}
      {historyFor && (
        <ItemHistoryModal
          item={historyFor.item}
          history={historyFor.history}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </section>
  );
}

const FIELD_LABEL = {
  unit_price: 'Amount per Item',
  buy_qty: 'Quantity Indented',
  have_qty: 'Quantity in Stock',
  received_qty: 'Received qty',
};

function fmtWhen(d) { return d ? new Date(d).toLocaleString() : ''; }
function fmtNum(n) { return n == null ? '—' : Number(n).toLocaleString('en-IN'); }
function fmtBy(p) {
  if (!p) return '—';
  return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email || '—';
}

function ItemHistoryModal({ item, history, onClose }) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card modal-card--wide">
        <h3 style={{ marginTop: 0 }}>Variance history — {item.item_name}</h3>
        {history.length === 0 ? (
          <div className="form-hint">No changes recorded yet.</div>
        ) : (
          <table className="tpl-table" style={{ fontSize: 12 }}>
            <thead><tr><th>When</th><th>Field</th><th>Previous</th><th>New</th><th>Delta</th><th>Reason</th><th>By</th></tr></thead>
            <tbody>
              {history.map((h) => {
                const delta = Number(h.delta);
                const isPositive = Number.isFinite(delta) && delta > 0;
                const isNegative = Number.isFinite(delta) && delta < 0;
                return (
                  <tr key={h.id}>
                    <td>{fmtWhen(h.created_at)}</td>
                    <td>{FIELD_LABEL[h.field] ?? h.field}</td>
                    <td>{fmtNum(h.previous_value)}</td>
                    <td>{fmtNum(h.new_value)}</td>
                    <td style={{ color: isNegative ? '#b3261e' : (isPositive ? '#166534' : 'inherit') }}>{fmtNum(h.delta)}</td>
                    <td>{h.reason || '—'}</td>
                    <td>{fmtBy(h.changed_by_profile)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" className="btn-secondary btn-secondary--sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// Modal 1: Choose whether to add a brand-new item or attach a sub-row to an existing item.
function AddItemChoiceModal({ existingItems, onClose, onNew, onExisting }) {
  const [pickId, setPickId] = useState('');
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h3 style={{ marginTop: 0 }}>Add Item</h3>
        <div className="form-hint" style={{ marginBottom: 12 }}>
          Same item can be added at a different price as a <b>sub-row</b> under the existing parent. Or add a brand-new item.
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <button type="button" className="btn-primary btn-primary--sm" onClick={onNew}>
            + Add as New Item
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, border: '1px solid var(--color-border)', borderRadius: 4 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Add to Existing Item</div>
            <select className="tpl-select" value={pickId} onChange={(e) => setPickId(e.target.value)} disabled={existingItems.length === 0}>
              <option value="">{existingItems.length === 0 ? 'No existing items yet' : 'Choose an existing item…'}</option>
              {existingItems.map((it) => (
                <option key={it.id} value={it.id}>{it.item_name} — {it.buy_qty} @ ₹{it.unit_price ?? '—'}</option>
              ))}
            </select>
            <button
              type="button" className="btn-secondary btn-secondary--sm"
              disabled={!pickId}
              onClick={() => { const p = existingItems.find((x) => x.id === pickId); if (p) onExisting(p); }}
            >
              Continue as Sub-row →
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn-secondary btn-secondary--sm" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// Modal 2: The user picked a parent item — collect only qty + price for the new sub-row.
function AddSubItemModal({ parent, buy_qty, unit_price, onChangeQty, onChangePrice, onClose, onSave, busy }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  const price = unit_price === '' || unit_price == null ? null : Number(unit_price);
  const qty = Number(buy_qty || 0);
  const total = price != null ? qty * price : null;
  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h3 style={{ marginTop: 0 }}>Add sub-row to &ldquo;{parent.item_name}&rdquo;</h3>
        <div className="form-hint" style={{ marginBottom: 10 }}>
          Item name, description and unit are inherited from the parent. Enter the additional quantity and its unit price.
          The rolled-up planned amount on the parent will include this sub-row.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label className="login-field">
            <span>Quantity Indented <span style={{ color: '#dc2626' }}>*</span></span>
            <input type="number" className="tpl-input" min={0} value={buy_qty ?? ''} onChange={(e) => onChangeQty(e.target.value)} autoFocus />
          </label>
          <label className="login-field">
            <span>Amount per Item</span>
            <input type="number" className="tpl-input" min={0} value={unit_price ?? ''} onChange={(e) => onChangePrice(e.target.value)} placeholder={`Parent: ₹${parent.unit_price ?? '—'}`} />
          </label>
        </div>
        {total != null && (
          <div className="form-hint" style={{ marginTop: 8, padding: 8, background: '#eef4fb', borderRadius: 4 }}>
            <b>Sub-row planned:</b> {qty} × {price} = <b>₹{total.toLocaleString('en-IN')}</b>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn-secondary btn-secondary--sm" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary btn-primary--sm" onClick={onSave} disabled={busy}>
            {busy ? 'Adding…' : 'Add Sub-row'}
          </button>
        </div>
      </div>
    </div>
  );
}
