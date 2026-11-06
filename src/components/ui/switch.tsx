import * as React from "react";

/** Props for the {@link Switch} toggle component. */
interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

/**
 * Minimal toggle switch styled for the Nerve UI.
 *
 * A `role="switch"` button that toggles between checked/unchecked states
 * with a sliding thumb indicator and green highlight when active.
 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, disabled = false, className = "", id, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy }, ref) => {
    return (
      <button
        ref={ref}
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-[2px] transition-colors duration-[120ms] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? "bg-operator/30" : "bg-raised"
        } ${className}`}
      >
        {/* The thumb is a pane: lit cantaloupe when the operator has switched it on */}
        <span
          className={`pointer-events-none block h-4 w-4 rounded-[1px] transition-[transform,background-color] duration-[120ms] ${
            checked ? "bg-operator" : "bg-muted-foreground"
          } ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    );
  }
);

Switch.displayName = "Switch";
