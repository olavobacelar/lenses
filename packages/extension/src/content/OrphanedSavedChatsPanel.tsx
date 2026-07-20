import * as Collapsible from "@radix-ui/react-collapsible";
import { Cross2Icon } from "@radix-ui/react-icons";
import { useState } from "react";

export interface OrphanedSavedChatView {
  id: string;
  title: string;
  snippet: string;
}

export function OrphanedSavedChatsPanel({
  items,
  onOpen,
  onDelete,
}: {
  items: OrphanedSavedChatView[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = items.length;

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger asChild>
        <button
          type="button"
          className={`lenses-orphaned-toggle ${open ? "lenses-orphaned-toggle--open" : ""}`}
        >
          {count} saved chat{count > 1 ? "s" : ""}
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content asChild forceMount>
        <div className="lenses-orphaned-list">
          {items.map((item) => (
            <div key={item.id} className="lenses-orphaned-item">
              <button
                type="button"
                className="lenses-orphaned-item-open"
                onClick={() => onOpen(item.id)}
              >
                <span className="lenses-orphaned-item-title">{item.title}</span>
                <span className="lenses-orphaned-item-snippet">{item.snippet}</span>
              </button>
              <button
                type="button"
                className="lenses-orphaned-item-delete"
                aria-label="Delete saved chat"
                onClick={() => onDelete(item.id)}
              >
                <Cross2Icon aria-hidden="true" focusable="false" />
              </button>
            </div>
          ))}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
