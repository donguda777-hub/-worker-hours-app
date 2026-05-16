import { SKILL_LEVELS, type SkillLevel } from "./constants";
import { getSupabaseBrowserClient } from "./lib/supabaseClient";
import type { PersonalInfo } from "./types";
import { buildUserId } from "./utils/userId";

/** localStorage key for calendar day entries (array of { date, project, manDay }). */
export const WORKER_DAY_ENTRIES_STORAGE_KEY = "workerDayEntries";

export type WorkerDayEntry = {
  date: string;
  project: string;
  manDay: number;
};

/** Supabase/Postgrest 오류 객체를 콘솔에 일관되게 남긴다. */
function logWorkerDayEntriesSupabaseError(
  label: string,
  err: unknown
): void {
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    console.error(label, {
      message: typeof o.message === "string" ? o.message : undefined,
      code: typeof o.code === "string" ? o.code : undefined,
      details: typeof o.details === "string" ? o.details : undefined,
      hint: typeof o.hint === "string" ? o.hint : undefined,
      raw: err,
    });
    return;
  }
  console.error(label, err);
}

function coerceWorkerDayEntry(raw: unknown): WorkerDayEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const dateVal = o.date ?? o.dateIso ?? o.iso;
  if (typeof dateVal !== "string") return null;
  const date = dateVal.trim().split("T")[0];
  if (!date) return null;

  const projectVal = o.project ?? o.projectName ?? o.title;
  if (typeof projectVal !== "string" || !projectVal.trim()) return null;

  const manRaw = o.manDay ?? o.hours ?? o.man_days;
  const manDay = Number(manRaw);
  if (!Number.isFinite(manDay)) return null;

  return { date, project: projectVal.trim(), manDay };
}

export function loadWorkerDayEntries(): WorkerDayEntry[] {
  try {
    const raw = localStorage.getItem(WORKER_DAY_ENTRIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map(coerceWorkerDayEntry)
        .filter((e): e is WorkerDayEntry => e !== null)
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([k, v]) => {
          if (!v || typeof v !== "object") return null;
          const vo = v as Record<string, unknown>;
          const dateStr =
            typeof vo.date === "string" && vo.date.trim()
              ? vo.date.trim().split("T")[0]
              : k.trim().split("T")[0];
          return coerceWorkerDayEntry({ ...vo, date: dateStr });
        })
        .filter((e): e is WorkerDayEntry => e !== null)
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * 로컬에 반영된 1건을 Supabase에 반영한다.
 * `worker_id` + `work_date` + `project_name` 기준으로 기존 행이 있으면 update, 없으면 insert.
 * localStorage 저장과 분리 — 캘린더「저장」버튼에서만 호출할 것.
 */
export async function uploadWorkerDayEntryToSupabase(
  entry: WorkerDayEntry
): Promise<void> {
  try {
    const supabase = getSupabaseBrowserClient();
    if (supabase == null) {
      console.error(
        "[Supabase] worker_day_entries skip: client not configured"
      );
      return;
    }
    const profile = loadPersonalInfo();
    if (profile == null) {
      console.error(
        "[Supabase] worker_day_entries skip: no personal profile"
      );
      return;
    }
    /** 공수 저장 시점의 업체명 → worker_day_entries.company_name (개인정보 수정만으로 과거 행은 바뀌지 않음) */
    const companyName =
      profile.companyName != null && profile.companyName.trim() !== ""
        ? profile.companyName.trim()
        : "L&N";
    const workerId = profile.userId.trim();
    const workDate = entry.date.trim().split("T")[0];
    const projectName = entry.project.trim();
    if (!workerId || !workDate || !projectName) {
      console.error(
        "[Supabase] worker_day_entries skip: invalid entry shape",
        entry
      );
      return;
    }
    const payload = {
      worker_id: workerId,
      worker_name: profile.name.trim(),
      company_name: companyName,
      project_name: projectName,
      work_date: workDate,
      work_hours: entry.manDay,
      memo: null as string | null,
    };
    const { data: found, error: selErr } = await supabase
      .from("worker_day_entries")
      .select("id")
      .eq("worker_id", workerId)
      .eq("work_date", workDate)
      .eq("project_name", projectName)
      .limit(2);
    if (selErr != null) {
      logWorkerDayEntriesSupabaseError(
        "[Supabase] worker_day_entries lookup failed",
        selErr
      );
      return;
    }
    const rows = Array.isArray(found) ? found : [];
    if (rows.length > 1) {
      console.error(
        "[Supabase] worker_day_entries: duplicate rows for natural key; updating first id only",
        { workerId, workDate, projectName }
      );
    }
    const existingId = (rows[0] as { id?: unknown } | undefined)?.id;
    if (existingId != null && existingId !== "") {
      const { error: upErr } = await supabase
        .from("worker_day_entries")
        .update(payload)
        .eq("id", existingId);
      if (upErr != null) {
        logWorkerDayEntriesSupabaseError(
          "[Supabase] worker_day_entries update failed",
          upErr
        );
        return;
      }
      console.log("[Supabase] worker_day_entries update ok", {
        work_date: workDate,
        project_name: projectName,
      });
      return;
    }
    const { error: insErr } = await supabase
      .from("worker_day_entries")
      .insert(payload);
    if (insErr != null) {
      logWorkerDayEntriesSupabaseError(
        "[Supabase] worker_day_entries insert failed",
        insErr
      );
      return;
    }
    console.log("[Supabase] worker_day_entries insert ok", {
      work_date: workDate,
      project_name: projectName,
    });
  } catch (err) {
    console.error("[Supabase] worker_day_entries upload failed", err);
  }
}

/** localStorage에만 저장한다. Supabase 송신은 하지 않는다. */
export function saveWorkerDayEntries(entries: WorkerDayEntry[]): void {
  localStorage.setItem(
    WORKER_DAY_ENTRIES_STORAGE_KEY,
    JSON.stringify(entries)
  );
}

const KEY_PROFILE = "workerPersonalInfo";
export function upsertWorkerDayEntry(
  entries: WorkerDayEntry[],
  entry: WorkerDayEntry
): WorkerDayEntry[] {
  const next = entries.filter((e) => e.date !== entry.date);
  next.push(entry);
  next.sort((a, b) => a.date.localeCompare(b.date));
  return next;
}

export function deleteWorkerDayEntry(
  entries: WorkerDayEntry[],
  date: string
): WorkerDayEntry[] {
  return entries.filter((e) => e.date !== date);
}

function parsePersonalInfoFromStorage(raw: unknown): PersonalInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string" || typeof o.phone !== "string") return null;
  const name = o.name.trim();
  if (!name) return null;
  const phone = String(o.phone);
  const skillRaw = o.skillLevel;
  const skillLevel: SkillLevel =
    typeof skillRaw === "string" &&
    (SKILL_LEVELS as readonly string[]).includes(skillRaw)
      ? (skillRaw as SkillLevel)
      : SKILL_LEVELS[0];
  const companyName =
    typeof o.companyName === "string" && o.companyName.trim()
      ? o.companyName.trim()
      : undefined;
  const region =
    typeof o.region === "string" ? o.region.trim() : undefined;
  const userId =
    typeof o.userId === "string" && o.userId.trim()
      ? o.userId.trim()
      : buildUserId(name, phone);
  return {
    name,
    phone,
    companyName,
    ...(region !== undefined ? { region } : {}),
    skillLevel,
    userId,
  };
}

export function loadPersonalInfo(): PersonalInfo | null {
  try {
    const raw = localStorage.getItem(KEY_PROFILE);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsePersonalInfoFromStorage(parsed);
  } catch {
    return null;
  }
}

export function savePersonalInfo(info: PersonalInfo): void {
  const payload: PersonalInfo = {
    name: info.name,
    phone: info.phone,
    skillLevel: info.skillLevel,
    userId: info.userId,
    ...(info.companyName != null && info.companyName !== ""
      ? { companyName: info.companyName }
      : {}),
    ...(info.region != null && info.region !== ""
      ? { region: info.region }
      : {}),
  };
  localStorage.setItem(KEY_PROFILE, JSON.stringify(payload));
}

/**
 * 개인정보를 Supabase `workers` 테이블에 반영한다.
 * `worker_id`가 있으면 update, 없으면 insert.
 * `worker_day_entries` 업로드 로직과는 별개이며 그 코드는 수정하지 않는다.
 */
export async function upsertWorkerProfileToSupabase(
  info: PersonalInfo
): Promise<{ ok: true } | { ok: false; message: string }> {
  console.log("[workers save] upsertWorkerProfileToSupabase invoked");
  try {
    const supabase = getSupabaseBrowserClient();
    if (supabase == null) {
      console.error(
        "[workers save] error:",
        "getSupabaseBrowserClient returned null (check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)"
      );
      return {
        ok: false,
        message: "Supabase client not configured",
      };
    }

    console.log("[workers save] payload:", { ...info });
    const workerId = info.userId.trim();
    const workerName = info.name.trim();
    const phone = String(info.phone ?? "").trim();
    console.log("[workers save] worker_id:", workerId);

    if (!workerId || !workerName) {
      console.error("[workers save] error:", {
        reason: "missing worker_id or worker_name after trim",
        workerId,
        workerName,
      });
      return { ok: false, message: "Invalid profile" };
    }
    const companyName =
      info.companyName != null && info.companyName.trim() !== ""
        ? info.companyName.trim()
        : "L&N";
    const skillLevel = String(info.skillLevel);
    const region = (info.region ?? "").trim();
    const nowIso = new Date().toISOString();

    const row = {
      worker_id: workerId,
      worker_name: workerName,
      phone,
      company_name: companyName,
      region,
      skill_level: skillLevel,
      updated_at: nowIso,
    };
    console.log("[workers save] row to insert/update:", row);

    const { data: existing, error: selErr } = await supabase
      .from("workers")
      .select("id")
      .eq("worker_id", workerId)
      .maybeSingle();

    console.log("[workers save] select result:", {
      data: existing,
      error: selErr,
    });

    if (selErr != null) {
      console.error("[workers save] error:", selErr);
      return { ok: false, message: selErr.message ?? "Lookup failed" };
    }

    const hasRow =
      existing != null && (existing as { id?: unknown }).id != null;

    if (hasRow) {
      console.log("[workers save] update branch (existing row for worker_id)");
      const { data: upData, error: upErr } = await supabase
        .from("workers")
        .update({
          worker_name: workerName,
          phone,
          company_name: companyName,
          region,
          skill_level: skillLevel,
          updated_at: nowIso,
        })
        .eq("worker_id", workerId)
        .select("id")
        .maybeSingle();
      console.log("[workers save] update response:", { data: upData, error: upErr });
      if (upErr != null) {
        console.error("[workers save] error:", upErr);
        return { ok: false, message: upErr.message ?? "Update failed" };
      }
      console.log("[workers save] success:", {
        branch: "update",
        worker_id: workerId,
        data: upData,
      });
      return { ok: true };
    }

    console.log("[workers save] insert branch (no row for worker_id)");
    const { data: insData, error: insErr } = await supabase
      .from("workers")
      .insert(row)
      .select("id")
      .maybeSingle();
    console.log("[workers save] insert response:", { data: insData, error: insErr });
    if (insErr != null) {
      console.error("[workers save] error:", insErr);
      return { ok: false, message: insErr.message ?? "Insert failed" };
    }
    console.log("[workers save] success:", {
      branch: "insert",
      worker_id: workerId,
      data: insData,
    });
    return { ok: true };
  } catch (err) {
    console.error("[workers save] error:", err);
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
