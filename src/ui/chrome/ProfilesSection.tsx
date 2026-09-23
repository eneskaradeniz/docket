// ProfilesSection — WO-0098: the settings' «Sürücüler» section (backend profiles). One card per
// backend: the built-in passthrough FIRST (always present, never stored, never editable), then the
// operator's named profiles in their order. Each card carries its name, its non-secret env (mono,
// verbatim — the operator's own lines), a per-profile «Test et» (the zero-token handshake under
// THAT profile's environment, resolved main-side) and, for a named profile, Düzenle / Sil. The
// add/edit form sits under the list: Ad + Ortam (KEY=value lines, parsed by core's codec); errors
// sit under their field (persistent while invalid, the first invalid focused on submit), a save
// failure toasts. A secret-looking pair is refused BEFORE the write by the same core rule the
// store enforces — the credential stays in the operator's shell / CLI login.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppSettings, ProviderStatus } from '../../core/app-settings';
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
  }, [settings]);

  const test = (key: string): void => {
    setChecks((c) => ({ ...c, [key]: { verifying: true, status: c[key]?.status } }));
    settings
      .checkProvider(key === DEFAULT_PROFILE ? undefined : key)
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

  const card = (key: string, name: string, body: ReactNode, actions: ReactNode) => (
    <div key={key} data-profile-card={key} className="flex flex-col gap-1 rounded-lg border border-hairline px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-medium text-ink">{name}</span>
        {statusLine(key)}
        <span className="ml-auto flex items-center gap-3">
          <button type="button" data-profile-test={key} onClick={() => test(key)} className="alink text-[12px]">
            {UI.profileTest}
          </button>
          {actions}
        </span>
      </div>
      {body}
    </div>
  );

  return (
    <section data-profiles-section="" className="flex flex-col gap-2.5">
      <h2 className="text-[13px] font-semibold tracking-tight text-ink">{UI.settingsTabProfiles}</h2>
      <div data-profile-list="" className="flex flex-col gap-2">
        {card(
          DEFAULT_PROFILE,
          UI.profileDefaultName,
          <span className="text-[11px] text-inkdim">{UI.profileInheritLine}</span>,
          null,
        )}
        {profiles.map((p, i) =>
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
        )}
      </div>

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
    </section>
  );
}
