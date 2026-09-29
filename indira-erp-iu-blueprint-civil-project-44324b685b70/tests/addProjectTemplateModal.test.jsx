import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AddProjectTemplateModal from '../src/components/AddProjectTemplateModal.jsx';

const TYPES = [
  { id: 'pt1', name: 'Civil', is_active: true },
  { id: 'pt2', name: 'IT', is_active: false },
];

describe('AddProjectTemplateModal', () => {
  const onCancel = vi.fn();
  const onSave = vi.fn();

  beforeEach(() => { onCancel.mockClear(); onSave.mockClear(); });

  it('renders nothing when closed', () => {
    const { container } = render(<AddProjectTemplateModal open={false} projectTypes={TYPES} onCancel={onCancel} onSave={onSave} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('disables template name until project type is picked', () => {
    render(<AddProjectTemplateModal open projectTypes={TYPES} onCancel={onCancel} onSave={onSave} />);
    const nameInput = screen.getByPlaceholderText(/multi-storey/i);
    expect(nameInput).toBeDisabled();
    expect(screen.getByText(/select a project type first/i)).toBeInTheDocument();
  });

  it('only lists ACTIVE project types', () => {
    render(<AddProjectTemplateModal open projectTypes={TYPES} onCancel={onCancel} onSave={onSave} />);
    const [typeSel] = screen.getAllByRole('combobox');
    expect(typeSel).toHaveTextContent('Civil');
    expect(typeSel).not.toHaveTextContent('IT');
  });

  it('shows inline error for missing name after picking type', () => {
    render(<AddProjectTemplateModal open projectTypes={TYPES} onCancel={onCancel} onSave={onSave} />);
    const [typeSel] = screen.getAllByRole('combobox');
    fireEvent.change(typeSel, { target: { value: 'pt1' } });
    fireEvent.click(screen.getByRole('button', { name: /create template/i }));
    expect(screen.getByText(/template name is required/i)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('blocks case-insensitive duplicate names client-side', () => {
    render(<AddProjectTemplateModal open projectTypes={TYPES} existingNames={['Bridge']} onCancel={onCancel} onSave={onSave} />);
    const [typeSel] = screen.getAllByRole('combobox');
    fireEvent.change(typeSel, { target: { value: 'pt1' } });
    fireEvent.change(screen.getByPlaceholderText(/multi-storey/i), { target: { value: 'BRIDGE' } });
    fireEvent.click(screen.getByRole('button', { name: /create template/i }));
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves with trimmed name and optional description (no department field)', () => {
    render(<AddProjectTemplateModal open projectTypes={TYPES} onCancel={onCancel} onSave={onSave} />);
    const [typeSel] = screen.getAllByRole('combobox');
    fireEvent.change(typeSel, { target: { value: 'pt1' } });
    fireEvent.change(screen.getByPlaceholderText(/multi-storey/i), { target: { value: '  Bridge  ' } });
    fireEvent.change(screen.getByPlaceholderText(/short summary/i), { target: { value: 'Bridge template' } });
    fireEvent.click(screen.getByRole('button', { name: /create template/i }));
    expect(onSave).toHaveBeenCalledWith({
      projectTypeId: 'pt1', name: 'Bridge', description: 'Bridge template', isDraft: true,
    });
  });

  it('calls onCancel from Cancel and closes on Escape', () => {
    render(<AddProjectTemplateModal open projectTypes={TYPES} onCancel={onCancel} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    onCancel.mockClear();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
