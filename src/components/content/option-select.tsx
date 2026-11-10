import { Select } from "@/components/ui/field";
import type { OptionItem } from "@/lib/content/data";

/**
 * A dropdown of one option list of the workspace (managed in Settings).
 * Pass the active options (activeOptions in src/lib/content/data.ts), which
 * keep an archived current value so old posts still show it.
 */
export function OptionSelect({
  id,
  name,
  options,
  defaultValue,
  empty = "None",
  disabled,
}: {
  id: string;
  name: string;
  options: OptionItem[];
  defaultValue?: string | null;
  empty?: string | false;
  disabled?: boolean;
}) {
  return (
    <Select id={id} name={name} defaultValue={defaultValue ?? ""} disabled={disabled}>
      {empty !== false && <option value="">{empty}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
          {option.archived ? " (archived)" : ""}
        </option>
      ))}
    </Select>
  );
}
