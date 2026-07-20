import * as Switch from "@radix-ui/react-switch";

export function ToggleRow({
  id,
  title,
  checked,
  onChange,
}: {
  id: string;
  title: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <label className="toggle-label" htmlFor={id}>
        {title}
      </label>
      <Switch.Root
        className="toggle-switch"
        id={id}
        checked={checked}
        onCheckedChange={onChange}
      >
        <Switch.Thumb className="toggle-switch-thumb" />
      </Switch.Root>
    </div>
  );
}
