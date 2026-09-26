/**
 * IPv4 / IPv6 CIDR matching (pure — used for crawler IP verification and in tests).
 * Addresses are converted to BigInt; IPv4-mapped IPv6 addresses (::ffff:1.2.3.4) match IPv4 ranges.
 */

export type ParsedIp = { v: 4 | 6; value: bigint };
export type CompiledCidr = { v: 4 | 6; base: bigint; mask: bigint };

function parseV4(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = BigInt(0);
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << BigInt(8)) | BigInt(v);
  }
  return n;
}

function parseV6(input: string): bigint | null {
  let ip = input.split("%")[0]!.toLowerCase();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  // Embedded IPv4 in the last 32 bits.
  const v4Match = ip.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Match) {
    const v4 = parseV4(v4Match[1]!);
    if (v4 == null) return null;
    ip = `${ip.slice(0, -v4Match[1]!.length)}${((v4 >> BigInt(16)) & BigInt(0xffff)).toString(16)}:${(v4 & BigInt(0xffff)).toString(16)}`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  let n = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  return n;
}

const V4_MAPPED_PREFIX = BigInt(0xffff) << BigInt(32);

/** Parses an IP address; IPv4-mapped IPv6 addresses are returned as IPv4. */
export function parseIp(input: string | null | undefined): ParsedIp | null {
  if (!input) return null;
  const ip = input.trim();
  if (!ip) return null;
  if (ip.includes(":")) {
    const v = parseV6(ip);
    if (v == null) return null;
    if (v >> BigInt(32) === BigInt(0xffff) && (v & ~BigInt(0xffffffff)) === V4_MAPPED_PREFIX) return { v: 4, value: v & BigInt(0xffffffff) };
    return { v: 6, value: v };
  }
  const v = parseV4(ip);
  return v == null ? null : { v: 4, value: v };
}

export function compileCidr(cidr: string): CompiledCidr | null {
  const [addr, bitsRaw] = cidr.trim().split("/");
  const parsed = parseIp(addr);
  if (!parsed) return null;
  // Keep the family of the written range (an IPv4-mapped v6 range is rare; treat as v4).
  const width = parsed.v === 4 ? 32 : 128;
  const bits = bitsRaw === undefined ? width : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > width) return null;
  const all = (BigInt(1) << BigInt(width)) - BigInt(1);
  const mask = bits === 0 ? BigInt(0) : (all << BigInt(width - bits)) & all;
  return { v: parsed.v, base: parsed.value & mask, mask };
}

export function compileCidrs(cidrs: string[]): CompiledCidr[] {
  const out: CompiledCidr[] = [];
  for (const c of cidrs) {
    const compiled = compileCidr(c);
    if (compiled) out.push(compiled);
  }
  return out;
}

export function ipInCompiled(ip: string | ParsedIp | null | undefined, ranges: CompiledCidr[]): boolean {
  const parsed = typeof ip === "string" || ip == null ? parseIp(ip) : ip;
  if (!parsed) return false;
  for (const r of ranges) {
    if (r.v === parsed.v && (parsed.value & r.mask) === r.base) return true;
  }
  return false;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const c = compileCidr(cidr);
  return c ? ipInCompiled(ip, [c]) : false;
}

export function ipInCidrs(ip: string, cidrs: string[]): boolean {
  return ipInCompiled(ip, compileCidrs(cidrs));
}

export function isValidIp(ip: string | null | undefined): boolean {
  return parseIp(ip) != null;
}
