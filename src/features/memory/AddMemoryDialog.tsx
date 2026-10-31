/**
 * AddMemoryDialog: modal for adding a new memory.
 *
 * Allows entering memory text and selecting a section in MEMORY.md.
 * The section selector is a combo box: pick an existing section or type a new one.
 */

import { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';

interface AddMemoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (text: string, section: string) => Promise<boolean>;
  sections?: string[];
  isLoading?: boolean;
}

/** Dialog for creating a new agent memory entry. */
export function AddMemoryDialog({ open, onOpenChange, onAdd, sections = [], isLoading }: AddMemoryDialogProps) {
  const [text, setText] = useState('');
  const [section, setSection] = useState('');
  const [sectionDropdownOpen, setSectionDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter sections based on input
  const filteredSections = section.trim()
    ? sections.filter((s) => s.toLowerCase().includes(section.toLowerCase()))
    : sections;

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSectionDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || submitting) return;

    setSubmitting(true);
    const success = await onAdd(text.trim(), section.trim() || 'General');
    setSubmitting(false);

    if (success) {
      setText('');
      setSection('');
      onOpenChange(false);
    }
  };

  const handleClose = () => {
    if (!submitting) {
      setText('');
      setSection('');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg overflow-visible">
        <DialogHeader>
          <DialogTitle className="text-[1.067rem] font-semibold text-foreground">
            Add memory
          </DialogTitle>
          <DialogDescription className="text-[0.867rem] text-muted-foreground">
            Store a durable note in <code className="font-mono text-[0.8rem]">MEMORY.md</code>, either inside an existing section or under a new heading.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Section selector (combo box) */}
          <div className="space-y-2">
            <label className="cockpit-field-label">
              Section
            </label>
            <div className="relative" ref={dropdownRef}>
              <div className="relative">
                <input
                  ref={inputRef}
                  type="text"
                  value={section}
                  onChange={(e) => {
                    setSection(e.target.value);
                    setSectionDropdownOpen(true);
                  }}
                  onFocus={() => setSectionDropdownOpen(true)}
                  placeholder="General"
                  className="cockpit-input pr-11"
                  disabled={submitting}
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={sectionDropdownOpen}
                  aria-label="Memory section"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSectionDropdownOpen(!sectionDropdownOpen);
                    inputRef.current?.focus();
                  }}
                  className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-[3px] text-muted-foreground transition-colors duration-[120ms] hover:bg-raised hover:text-foreground"
                  tabIndex={-1}
                >
                  <ChevronDown size={14} className={sectionDropdownOpen ? 'rotate-180' : ''} />
                </button>
              </div>

              {/* Dropdown list */}
              {sectionDropdownOpen && filteredSections.length > 0 && (
                <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-[3px] border border-border bg-popover py-1 shadow-[0_12px_32px_rgba(0,0,0,0.32)]">
                  {filteredSections.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setSection(s);
                        setSectionDropdownOpen(false);
                      }}
                      className={`flex min-h-[var(--row-unit)] w-full items-center px-3 text-left text-[0.867rem] text-foreground transition-colors duration-[120ms] hover:bg-raised ${
                        section === s ? 'bg-raised font-medium' : ''
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                  {section.trim() && !sections.some((s) => s.toLowerCase() === section.trim().toLowerCase()) && (
                    <div className="mt-1 flex min-h-[var(--row-unit)] items-center border-t border-border px-3 text-[0.8rem] text-muted-foreground">
                      New section:&nbsp;<span className="font-medium text-foreground">{section.trim()}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className="cockpit-field-hint">Leave this as General or type a new section name to branch memory more cleanly.</p>
          </div>

          {/* Text input */}
          <div className="space-y-2">
            <label className="cockpit-field-label">
              Memory text
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter the memory to store"
              className="cockpit-textarea min-h-[132px]"
              rows={3}
              autoFocus
              disabled={submitting}
            />
            <p className="cockpit-field-hint">Write the durable fact or preference you want the agent to recall later.</p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!text.trim() || submitting || isLoading}
              className="min-w-[124px]"
            >
              {submitting ? 'Storing…' : 'Store memory'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
