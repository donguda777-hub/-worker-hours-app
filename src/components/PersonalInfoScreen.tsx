import { useEffect, useMemo, useRef, useState } from "react";
import { SKILL_LEVELS, type SkillLevel } from "../constants";
import {
  loadPersonalInfo,
  savePersonalInfo,
  upsertWorkerProfileToSupabase,
} from "../storage";
import type { PersonalInfo } from "../types";
import { UI } from "../uiStrings";
import { buildUserId } from "../utils/userId";

const defaultSkill: SkillLevel = SKILL_LEVELS[0];

/** 기본 선택 업체(저장값은 companyName 문자열 그대로) */
const PRESET_COMPANY_NAMES = [
  "L&N",
  "\uBBFC\uC601",
  "L-LINE",
  "\uAC1C\uC778\uC0AC\uC5C5\uC790",
] as const;

type PresetCompanyName = (typeof PRESET_COMPANY_NAMES)[number];

const COMPANY_OPTIONS: ReadonlyArray<
  | { type: "preset"; label: PresetCompanyName }
  | { type: "custom"; label: "\uC9C1\uC811 \uC785\uB825" }
> = [
  ...PRESET_COMPANY_NAMES.map((label) => ({
    type: "preset" as const,
    label,
  })),
  { type: "custom" as const, label: "\uC9C1\uC811 \uC785\uB825" },
];

type CompanyMode = "unset" | PresetCompanyName | "custom";

function isPresetCompanyName(value: string): value is PresetCompanyName {
  return (PRESET_COMPANY_NAMES as readonly string[]).includes(value);
}

type PersonalInfoScreenProps = {
  onSaved?: () => void;
};

export default function PersonalInfoScreen({
  onSaved,
}: PersonalInfoScreenProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [companyMode, setCompanyMode] = useState<CompanyMode>("unset");
  const [companyCustom, setCompanyCustom] = useState("");
  const [companyCustomEditing, setCompanyCustomEditing] = useState(false);
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const companyInputRef = useRef<HTMLInputElement>(null);
  const [region, setRegion] = useState("");
  const [skillLevel, setSkillLevel] = useState<SkillLevel>(defaultSkill);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  useEffect(() => {
    const existing = loadPersonalInfo();
    if (!existing) return;
    setName(existing.name);
    setPhone(existing.phone);
    const cn = existing.companyName?.trim();
    if (!cn || cn === "L&N") {
      setCompanyMode("L&N");
      setCompanyCustom("");
      setCompanyCustomEditing(false);
    } else if (isPresetCompanyName(cn)) {
      setCompanyMode(cn);
      setCompanyCustom("");
      setCompanyCustomEditing(false);
    } else {
      setCompanyMode("custom");
      setCompanyCustom(cn);
      setCompanyCustomEditing(false);
    }
    setRegion(existing.region?.trim() ?? "");
    if ((SKILL_LEVELS as readonly string[]).includes(existing.skillLevel)) {
      setSkillLevel(existing.skillLevel as SkillLevel);
    }
  }, []);

  useEffect(() => {
    if (!companyPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCompanyPickerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [companyPickerOpen]);

  useEffect(() => {
    if (!companyCustomEditing) return;
    const el = companyInputRef.current;
    if (!el) return;
    el.focus();
  }, [companyCustomEditing]);

  const autoUserId = useMemo(() => buildUserId(name, phone), [name, phone]);

  const companyTriggerLabel = useMemo(() => {
    if (companyMode === "custom") {
      const t = companyCustom.trim();
      return t.length > 0 ? t : "\uC9C1\uC811 \uC785\uB825";
    }
    if (companyMode !== "unset") return companyMode;
    return "\uC120\uD0DD";
  }, [companyMode, companyCustom]);

  const showUserIdPreview =
    name.trim().length > 0 && phone.replace(/\D/g, "").length > 0;

  function handleCompanyInlineBlur() {
    setCompanyCustomEditing(false);
  }

  function handleCompanyInlineKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>
  ) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  }

  function handleSave() {
    console.log("[workers save] button clicked");
    setSaveError(null);
    setSavedOk(false);

    const n = name.trim();
    const digits = phone.replace(/\D/g, "");

    if (!n) {
      setSaveError(UI.errName);
      return;
    }
    if (digits.length < 4) {
      setSaveError(
        "\uC804\uD654\uBC88\uD638\uC5D0 \uC22B\uC790 4\uC790\uB9AC \uC774\uC0C1\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694."
      );
      return;
    }
    if (companyMode === "unset") {
      setSaveError(
        "\uC5C5\uCCB4\uB97C \uC120\uD0DD\uD574 \uC8FC\uC138\uC694."
      );
      return;
    }
    const companyName =
      companyMode === "custom" ? companyCustom.trim() : companyMode;
    if (companyMode === "custom" && !companyName) {
      setSaveError(
        "\uC5C5\uCCB4\uBA85\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694."
      );
      return;
    }
    if (companyMode === "custom" && companyCustomEditing) {
      setCompanyCustomEditing(false);
    }

    const regionTrimmed = region.trim();
    const payload: PersonalInfo = {
      name: n,
      phone,
      companyName,
      ...(regionTrimmed !== "" ? { region: regionTrimmed } : {}),
      skillLevel,
      userId: buildUserId(n, phone),
    };

    savePersonalInfo(payload);
    setSavedOk(true);
    onSaved?.();
    console.log("[workers save] calling upsertWorkerProfileToSupabase");
    void upsertWorkerProfileToSupabase(payload);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-100 px-2 py-2">
      <div className="mx-auto flex w-full min-h-0 flex-1 flex-col items-stretch">
        <header className="mb-2 w-full shrink-0 text-center">
          <div className="flex justify-center pb-1 pt-0.5">
            <img
              src="/ln-logo-transparent.png"
              alt="L&N"
              width={180}
              height={92}
              className="h-auto w-[180px] max-w-full object-contain"
            />
          </div>
          <h1 className="mt-1 text-base font-semibold leading-tight text-slate-900">
            {"\uACF5\uC218\uAD00\uB9AC \uC571"}
          </h1>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
            {UI.subtitle}
          </p>
          <p className="mt-1.5 px-1 text-center text-[10px] leading-snug">
            <span className="font-semibold text-red-600">
              {"\uC77C\uBC18 \uACF5\uC218\uC5B4\uD50C\uCC98\uB7FC \uC0AC\uC6A9\uD558\uC9C0 \uB9C8\uC138\uC694"}
            </span>{" "}
            <span className="text-slate-900">
              {"L&N\uC804\uC6A9\uC785\uB2C8\uB2E4"}
            </span>
          </p>
        </header>

        <div className="w-full min-h-0 shrink-0 rounded-xl bg-white p-3 shadow-md ring-1 ring-slate-200/80">
          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">
                {UI.name}
              </span>
              <input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-sm text-slate-900 outline-none ring-teal-500/0 transition focus:border-teal-500 focus:bg-white focus:ring-2"
                placeholder={UI.placeholderName}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">
                {"\uC804\uD654\uBC88\uD638"}
              </span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-sm text-slate-900 outline-none ring-teal-500/0 transition focus:border-teal-500 focus:bg-white focus:ring-2"
                placeholder="010-1234-5678"
              />
            </label>

            <div className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">
                {"\uC5C5\uCCB4\uBA85"}
              </span>
              {companyMode === "custom" && companyCustomEditing ? (
                <input
                  ref={companyInputRef}
                  type="text"
                  autoComplete="organization"
                  value={companyCustom}
                  onChange={(e) => setCompanyCustom(e.target.value)}
                  onBlur={handleCompanyInlineBlur}
                  onKeyDown={handleCompanyInlineKeyDown}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-left text-sm font-medium text-slate-900 outline-none ring-teal-500/0 transition focus:border-teal-500 focus:bg-white focus:ring-2"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setCompanyPickerOpen(true)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-left text-sm font-medium text-slate-900 outline-none ring-teal-500/0 transition focus:border-teal-500 focus:bg-white focus:ring-2"
                >
                  {companyTriggerLabel}
                </button>
              )}
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">
                {UI.region}
              </span>
              <input
                type="text"
                autoComplete="address-level2"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-sm text-slate-900 outline-none ring-teal-500/0 transition focus:border-teal-500 focus:bg-white focus:ring-2"
                placeholder={UI.region}
              />
            </label>

            <fieldset>
              <legend className="mb-1 block text-xs font-medium text-slate-700">
                {"\uC219\uB828\uB3C4"}
              </legend>
              <div className="grid grid-cols-2 gap-1.5">
                {SKILL_LEVELS.map((level) => {
                  const selected = skillLevel === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setSkillLevel(level)}
                      className={`min-h-8 rounded-lg border px-2 py-1 text-xs font-medium leading-tight transition ${
                        selected
                          ? "border-teal-600 bg-teal-50 text-teal-900 ring-1 ring-teal-500/30"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      {level}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>

          {saveError && (
            <p className="mt-2 text-xs leading-snug text-red-600" role="alert">
              {saveError}
            </p>
          )}
          {savedOk && !saveError && (
            <p className="mt-2 text-xs leading-snug text-teal-700" role="status">
              {UI.savedOk}
            </p>
          )}

          <button
            type="button"
            onClick={handleSave}
            className="mt-3 w-full min-h-[2.75rem] rounded-lg bg-teal-600 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 active:bg-teal-800"
          >
            {UI.save}
          </button>
        </div>

        <div className="mt-2 w-full shrink-0 px-0.5 pb-1 text-center">
          <p className="text-[10px] leading-snug text-slate-500">
            {
              "\uC544\uC774\uB514\uB294 \uC774\uB984 + \uC804\uD654\uBC88\uD638 \uB4A4 4\uC790\uB9AC\uC785\uB2C8\uB2E4."
            }
          </p>
          <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
            {UI.idLine2}
          </p>
          {showUserIdPreview && (
            <p className="mt-1 break-all text-[10px] text-slate-600">
              {UI.autoIdLabel}:{" "}
              <span className="font-mono text-slate-800">{autoUserId}</span>
            </p>
          )}
        </div>
      </div>

      {companyPickerOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-3"
          role="presentation"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50"
            aria-label="close"
            onClick={() => setCompanyPickerOpen(false)}
          />
          <div
            className="relative z-10 w-full max-w-mobile rounded-t-2xl border border-slate-200 bg-white pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] shadow-xl sm:max-h-[min(80vh,28rem)] sm:rounded-2xl sm:pb-0"
            role="dialog"
            aria-modal="true"
            aria-labelledby="company-picker-title"
          >
            <div className="border-b border-slate-100 px-3 py-2.5 text-center">
              <p
                id="company-picker-title"
                className="text-sm font-semibold text-slate-900"
              >
                {"\uC5C5\uCCB4 \uC120\uD0DD"}
              </p>
            </div>
            <ul className="max-h-[min(50vh,16rem)] overflow-y-auto py-1 sm:max-h-72">
              {COMPANY_OPTIONS.map((opt) => {
                const active =
                  opt.type === "custom"
                    ? companyMode === "custom"
                    : companyMode === opt.label;
                const optionKey =
                  opt.type === "custom" ? "custom" : opt.label;
                return (
                  <li key={optionKey}>
                    <button
                      type="button"
                      onClick={() => {
                        if (opt.type === "preset") {
                          setCompanyMode(opt.label);
                          setCompanyCustom("");
                          setCompanyCustomEditing(false);
                        } else {
                          setCompanyMode("custom");
                          setCompanyCustom("");
                          setCompanyCustomEditing(true);
                        }
                        setCompanyPickerOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm transition active:bg-slate-50 ${
                        active
                          ? "bg-teal-50 font-semibold text-teal-900"
                          : "text-slate-800"
                      }`}
                    >
                      <span>{opt.label}</span>
                      {active ? (
                        <span className="text-xs text-teal-600" aria-hidden>
                          {"\u2713"}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  );
}
