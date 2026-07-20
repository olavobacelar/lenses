import type { ReactNode } from "react";
import { documentAttachmentLabel } from "../lib/attachments";
import { PaperclipIcon } from "./Icons";

interface DocumentChipProps {
  src?: string;
  label?: string;
  className: string;
  children?: ReactNode;
}

export function DocumentChip({ src, label, className, children }: DocumentChipProps) {
  const text = label ?? (src ? documentAttachmentLabel(src) : "File");
  return (
    <div className={className}>
      <PaperclipIcon size={14} />
      <span className="attachment-name" title={text}>
        {text}
      </span>
      {children}
    </div>
  );
}
