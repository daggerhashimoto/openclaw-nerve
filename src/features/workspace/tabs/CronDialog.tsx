/**
 * CronDialog — Modal for creating or editing cron jobs.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { InlineSelect } from '@/components/ui/InlineSelect';
import type { CronJob } from '../hooks/useCrons';

interface CronDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (job: Record<string, unknown>) => Promise<boolean>;
  mode: 'create' | 'edit';
  /** Pre-fill form when editing */
  initialData?: CronJob | null;
}

type ScheduleKind = 'cron' | 'every' | 'at';
type PayloadKind = 'agentTurn' | 'systemEvent';
type DeliveryMode = 'none' | 'announce';

interface ModelInfo {
  id: string;
  label?: string;
}

const INTERVAL_PRESETS = [
  { value: '300000', label: '5 minutes' },
  { value: '900000', label: '15 minutes' },
  { value: '1800000', label: '30 minutes' },
  { value: '3600000', label: '1 hour' },
  { value: '7200000', label: '2 hours' },
  { value: '21600000', label: '6 hours' },
  { value: '43200000', label: '12 hours' },
  { value: '86400000', label: '24 hours' },
];

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  discord: 'Discord',
  signal: 'Signal',
  slack: 'Slack',
  irc: 'IRC',
  googlechat: 'Google Chat',
  imessage: 'iMessage',
};

const CHANNEL_PLACEHOLDERS: Record<string, string> = {
  whatsapp: '+905551234567',
  telegram: '-100123456789 or @username',
  discord: 'channel-id',
  signal: '+905551234567',
  slack: '#channel or @user',
  irc: '#channel',
  googlechat: 'space-id',
  imessage: '+905551234567',
};

/** Strip the auto-appended delivery instruction from a prompt for clean editing */
function stripDeliveryInstruction(msg: string): string {
  return msg.replace(/\n\n(?:After completing the task, s|S)end the result using the message tool.*$/s, '');
}

function isoToLocal(iso: string): string {
  try {
    const d = new Date(iso);
    // datetime-local expects YYYY-MM-DDTHH:MM
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

function SectionShell({
  eyebrow,
  title,
  description,
  children,
  className = '',
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`cockpit-surface p-3.5 ${className}`}>
      <div className="space-y-0.5">
        <div className="cockpit-kicker text-[9px]">
          <span className="text-primary">◆</span>
          {eyebrow}
        </div>
        <div className="text-base font-semibold tracking-[-0.03em] text-foreground">{title}</div>
        <p className="text-[12.5px] leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="mt-3 space-y-2.5">{children}</div>
    </section>
  );
}

/** Modal dialog for creating or editing a cron job (schedule, prompt, model, channel). */
export function CronDialog({ open, onClose, onSubmit, mode, initialData }: CronDialogProps) {
  const prefill = mode === 'edit' && initialData ? initialData : null;
  const [name, setName] = useState(() => prefill?.name || '');
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>(() => prefill?.scheduleKind || 'every');
  const [cronExpr, setCronExpr] = useState(() => prefill?.schedule || '0 9 * * *');
  const [cronTz, setCronTz] = useState(() => prefill?.scheduleTz || '');
  const [everyMs, setEveryMs] = useState(() => prefill?.everyMs?.toString() || '3600000');
  const [atTime, setAtTime] = useState(() => prefill?.at ? isoToLocal(prefill.at) : '');
  const [payloadKind, setPayloadKind] = useState<PayloadKind>(() => prefill?.payloadKind || 'agentTurn');
  const [message, setMessage] = useState(() => prefill ? stripDeliveryInstruction(prefill.message || '') : '');
  const [model, setModel] = useState(() => prefill?.model || '');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(() => prefill?.delivery?.mode === 'announce' ? 'announce' : 'none');
  const [deliveryChannel, setDeliveryChannel] = useState(() => prefill?.delivery?.channel || '');
  const [deliveryTo, setDeliveryTo] = useState(() => prefill?.delivery?.to || '');
  const [models, setModels] = useState<{ value: string; label: string }[]>([]);
  const [availableChannels, setAvailableChannels] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Fetch available models and configured channels when dialog opens
  useEffect(() => {
    if (!open) return;
    fetch('/api/gateway/models')
      .then(r => r.json())
      .then((data: { models?: ModelInfo[] }) => {
        if (Array.isArray(data.models)) {
          const opts = [
            { value: '', label: 'Default model' },
            ...data.models.map(m => ({
              value: m.id,
              label: m.label || m.id.split('/').pop() || m.id,
            })),
          ];
          setModels(opts);
        }
      })
      .catch(() => {
        setModels([{ value: '', label: 'Default model' }]);
      });
    fetch('/api/channels')
      .then(r => r.json())
      .then((data: { channels?: string[] }) => {
        const ch = data.channels || [];
        setAvailableChannels(ch);
      })
      .catch(() => setAvailableChannels([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on open
  }, [open]);

  // Form state is initialized from props via useState initializers above.
  // Parent uses a `key` prop to force remount when mode/job changes.

  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [open]);

  const handleClose = useCallback(() => {
    setError('');
    onClose();
  }, [onClose]);

  const handleDialogClick = useCallback((e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) handleClose();
  }, [handleClose]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!message.trim()) {
      setError('Message/prompt is required');
      return;
    }

    if (payloadKind === 'agentTurn' && deliveryMode === 'announce' && availableChannels.length > 0 && !deliveryChannel) {
      setError('Select a delivery channel or switch to "Run silently"');
      return;
    }

    // Build schedule
    let schedule: Record<string, unknown>;
    if (scheduleKind === 'cron') {
      if (!cronExpr.trim()) { setError('Cron expression required'); return; }
      schedule = { kind: 'cron', expr: cronExpr.trim() };
      if (cronTz.trim()) schedule.tz = cronTz.trim();
    } else if (scheduleKind === 'every') {
      schedule = { kind: 'every', everyMs: parseInt(everyMs) };
    } else {
      if (!atTime.trim()) { setError('Date/time required'); return; }
      schedule = { kind: 'at', at: new Date(atTime).toISOString() };
    }

    // Build payload
    const sessionTarget = payloadKind === 'agentTurn' ? 'isolated' : 'main';
    let payload: Record<string, unknown>;
    if (payloadKind === 'agentTurn') {
      let finalMessage = message.trim();

      // Workaround: announce delivery doesn't reliably send to channels like WhatsApp.
      // Instead, append a send instruction to the agent prompt so it uses the message tool directly.
      if (deliveryMode === 'announce' && deliveryChannel && deliveryTo.trim()) {
        finalMessage += `\n\nSend the result using the message tool (channel=${deliveryChannel}, target=${deliveryTo.trim()}). Keep the message concise. After sending, respond with only: NO_REPLY`;
      }

      payload = { kind: 'agentTurn', message: finalMessage };
      if (model) payload.model = model;
    } else {
      payload = { kind: 'systemEvent', text: message.trim() };
    }

    // Build delivery — use "none" when we've baked send instructions into the prompt
    const hasInlineDelivery = payloadKind === 'agentTurn' && deliveryMode === 'announce' && deliveryChannel && deliveryTo.trim();
    const delivery: Record<string, unknown> = { mode: hasInlineDelivery ? 'none' : deliveryMode };
    if (deliveryMode === 'announce' && !hasInlineDelivery) {
      if (deliveryChannel) delivery.channel = deliveryChannel;
      if (deliveryTo.trim()) delivery.to = deliveryTo.trim();
    }

    const job: Record<string, unknown> = {
      schedule,
      payload,
      sessionTarget,
      delivery,
      enabled: true,
    };
    if (name.trim()) job.name = name.trim();

    setSubmitting(true);
    const ok = await onSubmit(job);
    setSubmitting(false);

    if (ok) {
      handleClose();
    } else {
      setError(`Failed to ${mode === 'edit' ? 'update' : 'create'} cron job`);
    }
  }, [name, scheduleKind, cronExpr, cronTz, everyMs, atTime, payloadKind, message, model, deliveryMode, deliveryChannel, deliveryTo, onSubmit, handleClose, mode]);

  if (!open) return null;

  const isEdit = mode === 'edit';

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleClose}
      onClick={handleDialogClick}
      aria-labelledby="cron-dialog-title"
      className="fixed inset-0 z-50 m-auto max-h-[calc(100dvh-1rem)] w-[min(1040px,calc(100vw-1rem))] overflow-y-auto rounded-[24px] border border-border/80 bg-card/96 p-0 shadow-[0_36px_90px_rgba(0,0,0,0.38)] backdrop:bg-black/52 backdrop:backdrop-blur-sm sm:max-h-[calc(100dvh-2rem)] sm:rounded-[30px]"
      style={{ overscrollBehavior: 'contain' }}
    >
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()} className="flex flex-col">
        {/* Header */}
        <div className="border-b border-border/70 bg-secondary/42 px-4 py-3 sm:px-5 sm:py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="cockpit-kicker">
                <span className="text-primary">◆</span>
                Scheduler
              </div>
              <h2 id="cron-dialog-title" className="cockpit-title text-[1.15rem]">
                {isEdit ? 'Edit cron job' : 'Create cron job'}
              </h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="shell-icon-button min-h-9 px-3"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="grid gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-4 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
          <div className="space-y-4">
            <SectionShell
              eyebrow="Identity"
              title="Name and timing"
              description="Name the job and choose the cadence it should follow."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="cron-name" className="cockpit-field-label">Name (optional)</label>
                  <input
                    id="cron-name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Morning status digest"
                    className="cockpit-input"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <span className="cockpit-field-label">Schedule type</span>
                  <InlineSelect inline
                    value={scheduleKind}
                    onChange={v => setScheduleKind(v as ScheduleKind)}
                    options={[
                      { value: 'every', label: 'Recurring interval' },
                      { value: 'cron', label: 'Cron expression' },
                      { value: 'at', label: 'One-shot at time' },
                    ]}
                    ariaLabel="Schedule type"
                    triggerClassName="min-h-11 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-sm font-sans text-foreground"
                    menuClassName="rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]"
                  />
                </div>
              </div>

              {scheduleKind === 'cron' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="cron-expr" className="cockpit-field-label">Cron expression</label>
                    <input
                      id="cron-expr"
                      type="text"
                      value={cronExpr}
                      onChange={e => setCronExpr(e.target.value)}
                      placeholder="0 9 * * *"
                      className="cockpit-input cockpit-input-mono"
                    />
                    <span className="cockpit-field-hint">Minute, hour, day, month, weekday.</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="cron-tz" className="cockpit-field-label">Timezone (optional)</label>
                    <input
                      id="cron-tz"
                      type="text"
                      value={cronTz}
                      onChange={e => setCronTz(e.target.value)}
                      placeholder="Europe/Berlin"
                      className="cockpit-input cockpit-input-mono"
                    />
                    <span className="cockpit-field-hint">Blank uses the server timezone.</span>
                  </div>
                </div>
              )}

              {scheduleKind === 'every' && (
                <div className="flex flex-col gap-1">
                  <span className="cockpit-field-label">Interval</span>
                  <InlineSelect inline
                    value={everyMs}
                    onChange={setEveryMs}
                    options={INTERVAL_PRESETS}
                    ariaLabel="Interval"
                    triggerClassName="min-h-11 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-sm font-sans text-foreground"
                    menuClassName="rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]"
                  />
                  <span className="cockpit-field-hint">Best for recurring checks and summaries.</span>
                </div>
              )}

              {scheduleKind === 'at' && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="cron-at-time" className="cockpit-field-label">Date &amp; time</label>
                  <input
                    id="cron-at-time"
                    type="datetime-local"
                    value={atTime}
                    onChange={e => setAtTime(e.target.value)}
                    style={{ colorScheme: 'dark' }}
                    className="cockpit-input cockpit-input-mono [&::-webkit-calendar-picker-indicator]:brightness-[2.8] [&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
                  />
                  <span className="cockpit-field-hint">Use this for a single future run.</span>
                </div>
              )}
            </SectionShell>

            <SectionShell
              eyebrow="Execution"
              title="Where it runs"
              description="Choose whether the work stays isolated or lands in the main session."
            >
              <div className="flex flex-col gap-1">
                <span className="cockpit-field-label">Execution type</span>
                <InlineSelect inline
                  value={payloadKind}
                  onChange={v => setPayloadKind(v as PayloadKind)}
                  options={[
                    { value: 'agentTurn', label: 'Agent task (isolated)' },
                    { value: 'systemEvent', label: 'System event (main session)' },
                  ]}
                  ariaLabel="Payload type"
                  triggerClassName="min-h-11 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-sm font-sans text-foreground"
                  menuClassName="rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]"
                />
              </div>
              <div className="cockpit-note" data-tone="primary">
                {payloadKind === 'agentTurn'
                  ? 'Agent tasks run in a private session and keep the main thread clean.'
                  : 'System events post into the main session and suit reminders or lightweight alerts.'}
              </div>
            </SectionShell>
          </div>

          <div className="space-y-4">
            <SectionShell
              eyebrow="Payload"
              title={payloadKind === 'agentTurn' ? 'What the agent should do' : 'What the event should say'}
              description={payloadKind === 'agentTurn'
                ? 'Write the task the same way you would brief a teammate.'
                : 'Write the message that should appear when the schedule fires.'}
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="cron-message" className="cockpit-field-label">
                  {payloadKind === 'agentTurn' ? 'Prompt' : 'Event text'}
                </label>
                <textarea
                  id="cron-message"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={3}
                  placeholder={payloadKind === 'agentTurn' ? 'Check my inbox, summarize the important items, and flag anything that needs a reply.' : 'Reminder: standup in 10 minutes.'}
                  className="cockpit-textarea min-h-[118px]"
                />
              </div>

              {payloadKind === 'agentTurn' && models.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="cockpit-field-label">Model</span>
                  <InlineSelect inline
                    value={model}
                    onChange={setModel}
                    options={models}
                    ariaLabel="Model"
                    triggerClassName="min-h-11 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-sm font-sans text-foreground"
                    menuClassName="min-w-[200px] rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]"
                    dropUp
                  />
                  <span className="cockpit-field-hint">Leave this on default unless the job needs a specific model.</span>
                </div>
              )}
            </SectionShell>

            {payloadKind === 'agentTurn' && (
              <SectionShell
                eyebrow="Delivery"
                title="What happens after it finishes"
                description="Choose whether the result stays in Nerve or gets sent out."
              >
                <div className="flex flex-col gap-1">
                  <span className="cockpit-field-label">Result handling</span>
                  <InlineSelect inline
                    value={deliveryMode}
                    onChange={v => setDeliveryMode(v as DeliveryMode)}
                    options={[
                      { value: 'announce', label: 'Send result to a channel' },
                      { value: 'none', label: 'Keep it inside Nerve' },
                    ]}
                    ariaLabel="Delivery mode"
                    triggerClassName="min-h-11 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-sm font-sans text-foreground"
                    menuClassName="rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]"
                  />
                </div>

                {deliveryMode === 'none' && (
                  <div className="cockpit-note">
                    The result stays in the session transcript for later review.
                  </div>
                )}

                {deliveryMode === 'announce' && (
                  <div className="space-y-2.5">
                    {availableChannels.length === 0 ? (
                      <div className="rounded-[18px] border border-orange/30 bg-orange/6 px-3 py-3 text-[11px] text-orange/85">
                        No messaging channels are configured yet. Set one up in OpenClaw first, or keep the job inside Nerve.
                      </div>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1">
                          <span className="cockpit-field-label">Channel</span>
                          <InlineSelect inline
                            value={deliveryChannel}
                            onChange={setDeliveryChannel}
                            options={[
                              { value: '', label: 'Select channel…' },
                              ...availableChannels.map(ch => ({
                                value: ch,
                                label: CHANNEL_LABELS[ch] || ch,
                              })),
                            ]}
                            ariaLabel="Delivery channel"
                            triggerClassName="min-h-11 w-full justify-between rounded-2xl border-border/80 bg-background/65 px-3 py-2 text-sm font-sans text-foreground"
                            menuClassName="rounded-2xl border-border/80 bg-card/98 p-1 shadow-[0_20px_48px_rgba(0,0,0,0.28)]"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label htmlFor="cron-deliver-to" className="cockpit-field-label">Recipient / destination</label>
                          <input
                            id="cron-deliver-to"
                            type="text"
                            value={deliveryTo}
                            onChange={e => setDeliveryTo(e.target.value)}
                            placeholder={CHANNEL_PLACEHOLDERS[deliveryChannel] || 'recipient ID'}
                            className="cockpit-input cockpit-input-mono"
                          />
                        </div>
                      </div>
                    )}
                    <div className="cockpit-note" data-tone="primary">
                      Nerve appends the delivery instruction so the agent can send the result directly when it finishes.
                    </div>
                  </div>
                )}
              </SectionShell>
            )}

            {error && (
              <div className="cockpit-note" data-tone="danger">{error}</div>
            )}

            <div className="flex flex-col items-stretch gap-3 rounded-[24px] border border-border/70 bg-secondary/28 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <p className="text-sm leading-5 text-muted-foreground">
                {isEdit
                  ? 'Save when the timing and delivery look right.'
                  : 'Create the job when the timing and delivery look right.'}
              </p>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex min-h-10 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-[0_16px_34px_rgba(0,0,0,0.24)] transition-transform hover:-translate-y-px hover:bg-primary/95 disabled:cursor-not-allowed disabled:opacity-50 sm:shrink-0"
              >
                {submitting ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Cron')}
              </button>
            </div>
          </div>
        </div>
      </form>
    </dialog>
  );
}
