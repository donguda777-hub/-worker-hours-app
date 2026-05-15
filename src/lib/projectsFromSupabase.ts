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

export type ProjectOptionsSource = "supabase" | "local";

export function normalizeProjectName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
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

/**
 * 활성 프로젝트 조회 (admin-app과 동일 테이블·컬럼).
 * 실패 시 throw — 호출부에서 local fallback 처리.
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

/** Supabase 우선, 실패·미설정 시 localStorage 공수 기록에서 목록 구성 */
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
