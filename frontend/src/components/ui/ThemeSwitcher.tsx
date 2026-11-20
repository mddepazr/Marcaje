import { Monitor, Moon, Sun } from "lucide-react";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { ThemeMode, useThemeMode } from "../../context/ThemeContext";

export function ThemeSwitcher() {
  const { themeMode, setThemeMode } = useThemeMode();

  return (
    <SegmentedControl
      label="Tema de apariencia"
      size="sm"
      value={themeMode}
      onChange={(val) => setThemeMode(val as ThemeMode)}
    >
      <SegmentedControlItem
        value="light"
        label="Claro"
        icon={<Sun className="h-3.5 w-3.5" />}
      />
      <SegmentedControlItem
        value="dark"
        label="Oscuro"
        icon={<Moon className="h-3.5 w-3.5" />}
      />
      <SegmentedControlItem
        value="system"
        label="Sistema"
        icon={<Monitor className="h-3.5 w-3.5" />}
      />
    </SegmentedControl>
  );
}
