import { toBlob } from "html-to-image";
import { logSupabaseError } from "./projectsFromSupabase";
import { getSupabaseBrowserClient } from "./supabaseClient";

const TIMESHEET_BUCKET = "timesheet-submissions";
const CAPTURE_PIXEL_RATIO = 1.5;
const CAPTURE_QUALITY = 0.85;

export async function timesheetWorkerPathToken(userId: string): Promise<string> {
  const raw = userId.trim();
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(raw)
    );
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hex.slice(0, 12);
  } catch {
    return `w${Date.now().toString(36)}`;
  }
}

type TimesheetImageExtension = "webp" | "jpg" | "png";

function extensionFromBlobType(type: string): TimesheetImageExtension | null {
  if (type === "image/webp") return "webp";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  return null;
}

export function buildTimesheetImagePath(
  submitMonth: string,
  workerToken: string,
  extension: TimesheetImageExtension
): string {
  const month = /^\d{4}-\d{2}$/.test(submitMonth) ? submitMonth : "unknown";
  const token =
    workerToken.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24) || "worker";
  return `${month}/${token}_${Date.now()}.${extension}`;
}

/** CalendarScreen 공수표 DOM을 WebP로 만들고, 지원하지 않으면 JPEG로 만든다. */
export async function captureTimesheetImage(
  node: HTMLElement
): Promise<{ blob: Blob; extension: TimesheetImageExtension } | null> {
  const base = {
    pixelRatio: CAPTURE_PIXEL_RATIO,
    backgroundColor: "#f1f5f9",
    cacheBust: true,
  };
  try {
    const webp = await toBlob(node, {
      ...base,
      type: "image/webp",
      quality: CAPTURE_QUALITY,
    });
    if (webp != null && webp.size > 0 && webp.type === "image/webp") {
      return { blob: webp, extension: "webp" };
    }
  } catch (e) {
    console.error("[timesheet] webp capture failed", e);
  }
  try {
    const jpeg = await toBlob(node, {
      ...base,
      type: "image/jpeg",
      quality: CAPTURE_QUALITY,
    });
    if (jpeg != null && jpeg.size > 0) {
      const extension = extensionFromBlobType(jpeg.type);
      if (extension != null) {
        return { blob: jpeg, extension };
      }
    }
  } catch (e) {
    console.error("[timesheet] jpeg capture failed", e);
  }
  return null;
}

type ExistingTimesheetSubmission = {
  id: string | number;
  image_path: string;
};

async function removeTimesheetImage(imagePath: string): Promise<void> {
  const path = imagePath.trim();
  if (path === "") return;
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return;
  const { error } = await supabase.storage.from(TIMESHEET_BUCKET).remove([path]);
  if (error) {
    logSupabaseError("timesheet image remove failed", error);
  }
}

/**
 * 같은 작업자 이름·전화·submit_month의 마지막 제출 행을 찾는다.
 * 조회에 실패하면 null. 없으면 undefined.
 */
async function findLatestTimesheetSubmission(
  workerName: string,
  workerPhone: string,
  submitMonth: string
): Promise<ExistingTimesheetSubmission | null | undefined> {
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return null;
  const { data, error } = await supabase
    .from("timesheet_submissions")
    .select("id, image_path, created_at")
    .eq("worker_name", workerName)
    .eq("worker_phone", workerPhone)
    .eq("submit_month", submitMonth)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    logSupabaseError("timesheet_submissions lookup failed", error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (row == null || typeof row !== "object") return undefined;
  const id = (row as { id?: unknown }).id;
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  const imagePath = (row as { image_path?: unknown }).image_path;
  return {
    id,
    image_path: typeof imagePath === "string" ? imagePath : "",
  };
}

export async function submitTimesheetImage(input: {
  workerName: string;
  workerPhone: string;
  company: string;
  submitMonth: string;
  totalGongsu: number;
  workerToken: string;
  image: Blob;
  extension: TimesheetImageExtension;
}): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  if (supabase == null) return false;
  const existing = await findLatestTimesheetSubmission(
    input.workerName,
    input.workerPhone,
    input.submitMonth
  );
  if (existing === null) return false;

  const imagePath = buildTimesheetImagePath(
    input.submitMonth,
    input.workerToken,
    input.extension
  );
  const contentType = input.image.type;
  try {
    const { error: uploadError } = await supabase.storage
      .from(TIMESHEET_BUCKET)
      .upload(imagePath, input.image, {
        contentType,
        upsert: false,
      });
    if (uploadError) {
      logSupabaseError("timesheet image upload failed", uploadError);
      return false;
    }
  } catch (e) {
    logSupabaseError("timesheet image upload failed", e);
    return false;
  }

  const payload = {
    worker_name: input.workerName,
    worker_phone: input.workerPhone,
    company: input.company,
    submit_month: input.submitMonth,
    total_gongsu: input.totalGongsu,
    image_path: imagePath,
    created_at: new Date().toISOString(),
  };

  try {
    if (existing == null) {
      const { error } = await supabase.from("timesheet_submissions").insert(payload);
      if (error) {
        logSupabaseError("timesheet_submissions insert failed", error);
        await removeTimesheetImage(imagePath);
        return false;
      }
      return true;
    }

    const previousImagePath = existing.image_path;
    const { data: updatedRows, error } = await supabase
      .from("timesheet_submissions")
      .update(payload)
      .eq("id", existing.id)
      .eq("worker_name", input.workerName)
      .eq("worker_phone", input.workerPhone)
      .eq("submit_month", input.submitMonth)
      .select("id");
    const updatedCount = Array.isArray(updatedRows) ? updatedRows.length : 0;
    if (error || updatedCount !== 1) {
      logSupabaseError("timesheet_submissions update failed", error ?? {
        message: "update affected no rows",
        code: "zero_rows",
      });
      await removeTimesheetImage(imagePath);
      return false;
    }
    if (
      previousImagePath.trim() !== "" &&
      previousImagePath.trim() !== imagePath
    ) {
      await removeTimesheetImage(previousImagePath);
    }
    return true;
  } catch (e) {
    logSupabaseError("timesheet_submissions write failed", e);
    await removeTimesheetImage(imagePath);
    return false;
  }
}
