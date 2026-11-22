/** Maximum indexed files numeric field. */

import { Field } from './fields.js';

/** Host default when maximumIndexFiles is 0. */
export const DEFAULT_MAXIMUM_INDEX_FILES = 30_000;

export const MAXIMUM_INDEX_FILES_CAP = 240_000;

export function MaximumIndexFilesField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (next: number) => void;
}) {
  const isCustom = value > 0;
  const modeId = `${id}-mode`;
  const customId = `${id}-custom`;
  return (
    <Field
      id={modeId}
      label="Maximum index files"
      full
      hint="Applies when reindexing this repo."
    >
      <select
        id={modeId}
        value={isCustom ? 'custom' : 'default'}
        onChange={(e) => {
          if (e.target.value === 'default') {
            onChange(0);
            return;
          }
          onChange(value > 0 ? value : DEFAULT_MAXIMUM_INDEX_FILES);
        }}
      >
        <option value="default">
          Default ({DEFAULT_MAXIMUM_INDEX_FILES.toLocaleString()})
        </option>
        <option value="custom">Custom</option>
      </select>
      {isCustom ? (
        <input
          id={customId}
          className="maximum-index-files-custom"
          type="number"
          min={1}
          max={MAXIMUM_INDEX_FILES_CAP}
          value={value}
          aria-label="Custom maximum index files"
          onChange={(e) => {
            const next = Math.floor(Number(e.target.value));
            if (!Number.isFinite(next) || next <= 0) {
              onChange(DEFAULT_MAXIMUM_INDEX_FILES);
              return;
            }
            onChange(Math.min(MAXIMUM_INDEX_FILES_CAP, next));
          }}
        />
      ) : null}
    </Field>
  );
}
