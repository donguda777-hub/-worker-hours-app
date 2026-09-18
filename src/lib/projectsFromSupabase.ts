import { loadWorkerDayEntries } from "../storage";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "./supabaseClient";

export type ActiveProjectOption = {
  id: string;
  project_name: string;
};

export type EnsureWorkerProjectResult = {
  project_name: string;
  created: boolean;
};

export type ProjectOptionsSource = "supabase" | "local" | "none";

export function normalizeProjectName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** ISO 날짜(YYYY-MM-DD) → month 키(YYYY-MM) */
export function monthKeyFromIsoDate(iso: string): string | null {
  const key = iso.trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(key)) return null;
  return key;
}

/** Supabase PostgREST / client error 상세 로그 */
export function logSupabaseError(context: string, error: unknown): void {
  if (error == null) {
    console.error(`[Supabase] ${context}`, error);
    return;
  }
  if (error instanceof Error && !("code" in error)) {
    console.error(`[Supabase] ${context}`, {
      message: error.message,
      name: error.name,
      stack: error.stack,
    });
    return;
  }
  const e = error as {
    message?: string;
    code?: string;
    details?: string;
    hint?: string;
  };
  console.error(`[Supabase] ${context}`, {
    message: e.message,
    code: e.code,
    details: e.details,
    hint: e.hint,
  });
}

function parseProjectRow(row: unknown): ActiveProjectOption | null {
  if (row == null || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = r.id;
  const projectName = r.project_name;
  const isActive = r.is_active;
  if (typeof id !== "string" || id.trim() === "") return null;
  if (
    typeof projectName !== "string" ||
    normalizeProjectName(projectName) === ""
  ) {
    return null;
  }
  if (typeof isActive !== "boolean") return null;
  if (!isActive) return null;
  return {
    id: id.trim(),
    project_name: normalizeProjectName(projectName),
  };
}

/** 공수 localStorage 항목에서 프로젝트명 목록 (Supabase 실패 시 fallback) */
export function projectsFromLocalWorkerEntries(): ActiveProjectOption[] {
  const entries = loadWorkerDayEntries();
  const byName = new Map<string, ActiveProjectOption>();
  for (const e of entries) {
    const project_name = normalizeProjectName(e.project);
    if (!project_name) continue;
    if (!byName.has(project_name)) {
      byName.set(project_name, {
        id: `local:${project_name}`,
        project_name,
      });
    }
  }
  return [...byName.values()].sort((a, b) =>
    a.project_name.localeCompare(b.project_name, "ko")
  );
}

function parseMonthlyProjectRow(row: unknown): ActiveProjectOption | null {
  if (row == null || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const projectName = r.project_name;
  if (
    typeof projectName !== "string" ||
    normalizeProjectName(projectName) === ""
  ) {
    return null;
  }
  const project_name = normalizeProjectName(projectName);
  const idRaw = r.id;
  const id =
    typeof idRaw === "string" && idRaw.trim() !== ""
      ? idRaw.trim()
      : `monthly:${project_name}`;
  return { id, project_name };
}

/**
 * 월별 작업자 선택용 프로젝트 조회 (monthly_projects).
 * 실패 시 throw — 호출부에서 빈 목록 처리 (projects 전체 fallback 금지).
 */
export async function fetchMonthlyProjectsFromSupabase(
  month: string
): Promise<ActiveProjectOption[]> {
  const monthKey = month.trim();
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error(`Invalid month key: ${month}`);
  }
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    throw new Error("Supabase client not configured");
  }
  const { data, error } = await supabase
    .from("monthly_projects")
    .select("id, project_name, month")
    .eq("month", monthKey)
    .order("project_name", { ascending: true });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const byName = new Map<string, ActiveProjectOption>();
  for (const row of rows) {
    const parsed = parseMonthlyProjectRow(row);
    if (parsed == null) continue;
    if (!byName.has(parsed.project_name)) {
      byName.set(parsed.project_name, parsed);
    }
  }
  const out = [...byName.values()].sort((a, b) =>
    a.project_name.localeCompare(b.project_name, "ko")
  );
  console.log("[Supabase] monthly_projects fetch ok (worker)", {
    month: monthKey,
    count: out.length,
  });
  return out;
}

/**
 * 해당 월 monthly_projects만 반환.
 * 실패·미설정 시 빈 목록 (projects 전체 / local 전체 목록으로 fallback하지 않음).
 */
export async function fetchMonthlyProjectOptionsForWorker(
  month: string
): Promise<{
  projects: ActiveProjectOption[];
  source: ProjectOptionsSource;
}> {
  const monthKey = month.trim();
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    console.error("[Supabase] monthly_projects fetch skipped: invalid month", {
      month,
    });
    return { projects: [], source: "none" };
  }
  if (!isSupabaseConfigured()) {
    console.error(
      "[Supabase] monthly_projects fetch skipped: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local"
    );
    return { projects: [], source: "none" };
  }
  try {
    const projects = await fetchMonthlyProjectsFromSupabase(monthKey);
    return { projects, source: "supabase" };
  } catch (e) {
    logSupabaseError("monthly_projects fetch failed (worker)", e);
    return { projects: [], source: "none" };
  }
}

/**
 * 활성 프로젝트 조회 (admin-app과 동일 테이블·컬럼).
 * 직접입력 ensure 경로 등에서 필요 시 사용. 선택 목록 표시용으로 쓰지 않음.
 */
export async function fetchActiveProjectsFromSupabase(): Promise<
  ActiveProjectOption[]
> {
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    throw new Error("Supabase client not configured");
  }
  const { data, error } = await supabase
    .from("projects")
    .select("id, project_name, is_active")
    .eq("is_active", true)
    .order("project_name", { ascending: true });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const out: ActiveProjectOption[] = [];
  for (const row of rows) {
    const parsed = parseProjectRow(row);
    if (parsed != null) out.push(parsed);
  }
  console.log("[Supabase] projects fetch ok (worker)", { count: out.length });
  return out;
}

/** @deprecated 선택 목록은 fetchMonthlyProjectOptionsForWorker 사용 */
export async function fetchProjectOptionsForWorker(): Promise<{
  projects: ActiveProjectOption[];
  source: ProjectOptionsSource;
}> {
  if (!isSupabaseConfigured()) {
    console.error(
      "[Supabase] projects fetch skipped: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local"
    );
    return {
      projects: projectsFromLocalWorkerEntries(),
      source: "local",
    };
  }
  try {
    const projects = await fetchActiveProjectsFromSupabase();
    return { projects, source: "supabase" };
  } catch (e) {
    logSupabaseError("projects fetch failed (worker)", e);
    return {
      projects: projectsFromLocalWorkerEntries(),
      source: "local",
    };
  }
}

/** 작업자 직접입력: admin-app insert와 동일 컬럼 (source=worker, created_by) */
export async function insertWorkerProjectToSupabase(
  rawName: string,
  workerId: string
): Promise<ActiveProjectOption | null> {
  const project_name = normalizeProjectName(rawName);
  const created_by = workerId.trim();
  if (!project_name || !created_by) return null;

  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    logSupabaseError("projects insert skip (worker)", {
      message: "client not configured",
      code: "not_configured",
    });
    return null;
  }

  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("projects")
      .insert({
        project_name,
        is_active: true,
        source: "worker",
        created_by,
        updated_at: now,
      })
      .select("id, project_name, is_active")
      .single();
    if (error) throw error;
    const parsed = parseProjectRow(data);
    if (parsed == null) {
      console.error("[Supabase] projects insert: invalid response (worker)", data);
      return null;
    }
    console.log("[Supabase] projects insert ok (worker)", parsed);
    return parsed;
  } catch (e) {
    logSupabaseError("projects insert failed (worker)", e);
    return null;
  }
}

async function findActiveProjectByName(
  project_name: string
): Promise<ActiveProjectOption | null> {
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return null;
  const { data, error } = await supabase
    .from("projects")
    .select("id, project_name, is_active")
    .eq("project_name", project_name)
    .eq("is_active", true)
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return parseProjectRow(row);
}

/**
 * 공수 저장 전: 동일 project_name이 없으면 insert(source=worker), 있으면 기존 사용.
 */
export async function ensureWorkerProjectInSupabase(
  rawName: string,
  workerId: string
): Promise<EnsureWorkerProjectResult | null> {
  const project_name = normalizeProjectName(rawName);
  const wid = workerId.trim();
  if (!project_name || !wid) return null;

  if (!isSupabaseConfigured()) {
    logSupabaseError("projects ensure skip (worker)", {
      message: "client not configured",
      code: "not_configured",
    });
    return null;
  }

  try {
    const existing = await findActiveProjectByName(project_name);
    if (existing != null) {
      console.log("[Supabase] projects ensure: use existing", {
        project_name: existing.project_name,
      });
      return { project_name: existing.project_name, created: false };
    }

    const inserted = await insertWorkerProjectToSupabase(rawName, wid);
    if (inserted != null) {
      return { project_name: inserted.project_name, created: true };
    }

    const again = await findActiveProjectByName(project_name);
    if (again != null) {
      return { project_name: again.project_name, created: false };
    }

    return null;
  } catch (e) {
    logSupabaseError("projects ensure failed (worker)", e);
    return null;
  }
}
