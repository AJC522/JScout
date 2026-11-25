import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

export interface RichTextProps extends Omit<ComponentProps<'div'>, 'children' | 'dangerouslySetInnerHTML'> {
  /**
   * HTML that the server has already sanitised (job descriptions are cleaned with
   * sanitize-html on ingest). Never pass user- or source-supplied HTML that has not been.
   */
  html: string;
}

/** Renders sanitised HTML with the long-form reading styles (.prose-job). */
export function RichText({ html, className, ...props }: RichTextProps) {
  return <div className={cn('prose-job', className)} dangerouslySetInnerHTML={{ __html: html }} {...props} />;
}
