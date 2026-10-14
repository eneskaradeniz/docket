// pick-folders.test.ts — A-384: the native folder picker bridge, pure dialog shape and answers.
import { describe, expect, it } from 'vitest';

import {
  FOLDER_PICKER_TITLES,
  PICK_FOLDERS_MAX,
  buildPickFoldersOpenDialogOptions,
  folderPickerDialogTitle,
  parsePickFoldersRequest,
  shapePickFoldersResult,
} from './pick-folders';

describe('A-384: pickFolders', () => {
  it('A-384: single selection uses openDirectory only', () => {
    expect(buildPickFoldersOpenDialogOptions(false, 'Choose a folder').properties).toEqual(['openDirectory']);
  });

  it('A-384: multiple adds multiSelections to openDirectory', () => {
    expect(buildPickFoldersOpenDialogOptions(true, 'Choose a folder').properties).toEqual([
      'openDirectory',
      'multiSelections',
    ]);
  });

  it('A-384: cancel answers { canceled: true }', () => {
    expect(shapePickFoldersResult(true, ['/tmp/a'])).toEqual({ canceled: true });
  });

  it('A-384: more than 50 paths are cut with truncated: true', () => {
    const paths = Array.from({ length: 55 }, (_, index) => `/p/${index}`);
    expect(shapePickFoldersResult(false, paths)).toEqual({
      canceled: false,
      paths: paths.slice(0, PICK_FOLDERS_MAX),
      truncated: true,
    });
  });

  it('A-384: parse keeps multiple only and drops a renderer title or default path', () => {
    expect(parsePickFoldersRequest({ multiple: true, title: 'x', defaultPath: '/secret' })).toEqual({ multiple: true });
    expect(parsePickFoldersRequest({ title: 'ignored', defaultPath: '/ignored' })).toEqual({ multiple: false });
    expect(parsePickFoldersRequest(undefined)).toEqual({ multiple: false });
    expect(
      buildPickFoldersOpenDialogOptions(
        parsePickFoldersRequest({ title: 'custom', defaultPath: '/home' }).multiple,
        folderPickerDialogTitle('en'),
      ),
    ).toEqual({
      properties: ['openDirectory'],
      title: FOLDER_PICKER_TITLES.en,
    });
    expect(buildPickFoldersOpenDialogOptions(true, folderPickerDialogTitle('tr')).title).toBe(FOLDER_PICKER_TITLES.tr);
  });
});
