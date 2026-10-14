// pick-folders.ts — the native folder picker bridge, main-process pure half (U-326). main.ts supplies
// dialog.showOpenDialog on the focused window; this module caps paths, shapes the answer and fixes
// the dialog options. It imports no Electron module.
import type { Locale } from '../src/presentation/labels/t';

export const PICK_FOLDERS_MAX = 50;

/** Fixed titles from the shell copy; the renderer cannot override them (U-326). */
export const FOLDER_PICKER_TITLES: Readonly<Record<Locale, string>> = {
  tr: 'Klasör seç',
  en: 'Choose a folder',
};

export type PickFoldersOptions = {
  readonly multiple?: boolean;
};

export type PickFoldersResult =
  | { readonly canceled: true }
  | { readonly canceled: false; readonly paths: readonly string[]; readonly truncated?: true };

export const folderPickerDialogTitle = (locale: Locale): string => FOLDER_PICKER_TITLES[locale];

/** Reads only `multiple`; any title or default path from the renderer is ignored (U-326). */
export const parsePickFoldersRequest = (value: unknown): PickFoldersOptions & { readonly multiple: boolean } => {
  if (typeof value !== 'object' || value === null) return { multiple: false };
  const record = value as Record<string, unknown>;
  return { multiple: record.multiple === true };
};

export const buildPickFoldersOpenDialogOptions = (
  multiple: boolean,
  title: string,
): { readonly properties: ('openDirectory' | 'multiSelections')[]; readonly title: string } => ({
  properties: multiple ? ['openDirectory', 'multiSelections'] : ['openDirectory'],
  title,
});

export const shapePickFoldersResult = (
  canceled: boolean,
  filePaths: readonly string[] | undefined,
): PickFoldersResult => {
  if (canceled) return { canceled: true };
  const paths = filePaths ?? [];
  if (paths.length > PICK_FOLDERS_MAX) {
    return { canceled: false, paths: paths.slice(0, PICK_FOLDERS_MAX), truncated: true };
  }
  return { canceled: false, paths: [...paths] };
};
