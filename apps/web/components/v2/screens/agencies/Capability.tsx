import { StatusPill } from '../../StatusPill';

/**
 * The mark beside a capability the product does not have yet (CC-29 D4): a neutral pill, as the
 * Developers artboard marks its roadmap. `data-v2-coming` is what the honesty tests look for.
 */
export function ComingMark({ label }: { label: string }) {
  return (
    <span data-v2-coming="">
      <StatusPill state="neutral">{label}</StatusPill>
    </span>
  );
}

/**
 * A piece of copy and the capabilities it names, written on the element as `data-capability`, with
 * the "coming" mark after its text when one of them is not built.
 */
export function Capability({
  as: Tag = 'span',
  item,
  comingLabel,
  className,
}: {
  as?: 'span' | 'p' | 'div' | 'li';
  item: { text: string; capabilities: readonly string[]; coming: boolean };
  comingLabel: string;
  className?: string;
}) {
  return (
    <Tag className={className} data-capability={item.capabilities.join(' ')}>
      {item.text}
      {item.coming ? (
        <>
          {' '}
          <ComingMark label={comingLabel} />
        </>
      ) : null}
    </Tag>
  );
}
