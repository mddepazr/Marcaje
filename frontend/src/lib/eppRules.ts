export interface ZoneRequirements {
  require_helmet: boolean;
  require_glasses: boolean;
  require_mask: boolean;
  require_vest?: boolean;
}

export interface ScanDetections {
  person_detected: boolean;
  is_live_person: boolean;
  has_helmet: boolean;
  has_glasses: boolean;
  has_mask: boolean;
  has_vest?: boolean;
}

export function getMissingPPE(scan: ScanDetections, rules: ZoneRequirements): string[] {
  const missing: string[] = [];
  if (rules.require_helmet && !scan.has_helmet) missing.push("Casco");
  if (rules.require_glasses && !scan.has_glasses) missing.push("Lentes");
  if (rules.require_mask && !scan.has_mask) missing.push("Mascarilla");
  if (rules.require_vest && !scan.has_vest) missing.push("Chaleco");
  return missing;
}

export function evaluateCompliance(scan: ScanDetections, rules: ZoneRequirements): boolean {
  if (!scan.person_detected || !scan.is_live_person) return false;
  return getMissingPPE(scan, rules).length === 0;
}

export function resolveSystemRole(isAdmin: boolean): "admin" | "employee" {
  return isAdmin ? "admin" : "employee";
}
