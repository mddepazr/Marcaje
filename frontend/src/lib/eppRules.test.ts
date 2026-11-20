import { describe, expect, it } from "vitest";
import { evaluateCompliance, getMissingPPE, resolveSystemRole } from "./eppRules";

describe("Reglas de cumplimiento EPP y permisos - Marcaje", () => {
  const fullZoneRules = {
    require_helmet: true,
    require_glasses: true,
    require_mask: true,
    require_vest: true,
  };

  it("aprueba el marcaje cuando hay persona real y cumple todo el EPP obligatorio", () => {
    const scan = {
      person_detected: true,
      is_live_person: true,
      has_helmet: true,
      has_glasses: true,
      has_mask: true,
      has_vest: true,
    };

    expect(getMissingPPE(scan, fullZoneRules)).toEqual([]);
    expect(evaluateCompliance(scan, fullZoneRules)).toBe(true);
  });

  it("rechaza el marcaje e identifica el equipo faltante", () => {
    const scan = {
      person_detected: true,
      is_live_person: true,
      has_helmet: true,
      has_glasses: true,
      has_mask: false,
      has_vest: true,
    };

    expect(getMissingPPE(scan, fullZoneRules)).toEqual(["Mascarilla"]);
    expect(evaluateCompliance(scan, fullZoneRules)).toBe(false);
  });

  it("rechaza el marcaje si falla la prueba de vida aunque tenga el EPP", () => {
    const spoofScan = {
      person_detected: true,
      is_live_person: false,
      has_helmet: true,
      has_glasses: true,
      has_mask: true,
      has_vest: true,
    };

    expect(evaluateCompliance(spoofScan, fullZoneRules)).toBe(false);
  });

  it("asigna correctamente el nivel de permisos según el puesto", () => {
    expect(resolveSystemRole(true)).toBe("admin");
    expect(resolveSystemRole(false)).toBe("employee");
  });
});
