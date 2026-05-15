import { UI } from "./uiStrings";

export const SKILL_LEVELS = [
  UI.skillNovice,
  UI.skillWorker,
  UI.skillSemi,
  UI.skillLead,
] as const;

export type SkillLevel = (typeof SKILL_LEVELS)[number];
