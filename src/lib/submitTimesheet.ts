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

  try {
    const { error } = await supabase.from("timesheet_submissions").insert({
      worker_name: input.workerName,
      worker_phone: input.workerPhone,
      company: input.company,
      submit_month: input.submitMonth,
      total_gongsu: input.totalGongsu,
      image_path: imagePath,
    });
    if (error) {
      logSupabaseError("timesheet_submissions insert failed", error);
      return false;
    }
    return true;
  } catch (e) {
    logSupabaseError("timesheet_submissions insert failed", e);
    return false;
  }
}
