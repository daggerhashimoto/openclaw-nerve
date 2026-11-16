/**
 * Labels for the "primary" model choice, the one that follows the agent's default model.
 * The internal value stays `primary`; this is only what a person reads.
 *
 * When the catalog names the primary model, the button shows that model's short label and the
 * list marks it as the primary. When it does not, both read `Primary`. The bare internal value
 * is never shown.
 */
const INHERITED_MODEL_FALLBACK_LABEL = 'Primary';

export interface InheritedModelLabels {
  /** What the closed select shows. */
  button: string;
  /** What the open list shows for the inherited option. */
  option: string;
}

export function inheritedModelLabels(primaryLabel: string | null | undefined): InheritedModelLabels {
  const name = primaryLabel?.trim();
  if (!name) {
    return { button: INHERITED_MODEL_FALLBACK_LABEL, option: INHERITED_MODEL_FALLBACK_LABEL };
  }
  return { button: name, option: `${name} (primary)` };
}
