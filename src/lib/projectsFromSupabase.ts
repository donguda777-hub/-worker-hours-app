import { getSupabaseBrowserClient } from "./supabaseClient";

export type ActiveProjectOption = {
  id: string;
  project_name: string;
};

export type EnsureWorkerProjectResult = {
  project_name: string;
  created: boolean;
};

export function normalizeProjectName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function parseRow(row: unknown): ActiveProjectOption | null {
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
  if (isActive !== true) return null;
  return {
    id: id.trim(),
    project_name: normalizeProjectName(projectName),
  };
}

/** is_active = true 인 프로젝트만 조회 (작업자앱 선택 목록) */
export async function fetchActiveProjectsForWorker(): Promise<
  ActiveProjectOption[]
> {
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    console.error("[Supabase] projects skip fetch: client not configured");
    return [];
  }
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, project_name, is_active")
      .eq("is_active", true)
      .order("project_name", { ascending: true });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const out: ActiveProjectOption[] = [];
    for (const row of rows) {
      const parsed = parseRow(row);
      if (parsed != null) out.push(parsed);
    }
    console.log("[Supabase] projects fetch ok (worker)", { count: out.length });
    return out;
  } catch (e) {
    console.error("[Supabase] projects fetch failed (worker)", e);
    return [];
  }
}

/**
 * 공수 저장 전: 동일 project_name이 없으면 insert(source=worker), 있으면 기존 사용.
 * 삭제/비활성화는 하지 않는다.
 */
export async function ensureWorkerProjectInSupabase(
  rawName: string,
  workerId: string
): Promise<EnsureWorkerProjectResult | null> {
  const project_name = normalizeProjectName(rawName);
  const wid = workerId.trim();
  if (!project_name || !wid) return null;

  const supabase = getSupabaseBrowserClient();
  if (supabase == null) {
    console.error("[Supabase] projects ensure skip: client not configured");
    return null;
  }

  try {
    const { data: existing, error: findErr } = await supabase
      .from("projects")
      .select("id, project_name")
      .eq("project_name", project_name)
      .maybeSingle();
    if (findErr) throw findErr;

    if (existing != null && typeof existing === "object") {
      const pn = (existing as { project_name?: unknown }).project_name;
      const name =
        typeof pn === "string" ? normalizeProjectName(pn) : project_name;
      console.log("[Supabase] projects ensure: use existing", { project_name: name });
      return { project_name: name, created: false };
    }

    const now = new Date().toISOString();
    const { data: inserted, error: insErr } = await supabase
      .from("projects")
      .insert({
        project_name,
        is_active: true,
        source: "worker",
        created_by: wid,
        updated_at: now,
      })
      .select("id, project_name")
      .single();

    if (insErr != null) {
      const code = (insErr as { code?: string }).code;
      if (code === "23505") {
        const { data: again } = await supabase
          .from("projects")
          .select("id, project_name")
          .eq("project_name", project_name)
          .maybeSingle();
        if (again != null) {
          return { project_name, created: false };
        }
      }
      throw insErr;
    }

    const pn = (inserted as { project_name?: unknown } | null)?.project_name;
    const name =
      typeof pn === "string" ? normalizeProjectName(pn) : project_name;
    console.log("[Supabase] projects ensure: inserted", {
      project_name: name,
      created_by: wid,
    });
    return { project_name: name, created: true };
  } catch (e) {
    console.error("[Supabase] projects ensure failed", e);
    return null;
  }
}
