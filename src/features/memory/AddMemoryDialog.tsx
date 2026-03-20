/**
 * AddMemoryDialog — Modal for adding a new memory.
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
          <div className="cockpit-kicker">
            <span className="text-primary">◆</span>
            Memory Capture
          </div>
          <DialogTitle className="text-[1.35rem] font-semibold tracking-[-0.03em] text-foreground">
            Add memory
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Store a durable note in `MEMORY.md`, either inside an existing section or under a new heading.
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
                  className="cockpit-toolbar-button absolute right-2 top-1/2 min-h-8 -translate-y-1/2 px-2.5"
                  tabIndex={-1}
                >
                  <ChevronDown size={14} className={`transition-transform ${sectionDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {/* Dropdown list */}
              {sectionDropdownOpen && filteredSections.length > 0 && (
                <div className="absolute z-50 mt-2 max-h-48 w-full overflow-y-auto rounded-2xl border border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                  {filteredSections.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setSection(s);
                        setSectionDropdownOpen(false);
                      }}
                      className={`w-full rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                        section === s ? 'bg-primary/12 text-primary' : 'text-foreground hover:bg-primary/8'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                  {section.trim() && !sections.some((s) => s.toLowerCase() === section.trim().toLowerCase()) && (
                    <div className="mt-1 rounded-xl border border-border/70 bg-background/60 px-3 py-2 text-[0.733rem] text-muted-foreground">
                      New section: <span className="font-medium text-primary">{section.trim()}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className="cockpit-field-hint">Leave this as `General` or type a new section name to branch memory more cleanly.</p>
          </div>

          {/* Text input */}
          <div className="space-y-2">
            <label className="cockpit-field-label">
              Memory Text
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter the memory to store..."
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
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!text.trim() || submitting || isLoading}
              className="min-w-[124px] text-xs"
            >
              {submitting ? 'Storing...' : 'Store Memory'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
