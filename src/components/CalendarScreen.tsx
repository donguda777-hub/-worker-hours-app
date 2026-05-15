import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  deleteWorkerDayEntry,
  loadPersonalInfo,
  loadWorkerDayEntries,
  saveWorkerDayEntries,
  uploadWorkerDayEntryToSupabase,
  upsertWorkerDayEntry,
  type WorkerDayEntry,
} from "../storage";
import {
  ensureWorkerProjectInSupabase,
  fetchActiveProjectsForWorker,
  normalizeProjectName,
  type ActiveProjectOption,
} from "../lib/projectsFromSupabase";
import { getMonthGrid, parseISODate, toISODate } from "../utils/date";

const HOUR_OPTIONS = [0.25, 0.5, 1, 2] as const;
type HourOption = (typeof HOUR_OPTIONS)[number];

type ModalStep = "projectList" | "projectInput" | "hours";

const LABEL_DIRECT_INPUT = "\uC9C1\uC811 \uC785\uB825";

function normalizeHour(v: number): HourOption | null {
  for (const h of HOUR_OPTIONS) {
    if (Math.abs(h - v) < 1e-9) return h;
  }
  return null;
}

function formatModalDateLabel(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getFullYear()}\uB144 ${d.getMonth() + 1}\uC6D4 ${d.getDate()}\uC77C`;
}

function formatManDaySuffix(n: number): string {
  return `${n}\uACF5\uC218`;
}

function formatMonthTotal(n: number): string {
  return String(Number.parseFloat(n.toFixed(2)));
}

/** ISO date head YYYY-M-D or YYYY-MM-DD; compares to calendar month (month0 = 0..11). */
function dateEntryBelongsToCalendarMonth(
  dateStr: string,
  year: number,
  month0: number
): boolean {
  const head = String(dateStr).trim().split("T")[0];
  const parts = head.split("-");
  if (parts.length < 3) return false;
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return false;
  return y === year && mo === month0 + 1;
}

function toManDayNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

type Props = {
  onEditProfile: () => void;
};

type BeforeInstallPromptEventExt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  if (window.matchMedia("(display-mode: window-controls-overlay)").matches)
    return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

const WEEKDAYS = [
  "\uC77C",
  "\uC6D4",
  "\uD654",
  "\uC218",
  "\uBAA9",
  "\uAE08",
  "\uD638",
] as const;

/** month 1-12, day ? fixed solar holidays only (no lunar / substitute days) */
const FIXED_SOLAR_HOLIDAYS: ReadonlyArray<[month: number, day: number]> = [
  [1, 1],
  [3, 1],
  [5, 5],
  [6, 6],
  [8, 15],
  [10, 3],
  [10, 9],
  [12, 25],
];

function isFixedSolarHoliday(month0: number, day: number): boolean {
  const m = month0 + 1;
  return FIXED_SOLAR_HOLIDAYS.some(([hm, hd]) => hm === m && hd === day);
}

function monthTitle(year: number, month0: number): string {
  return `${year}\uB144 ${month0 + 1}\uC6D4`;
}

type DayCellStyles = { shell: string; dayNum: string };

function dayCellStyles(
  date: Date,
  inMonth: boolean,
  selected: boolean,
  hasSavedEntry: boolean
): DayCellStyles {
  let shell: string;
  let dayNum: string;

  if (selected) {
    shell =
      "border-teal-600 bg-teal-50 ring-1 ring-teal-500/50 shadow-sm";
    dayNum = "text-teal-950";
  } else {
    const dow = date.getDay();
    const m0 = date.getMonth();
    const d = date.getDate();
    const sun = dow === 0;
    const sat = dow === 6;
    const hol = isFixedSolarHoliday(m0, d);

    if (!inMonth) {
      if (sun) {
        shell = "border-transparent bg-rose-50/80 shadow-none";
        dayNum = "text-rose-900/85";
      } else if (hol) {
        shell = "border-transparent bg-amber-50/80 shadow-none";
        dayNum = "text-amber-950/85";
      } else if (sat) {
        shell = "border-transparent bg-sky-50/80 shadow-none";
        dayNum = "text-sky-950/85";
      } else {
        shell = "border-transparent bg-slate-50 shadow-none";
        dayNum = "text-slate-500";
      }
    } else if (sun && hol) {
      shell = "border-transparent bg-rose-100 shadow-sm";
      dayNum = "text-rose-950";
    } else if (sun) {
      shell = "border-transparent bg-rose-50 shadow-sm";
      dayNum = "text-rose-900";
    } else if (hol) {
      shell = "border-transparent bg-amber-50 shadow-sm";
      dayNum = "text-amber-950";
    } else if (sat) {
      shell = "border-transparent bg-sky-50 shadow-sm";
      dayNum = "text-sky-950";
    } else {
      shell = "border-transparent bg-white shadow-sm";
      dayNum = "text-slate-800";
    }
  }

  if (hasSavedEntry && !selected) {
    shell = `${shell} bg-teal-50/30 ring-1 ring-teal-400/40`;
  }

  return { shell, dayNum };
}

export default function CalendarScreen({ onEditProfile }: Props) {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => ({
    y: today.getFullYear(),
    m0: today.getMonth(),
  }));
  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  const [modalIso, setModalIso] = useState<string | null>(null);
  const [modalStep, setModalStep] = useState<ModalStep>("projectList");
  const [customProjectName, setCustomProjectName] = useState("");
  const [modalProjectName, setModalProjectName] = useState("");
  const [selectedHour, setSelectedHour] = useState<HourOption | null>(null);
  const [saveInProgress, setSaveInProgress] = useState(false);
  const [activeProjects, setActiveProjects] = useState<ActiveProjectOption[]>(
    []
  );
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showPwaPromo, setShowPwaPromo] = useState(() => !isStandalonePwa());
  const deferredPromptRef = useRef<BeforeInstallPromptEventExt | null>(null);
  const [dayEntries, setDayEntries] = useState<WorkerDayEntry[]>(() =>
    loadWorkerDayEntries()
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setProjectsLoading(true);
      const list = await fetchActiveProjectsForWorker();
      if (!cancelled) {
        setActiveProjects(list);
        setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isStandalonePwa()) {
      setShowPwaPromo(false);
      return;
    }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEventExt;
    };

    const onAppInstalled = () => {
      deferredPromptRef.current = null;
      setShowPwaPromo(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const handleInstallClick = useCallback(async () => {
    const deferred = deferredPromptRef.current;
    if (deferred) {
      try {
        await deferred.prompt();
        await deferred.userChoice;
      } finally {
        deferredPromptRef.current = null;
      }
      return;
    }
    window.alert(
      '\uBE0C\uB77C\uC6B0\uC800 \uBA54\uB274(\u22EE)\uC5D0\uC11C "\uD648 \uD654\uBA74\uC5D0 \uCD94\uAC00"\uB97C \uC120\uD0DD\uD574\uC8FC\uC138\uC694.'
    );
  }, []);

  const entriesByIso = useMemo(() => {
    const m: Record<string, WorkerDayEntry> = {};
    for (const e of dayEntries) m[e.date] = e;
    return m;
  }, [dayEntries]);

  const monthManDayTotal = useMemo(() => {
    const year = Number(cursor.y);
    const month0 = Number(cursor.m0);
    if (!Number.isFinite(year) || !Number.isFinite(month0)) return 0;
    return dayEntries.reduce((sum, e) => {
      if (!dateEntryBelongsToCalendarMonth(e.date, year, month0)) return sum;
      return sum + toManDayNumber(e.manDay);
    }, 0);
  }, [dayEntries, cursor.y, cursor.m0]);

  const cells = useMemo(
    () => getMonthGrid(cursor.y, cursor.m0),
    [cursor.y, cursor.m0]
  );

  const reloadActiveProjects = useCallback(async () => {
    const list = await fetchActiveProjectsForWorker();
    setActiveProjects(list);
  }, []);

  function closeProjectModal() {
    setModalIso(null);
    setModalStep("projectList");
    setCustomProjectName("");
    setModalProjectName("");
    setSelectedHour(null);
    setSaveInProgress(false);
  }

  function openProjectModal(iso: string) {
    const y = Number(cursor.y);
    const m0 = Number(cursor.m0);
    if (!dateEntryBelongsToCalendarMonth(iso, y, m0)) return;
    setSelectedIso(iso);
    setCustomProjectName("");
    setModalProjectName("");
    setSelectedHour(null);
    const existing = entriesByIso[iso];
    if (existing) {
      const match = activeProjects.find(
        (p) => p.project_name === existing.project
      );
      if (match) {
        setModalProjectName(match.project_name);
        setSelectedHour(normalizeHour(existing.manDay));
        setModalStep("hours");
      } else {
        setCustomProjectName(existing.project);
        setModalStep("projectList");
      }
    } else {
      setModalStep("projectList");
    }
    setModalIso(iso);
  }

  function goToDirectInputStep() {
    if (!modalIso) return;
    const existing = entriesByIso[modalIso];
    setCustomProjectName(existing?.project ?? "");
    setModalStep("projectInput");
  }

  function backToProjectListStep() {
    setModalStep("projectList");
    setCustomProjectName("");
  }

  function selectProjectFromList(projectName: string) {
    if (!modalIso) return;
    setModalProjectName(projectName);
    const existing = entriesByIso[modalIso];
    if (existing && existing.project === projectName) {
      setSelectedHour(normalizeHour(existing.manDay));
    } else {
      setSelectedHour(null);
    }
    setModalStep("hours");
  }

  function goToHoursStepFromInput() {
    if (!modalIso) return;
    const name = normalizeProjectName(customProjectName);
    if (!name) return;
    setModalProjectName(name);
    const existing = entriesByIso[modalIso];
    if (existing && existing.project === name) {
      setSelectedHour(normalizeHour(existing.manDay));
    } else {
      setSelectedHour(null);
    }
    setModalStep("hours");
  }

  function backToProjectListFromHours() {
    setModalStep("projectList");
    setSelectedHour(null);
  }

  async function saveHoursEntry() {
    if (!modalIso || selectedHour === null || saveInProgress) return;
    const y = Number(cursor.y);
    const m0 = Number(cursor.m0);
    if (!dateEntryBelongsToCalendarMonth(modalIso, y, m0)) {
      closeProjectModal();
      return;
    }
    const profile = loadPersonalInfo();
    if (profile == null) {
      window.alert(
        "\uAC1C\uC778\uC815\uBCF4\uB97C \uBA3C \uC785\uB825\uD574 \uC8FC\uC138\uC694."
      );
      return;
    }
    const workerId = profile.userId.trim();
    if (!workerId) {
      window.alert("\uC0AC\uBC88\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
      return;
    }

    setSaveInProgress(true);
    try {
      const ensured = await ensureWorkerProjectInSupabase(
        modalProjectName,
        workerId
      );
      if (ensured == null) {
        window.alert(
          "\uD504\uB85C\uC81D\uD2B8 \uB4F1\uB85D\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uB124\uD2B8\uC6CC\uD06C\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694."
        );
        return;
      }
      const entry: WorkerDayEntry = {
        date: modalIso,
        project: ensured.project_name,
        manDay: selectedHour,
      };
      const next = upsertWorkerDayEntry(dayEntries, entry);
      saveWorkerDayEntries(next);
      setDayEntries(loadWorkerDayEntries());
      await uploadWorkerDayEntryToSupabase(entry);
      if (ensured.created) {
        await reloadActiveProjects();
      }
      closeProjectModal();
    } finally {
      setSaveInProgress(false);
    }
  }

  const nextFromInputDisabled =
    normalizeProjectName(customProjectName) === "";

  function deleteDayEntry() {
    if (!modalIso) return;
    const y = Number(cursor.y);
    const m0 = Number(cursor.m0);
    if (!dateEntryBelongsToCalendarMonth(modalIso, y, m0)) {
      closeProjectModal();
      return;
    }
    const next = deleteWorkerDayEntry(dayEntries, modalIso);
    saveWorkerDayEntries(next);
    setDayEntries(loadWorkerDayEntries());
    closeProjectModal();
  }

  const saveHoursDisabled = selectedHour === null || saveInProgress;

  function goPrevMonth() {
    closeProjectModal();
    setSelectedIso(null);
    setCursor((c) =>
      c.m0 === 0 ? { y: c.y - 1, m0: 11 } : { y: c.y, m0: c.m0 - 1 }
    );
  }

  function goNextMonth() {
    closeProjectModal();
    setSelectedIso(null);
    setCursor((c) =>
      c.m0 === 11 ? { y: c.y + 1, m0: 0 } : { y: c.y, m0: c.m0 + 1 }
    );
  }

  useLayoutEffect(() => {
    if (!modalIso) {
      setSheetOpen(false);
      return;
    }
    setSheetOpen(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setSheetOpen(true));
    });
    return () => cancelAnimationFrame(id);
  }, [modalIso]);

  useEffect(() => {
    if (!modalIso) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [modalIso]);

  const modalSavedEntry =
    modalIso !== null ? entriesByIso[modalIso] : undefined;

  return (
    <div className="flex h-full min-h-[100dvh] flex-1 flex-col overflow-hidden bg-slate-100">
      <div className="shrink-0 border-b border-slate-200/80 bg-slate-100 px-1 pb-2 pt-[max(1.25rem,env(safe-area-inset-top,0px))]">
        <div className="flex justify-center pb-1.5 pt-0.5">
          <img
            src="/ln-logo-transparent.png"
            alt="L&N"
            width={180}
            height={92}
            className="h-auto w-[180px] max-w-full object-contain"
          />
        </div>
        <div className="mt-3 flex items-end justify-between gap-1">
          <button
            type="button"
            onClick={goPrevMonth}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-base font-semibold text-slate-700 shadow-sm active:bg-slate-100"
            aria-label="previous month"
          >
            &lt;
          </button>
          <h1 className="min-w-0 flex-1 px-0.5 pb-0.5 text-center text-sm font-semibold leading-tight text-slate-900">
            {monthTitle(cursor.y, cursor.m0)}
          </h1>
          <button
            type="button"
            onClick={goNextMonth}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-base font-semibold text-slate-700 shadow-sm active:bg-slate-100"
            aria-label="next month"
          >
            &gt;
          </button>
        </div>
      </div>

      <div className="flex h-[44px] shrink-0 items-center border-b border-slate-200/80 bg-slate-100 px-1">
        <button
          type="button"
          onClick={onEditProfile}
          className="h-10 w-full rounded-md border border-slate-300 bg-white text-xs font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 active:bg-slate-100"
        >
          {"\uAC1C\uC778\uC815\uBCF4 \uC218\uC815"}
        </button>
      </div>

      <div className="grid h-8 shrink-0 grid-cols-7 items-center gap-px border-b border-slate-200 bg-slate-100">
        {WEEKDAYS.map((d, i) => (
          <div
            key={d}
            className={`text-center text-[11px] font-bold leading-none ${
              i === 0
                ? "text-rose-700"
                : i === 6
                  ? "text-sky-700"
                  : "text-slate-500"
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-0.5 pt-px">
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[repeat(6,minmax(0,1fr))] gap-px">
          {cells.map(({ date, inMonth }) => {
            const y = date.getFullYear();
            const m0 = date.getMonth();
            const day = date.getDate();
            const iso = toISODate(y, m0, day);
            const entry = inMonth ? entriesByIso[iso] : undefined;
            const hasSavedEntry = Boolean(entry);
            const selected = inMonth && selectedIso === iso;
            const { shell, dayNum } = dayCellStyles(
              date,
              inMonth,
              selected,
              hasSavedEntry
            );
            return (
              <button
                key={iso}
                type="button"
                disabled={!inMonth}
                onClick={() => openProjectModal(iso)}
                className={`relative flex h-full min-h-0 w-full min-w-0 flex-col items-stretch rounded-md border-2 p-1 text-left transition ${
                  inMonth
                    ? `active:opacity-95${selected ? "" : " active:brightness-[0.98]"}`
                    : "cursor-not-allowed opacity-[0.48] saturate-[0.65]"
                } ${shell}`}
              >
                <span
                  className={`relative z-10 shrink-0 self-start text-xs font-bold leading-none ${dayNum}`}
                >
                  {day}
                </span>
                {entry ? (
                  <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-1 text-center leading-tight">
                    <span className="line-clamp-2 w-full text-[9px] font-semibold text-slate-700">
                      {entry.project}
                    </span>
                    <span className="text-[10px] font-bold leading-none text-teal-800">
                      {formatManDaySuffix(entry.manDay)}
                    </span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <footer className="shrink-0 border-t border-slate-200 bg-white shadow-[0_-4px_12px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-1.5 px-2 py-2">
          <p className="text-center text-sm font-bold leading-snug text-slate-900">
            {`\uCD1D \uACF5\uC218: ${formatMonthTotal(monthManDayTotal)}`}
          </p>
          {showPwaPromo ? (
            <>
              <p className="text-center text-[10px] leading-snug text-slate-500">
                {"\uD648 \uD654\uBA74\uC5D0 \uCD94\uAC00\uD558\uBA74 \uC571\uCC98\uB7FC \uC2E4\uD589\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."}
              </p>
              <button
                type="button"
                onClick={handleInstallClick}
                className="w-full rounded-lg border border-slate-300 bg-white py-2 text-center text-xs font-semibold text-slate-800 shadow-sm active:bg-slate-50"
              >
                {"\uD648\uD654\uBA74\uC5D0 \uCD94\uAC00\uD558\uAE30"}
              </button>
            </>
          ) : null}
        </div>
      </footer>

      {modalIso ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3"
          role="presentation"
        >
          <button
            type="button"
            className={`absolute inset-0 bg-slate-900/45 transition-opacity duration-200 ease-out ${
              sheetOpen ? "opacity-100" : "opacity-0"
            }`}
            aria-label="close overlay"
            onClick={closeProjectModal}
          />
          <div
            className={`relative z-10 w-full max-w-mobile transition-all duration-200 ease-out ${
              sheetOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-modal-title"
          >
            <div className="max-h-[min(85dvh,90svh)] overflow-y-auto rounded-2xl bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl ring-1 ring-slate-200/80">
              <h2
                id="sheet-modal-title"
                className="text-center text-lg font-bold text-slate-900"
              >
                {formatModalDateLabel(modalIso)}
              </h2>

              {modalStep === "projectList" ? (
                <>
                  <p className="mb-4 mt-1 text-center text-sm text-slate-500">
                    {"\uD504\uB85C\uC81D\uD2B8 \uC120\uD0DD"}
                  </p>

                  {projectsLoading ? (
                    <p className="py-6 text-center text-sm text-slate-500">
                      {"\uBAA9\uB85D\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4\u2026"}
                    </p>
                  ) : activeProjects.length === 0 ? (
                    <p className="whitespace-pre-line py-6 text-center text-sm leading-relaxed text-slate-500">
                      {
                        "\uB4F1\uB85D\uB41C \uD504\uB85C\uC81D\uD2B8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uC544\uB798 \uC9C1\uC811 \uC785\uB825\uC744 \uC0AC\uC6A9\uD558\uC138\uC694."
                      }
                    </p>
                  ) : (
                    <div className="flex max-h-[min(40dvh,50svh)] flex-col gap-2 overflow-y-auto">
                      {activeProjects.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => selectProjectFromList(p.project_name)}
                          className="min-h-[3.25rem] w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 text-left text-base font-semibold text-slate-900 transition active:scale-[0.99] active:bg-slate-100"
                        >
                          {p.project_name}
                        </button>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={goToDirectInputStep}
                    className="mt-4 min-h-[3.25rem] w-full rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 text-base font-semibold text-slate-800 transition active:scale-[0.99] active:bg-slate-50"
                  >
                    {LABEL_DIRECT_INPUT}
                  </button>

                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={closeProjectModal}
                      className="min-h-[3.25rem] w-full rounded-xl border-2 border-slate-200 bg-white text-base font-semibold text-slate-800 active:bg-slate-50"
                    >
                      {"\uCDE8\uC18C"}
                    </button>
                  </div>
                </>
              ) : modalStep === "projectInput" ? (
                <>
                  <p className="mb-3 mt-1 text-center text-sm text-slate-500">
                    {
                      "\uD504\uB85C\uC81D\uD2B8\uBA85\uC744 \uC785\uB825\uD558\uC138\uC694"
                    }
                  </p>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-slate-600">
                      {"\uD504\uB85C\uC81D\uD2B8\uBA85"}
                    </span>
                    <input
                      type="text"
                      value={customProjectName}
                      onChange={(e) => setCustomProjectName(e.target.value)}
                      className="min-h-[3.25rem] w-full rounded-xl border-2 border-slate-200 bg-white px-4 text-base text-slate-900 outline-none ring-teal-500/30 focus:border-teal-500 focus:ring-4"
                      placeholder={
                        "\uD504\uB85C\uC81D\uD2B8\uBA85\uC744 \uC785\uB825"
                      }
                      autoComplete="off"
                    />
                  </label>

                  <div className="mt-6 flex gap-2">
                    <button
                      type="button"
                      onClick={backToProjectListStep}
                      className="min-h-[3.25rem] flex-1 rounded-xl border-2 border-slate-200 bg-white text-base font-semibold text-slate-800 active:bg-slate-50"
                    >
                      {"\uC774\uC804"}
                    </button>
                    <button
                      type="button"
                      disabled={nextFromInputDisabled}
                      onClick={goToHoursStepFromInput}
                      className="min-h-[3.25rem] flex-1 rounded-xl bg-teal-600 text-base font-semibold text-white shadow-sm active:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
                    >
                      {"\uB2E4\uC74C"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={closeProjectModal}
                    className="mt-3 min-h-[2.75rem] w-full rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 active:bg-slate-50"
                  >
                    {"\uCDE8\uC18C"}
                  </button>
                </>
              ) : (
                <>
                  <p className="mb-1 mt-1 text-center text-sm font-semibold text-slate-700">
                    {modalProjectName}
                  </p>
                  <p className="mb-4 text-center text-sm text-slate-500">
                    {"\uACF5\uC218 \uC120\uD0DD"}
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    {HOUR_OPTIONS.map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setSelectedHour(h)}
                        className={`min-h-[3.25rem] rounded-xl border-2 text-lg font-bold transition active:scale-[0.99] ${
                          selectedHour === h
                            ? "border-teal-600 bg-teal-50 text-teal-950"
                            : "border-slate-200 bg-slate-50 text-slate-900"
                        }`}
                      >
                        {h}
                      </button>
                    ))}
                  </div>

                  <div className="mt-6 flex gap-2">
                    <button
                      type="button"
                      onClick={backToProjectListFromHours}
                      className="min-h-[3.25rem] flex-1 rounded-xl border-2 border-slate-200 bg-white text-base font-semibold text-slate-800 active:bg-slate-50"
                    >
                      {"\uC774\uC804"}
                    </button>
                    <button
                      type="button"
                      disabled={saveHoursDisabled}
                      onClick={() => void saveHoursEntry()}
                      className="min-h-[3.25rem] flex-1 rounded-xl bg-teal-600 text-base font-semibold text-white shadow-sm active:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
                    >
                      {saveInProgress ? "\uC800\uC7A5 \uC911\u2026" : "\uC800\uC7A5"}
                    </button>
                  </div>
                </>
              )}

              {modalSavedEntry ? (
                <button
                  type="button"
                  onClick={deleteDayEntry}
                  className="mt-3 w-full min-h-[3rem] rounded-xl border-2 border-rose-200 bg-rose-50/80 text-base font-semibold text-rose-800 active:bg-rose-100"
                >
                  {"\uC0AD\uC81C"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
