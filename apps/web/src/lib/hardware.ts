export function isLowEndDevice(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return navigator.hardwareConcurrency <= 4 || (navigator as any).deviceMemory <= 4;
}
