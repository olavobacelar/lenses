import * as Select from "@radix-ui/react-select";
import { CaretDownIcon, CheckIcon } from "@radix-ui/react-icons";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function SelectControl<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  id?: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  return (
    <Select.Root value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
      <Select.Trigger id={id} className="select-trigger" aria-label={ariaLabel}>
        <Select.Value className="select-value">{selectedLabel}</Select.Value>
        <Select.Icon className="select-icon">
          <CaretDownIcon aria-hidden="true" focusable="false" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="select-content"
          position="popper"
          sideOffset={4}
          collisionPadding={8}
        >
          <Select.Viewport className="select-viewport">
            {options.map((option) => (
              <Select.Item
                className="select-item"
                value={option.value}
                disabled={option.disabled}
                key={option.value}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="select-item-indicator">
                  <CheckIcon aria-hidden="true" focusable="false" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
