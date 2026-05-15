import { useState } from "react";
import CalendarScreen from "./components/CalendarScreen";
import PersonalInfoScreen from "./components/PersonalInfoScreen";
import { loadPersonalInfo } from "./storage";

export default function App() {
  const [screen, setScreen] = useState<"profile" | "calendar">(() =>
    loadPersonalInfo() ? "calendar" : "profile"
  );

  return (
    <div className="mx-auto flex h-full min-h-screen w-full max-w-mobile flex-1 flex-col bg-slate-100 shadow-sm">
      <div className="flex min-h-0 flex-1 flex-col">
        {screen === "profile" ? (
          <PersonalInfoScreen onSaved={() => setScreen("calendar")} />
        ) : (
          <CalendarScreen onEditProfile={() => setScreen("profile")} />
        )}
      </div>
    </div>
  );
}
