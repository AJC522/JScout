import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useCopyToClipboard } from '../../lib/hooks';
import { Button, type ButtonSize, type ButtonVariant } from './Button';
import { IconButton } from './IconButton';

export interface CopyButtonProps {
  /** The text to copy, or a function producing it at click time. */
  text: string | (() => string);
  /** Visible label (and accessible name when iconOnly). Default "Copy". */
  label?: string;
  iconOnly?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
  onCopied?: () => void;
}

/** Copies text to the clipboard and confirms with "Copied" for a moment. */
export function CopyButton({ text, label = 'Copy', iconOnly = false, variant = 'secondary', size = 'sm', disabled, className, onCopied }: CopyButtonProps) {
  const { copied, copy } = useCopyToClipboard();
  const [failed, setFailed] = useState(false);

  const onClick = async () => {
    const ok = await copy(typeof text === 'function' ? text() : text);
    setFailed(!ok);
    if (ok) onCopied?.();
  };
  const status = copied ? 'Copied' : failed ? 'Copy failed' : label;

  if (iconOnly) {
    return (
      <IconButton
        label={status}
        icon={copied ? <Check className="text-success" /> : <Copy />}
        variant={variant === 'secondary' ? 'secondary' : 'ghost'}
        size={size}
        disabled={disabled}
        className={className}
        onClick={onClick}
      />
    );
  }
  return (
    <Button
      variant={variant}
      size={size}
      disabled={disabled}
      className={className}
      onClick={onClick}
      leadingIcon={copied ? <Check className="text-success" /> : <Copy />}
    >
      <span aria-live="polite">{status}</span>
    </Button>
  );
}
