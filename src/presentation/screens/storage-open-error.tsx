// storage-open-error.tsx — the only screen when the database cannot open: labelled paths and the
// one safe operator action. The app never moves or deletes the file from here.
import type { StorageOpenCopy } from '../storage-open-error';

export interface StorageOpenErrorScreenProps {
  readonly copy: StorageOpenCopy;
}

export function StorageOpenErrorScreen({ copy }: StorageOpenErrorScreenProps) {
  return (
    <div role="alert" data-storage-open="" className="flex min-h-dvh items-center justify-center bg-bg p-6 text-ink">
      <div className="w-full max-w-lg rounded-card border border-error/40 bg-surface p-5">
        <p className="text-[15px] font-semibold text-ink">{copy.title}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-inkdim">{copy.body}</p>
        <dl className="mt-4 space-y-3 text-[13px]">
          <div>
            <dt className="font-medium text-ink">{copy.dataDirLabel}</dt>
            <dd className="mt-1 select-all break-all rounded-card border border-hairline bg-band px-3 py-2 font-mono text-[12px] text-inkdim">
              {copy.dataDir}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-ink">{copy.dbPathLabel}</dt>
            <dd className="mt-1 select-all break-all rounded-card border border-hairline bg-band px-3 py-2 font-mono text-[12px] text-inkdim">
              {copy.dbPath}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-[13px] leading-relaxed text-inkdim">{copy.instruction}</p>
      </div>
    </div>
  );
}
