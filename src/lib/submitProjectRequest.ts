import { logSupabaseError } from "./projectsFromSupabase";
import { getSupabaseBrowserClient } from "./supabaseClient";

export type ProjectRequestInput = {
  workerName: string;
  workerPhone: string;
  company: string;
  projectName: string;
  requestMonth: string;
};

/** project_requests에 승인 대기 요청만 넣는다. 프로젝트 목록은 바꾸지 않는다. */
export async function submitProjectRequest(
  input: ProjectRequestInput
): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return false;
  try {
    const { error } = await supabase.from("project_requests").insert({
      worker_name: input.workerName,
      worker_phone: input.workerPhone,
      company: input.company,
      project_name: input.projectName,
      request_month: input.requestMonth,
      status: "pending",
    });
    if (error) {
      logSupabaseError("project_requests insert failed", error);
      return false;
    }
    return true;
  } catch (e) {
    logSupabaseError("project_requests insert failed", e);
    return false;
  }
}
