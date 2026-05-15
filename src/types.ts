import type { SkillLevel } from "./constants";

export type { SkillLevel };

export interface PersonalInfo {
  name: string;
  phone: string;
  /** 업체명 (미저장 과거 데이터는 화면에서 L&N으로 간주) */
  companyName?: string;
  /** 지역 */
  region?: string;
  skillLevel: SkillLevel;
  /** Auto-generated: name + last 4 digits of phone */
  userId: string;
}
