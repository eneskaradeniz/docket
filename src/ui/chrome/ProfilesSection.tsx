// ProfilesSection — WO-0098's «Sürücüler» section, vendor-grouped by WO-0108 (Faz E): the
// BUILTIN vendor's group carries the built-in passthrough card + today's global backend
// profiles + the add/edit form (per-vendor profiles are a named follow-up — VendorInfo.builtin
// names the home); every other WIRED vendor carries its Varsayılan alone with its own
// zero-token Test et (WO-0106's vendor axis); the probe-pending cast renders BELOW as plain
// info rows («henüz değil» + the reason — never a disabled control, ADR-0001). Each card keeps
// its per-card Test et (the handshake under THAT environment, resolved main-side); a
// secret-looking pair is refused BEFORE the write by the same core rule the store enforces.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppSettings, ProviderStatus, VendorInfo } from '../../core/app-settings';
import {
  DEFAULT_PROFILE,
  parseEnvText,
  profileEnvText,
  validateProfiles,
  type BackendProfile,
} from '../../core/backend-profile';
import { useLabels } from '../data/locale';
import { Button, Field, Input, Spinner, Textarea } from '../kit';
import { toast } from './ToastHost';

type Check = { verifying: boolean; status?: ProviderStatus };

export function ProfilesSection({ settings }: { settings: AppSettings }) {
  const { UI } = useLabels();
  const [vendors, setVendors] = useState<VendorInfo[]>([]);
  const [profiles, setProfiles] = useState<BackendProfile[]>([]);
  const profilesRef = useRef<BackendProfile[]>([]); // the list of record between a write and its re-read
  const [checks, setChecks] = useState<Record<string, Check>>({});
  // The form: `editing` = the index being edited, or null for a new profile.
  const [editing, setEditing] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [envDraft, setEnvDraft] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const envRef = useRef<HTMLTextAreaElement>(null);

  const reread = async (): Promise<void> => {
    const stored = await settings.getBackendProfiles();
    profilesRef.current = stored;
    setProfiles(stored);
  };

  useEffect(() => {
    void reread().catch(() => setProfiles([]));
    void settings.vendors().then(setVendors).catch(() => setVendors([]));
  }, [settings]);

  // WO-0106: the check's vendor axis — a profile NAME in the builtin vendor's list runs the
  // handshake under that profile's env (vendor undefined); another vendor's card probes its OWN
  // zero-token handshake with no env.
  const test = (key: string, vendor?: string): void => {
    setChecks((c) => ({ ...c, [key]: { verifying: true, status: c[key]?.status } }));
    settings
      .checkProvider(vendor === undefined && key !== DEFAULT_PROFILE ? key : undefined, vendor)
      .then((status) => setChecks((c) => ({ ...c, [key]: { verifying: false, status } })))
      .catch(() => setChecks((c) => ({ ...c, [key]: { verifying: false } })));
  };

  // The draft's validity — computed live, SHOWN only after a submit attempt (then persistent while
  // invalid, clearing the moment the operator fixes it).
  const parsed = parseEnvText(envDraft);
  const candidate: BackendProfile = { name: nameDraft.trim(), env: parsed.env };
  const nextList = editing === null
    ? [...profiles, candidate]
    : profiles.map((p, i) => (i === editing ? candidate : p));
  const nameIssue = validateProfiles(nextList).find((i) => i.index === (editing ?? profiles.length) && i.field === 'name');
  const envIssue = parsed.issues[0];
  const nameErr = submitted && nameIssue && nameIssue.field === 'name' ? UI.profileNameErr(nameIssue.code) : null;
  const envErr = submitted && envIssue ? UI.profileEnvErr(envIssue.line, envIssue.code, envIssue.key) : null;

  const resetForm = (): void => {
    setEditing(null);
    setNameDraft('');
    setEnvDraft('');
    setSubmitted(false);
  };

  const write = async (next: BackendProfile[]): Promise<boolean> => {
    try {
      await settings.setBackendProfiles(next);
      await reread();
      toast.push({ kind: 'confirm', title: UI.toastProfilesSaved });
      return true;
    } catch {
      toast.push({ kind: 'error', title: UI.saveFailed });
      return false;
    }
  };

  const submit = async (): Promise<void> => {
    setSubmitted(true);
    if (nameIssue) {
      nameRef.current?.focus();
      return;
    }
    if (envIssue) {
      envRef.current?.focus();
      return;
    }
    const base = profilesRef.current;
    const next = editing === null ? [...base, candidate] : base.map((p, i) => (i === editing ? candidate : p));
    if (await write(next)) resetForm();
  };

  const startEdit = (i: number): void => {
    const p = profiles[i];
    if (!p) return;
    setEditing(i);
    setNameDraft(p.name);
    setEnvDraft(profileEnvText(p.env));
    setSubmitted(false);
    requestAnimationFrame(() => nameRef.current?.focus());
  };

  const remove = (i: number): void => {
    const next = profilesRef.current.filter((_, j) => j !== i);
    void write(next).then((ok) => {
      if (ok && editing !== null) resetForm();
    });
  };

  const statusLine = (key: string) => {
    const c = checks[key];
    if (!c) return null;
    if (c.verifying) return <Spinner />;
    if (!c.status) return null;
    return c.status.ok ? (
      <span className="text-[12px] font-medium text-proceed">{UI.providerStatusOk}</span>
    ) : (
      // the verbatim reason rides the tooltip (WO-0078: adapter diagnostics never render raw)
      <span className="text-[12px] font-medium text-error" title={c.status.message}>{UI.providerStatusMissing}</span>
    );
  };

  const card = (key: string, name: string, body: ReactNode, actions: ReactNode, vendor?: string) => (
    <div key={key} data-profile-card={key} className="flex flex-col gap-1 rounded-lg border border-hairline px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-medium text-ink">{name}</span>
        {statusLine(key)}
        <span className="ml-auto flex items-center gap-3">
          <button type="button" data-profile-test={key} onClick={() => test(key, vendor)} className="alink text-[12px]">
            {UI.profileTest}
          </button>
          {actions}
        </span>
      </div>
      {body}
    </div>
  );

  const wired = vendors.filter((v) => v.wired);
  const pending = vendors.filter((v) => !v.wired);
  const detectionLine = (v: VendorInfo): ReactNode =>
    v.path !== null ? (
      <span data-vendor-path={v.id} className="truncate font-mono text-[10.5px] text-inkdim">{UI.vendorFoundLine(v.path)}</span>
    ) : (
      <span className="text-[11px] text-inkdim">{UI.vendorMissingLine}</span>
    );

  return (
    <section data-profiles-section="" className="flex flex-col gap-2.5">
      <h2 className="text-[13px] font-semibold tracking-tight text-ink">{UI.settingsTabProfiles}</h2>
      <div data-profile-list="" className="flex flex-col gap-2.5">
        {wired.map((v) => (
          <div key={v.id} data-vendor-group={v.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <h3 className="shrink-0 text-[12.5px] font-semibold tracking-tight text-ink">{v.name}</h3>
              <span className="min-w-0 truncate">{detectionLine(v)}</span>
            </div>
            <div className="flex flex-col gap-2">
              {card(
                v.builtin ? DEFAULT_PROFILE : `${v.id}·${DEFAULT_PROFILE}`,
                UI.profileDefaultName,
                <span className="text-[11px] text-inkdim">{UI.profileInheritLine}</span>,
                null,
                v.builtin ? undefined : v.id,
              )}
              {v.builtin
                ? profiles.map((p, i) =>
                    card(
                      p.name,
                      p.name,
                      Object.keys(p.env).length > 0 ? (
                        <pre data-profile-env="" className="whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed text-inkdim">
                          {profileEnvText(p.env)}
                        </pre>
                      ) : (
                        <span className="text-[11px] text-inkdim">{UI.profileInheritLine}</span>
                      ),
                      <>
                        <button type="button" data-profile-edit={p.name} onClick={() => startEdit(i)} className="alink text-[12px]">
                          {UI.profileEdit}
                        </button>
                        <button type="button" data-profile-remove={p.name} onClick={() => remove(i)} className="alink text-[12px]">
                          {UI.profileRemove}
                        </button>
                      </>,
                    ),
                  )
                : null}
            </div>

            {v.builtin ? (
              <div data-profile-form={editing === null ? 'new' : 'edit'} className="mt-1 flex flex-col gap-3 border-t border-hairline pt-3">
                <h3 className="text-[12.5px] font-semibold tracking-tight text-ink">{editing === null ? UI.profileAddTitle : UI.profileEditTitle}</h3>
                <Field label={UI.profileNameLabel} error={nameErr}>
                  <Input
                    ref={nameRef}
                    data-profile-name=""
                    aria-required="true"
                    aria-invalid={nameErr ? 'true' : undefined}
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                  />
                </Field>
                <Field label={UI.profileEnvLabel} error={envErr}>
                  <Textarea
                    ref={envRef}
                    data-profile-env-input=""
                    rows={3}
                    aria-invalid={envErr ? 'true' : undefined}
                    placeholder={UI.profileEnvPlaceholder}
                    className="font-mono text-[11.5px]"
                    value={envDraft}
                    onChange={(e) => setEnvDraft(e.target.value)}
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <Button variant="primary" size="sm" data-profile-submit="" onClick={() => void submit()}>
                    {editing === null ? UI.profileAdd : UI.profileSave}
                  </Button>
                  {editing !== null ? (
                    <Button variant="ghost" size="sm" onClick={resetForm}>
                      {UI.cancel}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ))}

        {pending.length > 0 ? (
          <div data-vendor-pending="" className="mt-1 flex flex-col gap-1 border-t border-hairline pt-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.vendorPendingGroup}</h3>
            {pending.map((v) => (
              <div key={v.id} data-vendor-pending-row={v.id} className="flex flex-wrap items-baseline gap-2 py-0.5">
                <span className="text-[12.5px] text-inkdim">{v.name}</span>
                <span className="text-[11px] text-inkdim">· {UI.vendorPendingReason}</span>
                {v.path !== null ? (
                  <span className="min-w-0 truncate font-mono text-[10.5px] text-inkdim">{UI.vendorFoundLine(v.path)}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
