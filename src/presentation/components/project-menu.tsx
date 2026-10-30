import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';

import type { Locale } from '../labels/t';
import { t } from '../labels/t';
import {
  PROJECT_BUNDLE_KEYS,
  type ProjectBundleStore,
} from '../stores/project-bundle';

export interface ProjectMenuProps {
  readonly locale: Locale;
  readonly store: ProjectBundleStore;
  readonly project?: string | null;
  readonly className?: string;
}

export function ProjectMenu({ locale, store, project, className }: ProjectMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target) !== true && buttonRef.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) {
      const path = (file as unknown as { readonly path?: string }).path || file.name;
      store.openImport(path);
    }
    // reset input so the same file can be picked again
    event.target.value = '';
  };

  const handleExport = (): void => {
    setOpen(false);
    if (project) {
      store.openExport(project);
    }
  };

  const handleImport = (): void => {
    setOpen(false);
    fileInputRef.current?.click();
  };

  return (
    <div className={`relative inline-block text-left ${className ?? ''}`} data-project-menu="">
      <input
        ref={fileInputRef}
        type="file"
        accept=".docket-bundle.json,.json"
        style={{ display: 'none' }}
        data-project-bundle-file-input=""
        aria-label={t(locale, PROJECT_BUNDLE_KEYS.importFileSelect)}
        onChange={onFileInputChange}
      />
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t(locale, PROJECT_BUNDLE_KEYS.menuTitle)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t(locale, PROJECT_BUNDLE_KEYS.menuTitle)}
        className="grid h-7 w-7 flex-none place-items-center rounded-control border border-hairline text-inkdim hover:border-bord hover:text-ink focus-visible:border-signal"
      >
        <span aria-hidden="true" className="font-mono text-[14px] leading-none">⋯</span>
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t(locale, PROJECT_BUNDLE_KEYS.menuTitle)}
          className="absolute right-0 z-50 mt-1 min-w-[140px] rounded-card border border-bord bg-surface p-1 shadow-elevation-overlay"
        >
          {project ? (
            <button
              type="button"
              role="menuitem"
              onClick={handleExport}
              className="flex w-full items-center rounded-control px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-raised focus-visible:bg-raised"
            >
              {t(locale, PROJECT_BUNDLE_KEYS.menuExport)}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={handleImport}
            className="flex w-full items-center rounded-control px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-raised focus-visible:bg-raised"
          >
            {t(locale, PROJECT_BUNDLE_KEYS.menuImport)}
          </button>
        </div>
      ) : null}
    </div>
  );
}
