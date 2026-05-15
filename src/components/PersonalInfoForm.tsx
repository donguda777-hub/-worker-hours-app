import { useMemo, useState } from "react";
import type { PersonalInfo, SkillLevel } from "../types";
import { SKILL_LEVELS } from "../constants";
import { buildUserId } from "../utils/userId";

const ID_HINT =
  "아이디는 이름 + 전화번호 뒤 4자리입니다. 예: 홍길동5678";

type Props = {
  initial: PersonalInfo | null;
  title?: string;
  onSave: (info: PersonalInfo) => void;
  onCancel?: () => void;
};

export function PersonalInfoForm({
  initial,
  title = "\uACF5\uC218\uAD00\uB9AC \uC571",
  onSave,
  onCancel,
}: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [skillLevel, setSkillLevel] = useState<SkillLevel>(
    initial?.skillLevel ?? "초보"
  );
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(initial);

  const canSubmit = useMemo(() => {
    return (
      name.trim().length > 0 && phone.replace(/\D/g, "").length >= 4
    );
  }, [name, phone]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      setError("이름, 전화번호(숫자 4자리 이상)를 입력해 주세요.");
      return;
    }
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 4) {
      setError("전화번호는 숫자 4자리 이상 입력해 주세요.");
      return;
    }
    setError(null);
    const userId = isEdit
      ? buildUserId(name, phone)
      : buildUserId(name, phone);
    onSave({
      name: name.trim(),
      phone: phone.trim(),
      companyName: initial?.companyName,
      skillLevel,
      userId,
    });
  }

  return (
    <div className="mx-auto flex min-h-full max-w-mobile flex-col bg-white px-4 pb-8 pt-6 shadow-sm">
      <h1 className="text-xl font-bold text-slate-800">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">
        현장에서 사용할 기본 정보를 입력합니다.
      </p>

      <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
        <span className="font-medium">기존 정보 안내: </span>
        {ID_HINT}
      </div>

      <form className="mt-6 flex flex-1 flex-col gap-5" onSubmit={handleSubmit}>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">이름</span>
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-3 text-base outline-none ring-teal-500 focus:border-teal-500 focus:ring-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            autoComplete="name"
            enterKeyHint="next"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">
            {"\uC804\uD654\uBC88\uB638"}
          </span>
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-3 text-base outline-none ring-teal-500 focus:border-teal-500 focus:ring-2"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="010-1234-5678"
            inputMode="tel"
            autoComplete="tel"
            enterKeyHint="next"
          />
        </label>

        <fieldset>
          <legend className="text-sm font-medium text-slate-700">
            {"\uC219\uC5F0\uB3C4"}
          </legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {SKILL_LEVELS.map((lv) => (
              <label
                key={lv}
                className={`flex cursor-pointer items-center justify-center rounded-lg border px-2 py-3 text-center text-sm font-medium transition ${
                  skillLevel === lv
                    ? "border-teal-600 bg-teal-50 text-teal-900"
                    : "border-slate-200 bg-white text-slate-700 active:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name="skill"
                  className="sr-only"
                  checked={skillLevel === lv}
                  onChange={() => setSkillLevel(lv)}
                />
                {lv}
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-4">
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-xl bg-teal-600 py-3.5 text-base font-semibold text-white shadow-sm disabled:opacity-40"
          >
            저장
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="w-full rounded-xl border border-slate-200 py-3 text-base font-medium text-slate-700"
            >
              취소
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
