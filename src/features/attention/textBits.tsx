/** Small text pieces shared by the board's rows, the plate and the Today digest. */

import { Fragment } from 'react';
import { nameHueStyle } from '@/lib/agentColors';
import { cn } from '@/lib/utils';

const CLOCK = /(\b\d{1,2}:\d{2}\b)/;

/** Running text with every HH:MM set in monospace. */
export function Clocked({ text }: { text: string }) {
  return (
    <>
      {text.split(CLOCK).map((part, index) => (
        index % 2 === 1
          ? <span key={index} className="font-mono tabular">{part}</span>
          : <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}

/** A reason line with the owner's name in its family hue and clock times in monospace. */
export function ReasonText({ text, ownerName, hue }: { text: string; ownerName?: string; hue?: string }) {
  const at = ownerName ? text.indexOf(ownerName) : -1;
  if (!ownerName || at < 0) return <Clocked text={text} />;
  return (
    <>
      <Clocked text={text.slice(0, at)} />
      <span className={cn('font-medium', hue ? 'name-hued' : 'text-foreground')} style={nameHueStyle(hue)}>
        {ownerName}
      </span>
      <Clocked text={text.slice(at + ownerName.length)} />
    </>
  );
}

export function NewTag() {
  return <span className="shrink-0 font-mono text-[0.733rem] text-operator-text">New</span>;
}
