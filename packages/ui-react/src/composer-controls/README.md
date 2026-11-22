# composer-controls

Mode / approval / thoroughness pickers for the chat composer, shared by Desktop and the VS Code webview.

## Responsibility

Render three dropdown triggers and their listbox menus, report selections through callbacks, and own the default option catalogs (labels, descriptions, accent colours).

## Input / output

- In: `mode`, `approvalMode`, `thoroughness`, optional `dbAccess`, `intensityCustom`, `disabled`, `icons`, `checkIcon`, catalog overrides, `menuAlign`.
- Out: `onModeChange`, `onApprovalModeChange`, `onThoroughnessChange`, optional `onDbAccessChange`.
- Markup uses `composer-controls`, `composer-dropdown`, `composer-dropdown--{mode|approval|dbAccess|thoroughness}`, and `composer-dropdown__*` elements. Hosts style them from `--mitii-*` tokens.

## Behavior

- `onDbAccessChange` + `mode === 'database'` replaces the approval picker with a DB-access picker.
- `intensityCustom` shows a "Custom" thoroughness trigger and marks no level selected.
- Menus close on Escape or outside pointer-down and are pinned to the viewport next to their trigger (`menuAlign` `start` or `center`).
- Icons are props keyed by option id (`ask`, `safe`, `low`, `readonly`, `custom`, …); the package ships none. Passing `checkIcon` reserves the check slot on every row.

## Exports

`ComposerControls`, `composerModeColor`, `COMPOSER_MODE_COLORS`, `DEFAULT_*_OPTIONS`, `CUSTOM_THOROUGHNESS_OPTION`, and the `Composer*` types.

## Failure modes

An unknown `mode` / `approvalMode` / `thoroughness` value falls back to the first option (Guided and Medium for the latter two).

## Non-responsibilities

Host mode normalization (for example mapping legacy approval ids or a non-chat mode onto a picker value), persistence, messaging, and CSS.
