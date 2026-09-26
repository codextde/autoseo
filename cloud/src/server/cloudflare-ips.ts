import net from "node:net";

/** Cloudflare edge ranges (https://www.cloudflare.com/ips/, fetched 2026-09-26). */
const RANGES_V4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];
const RANGES_V6 = ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"];

const blockList = new net.BlockList();
for (const cidr of RANGES_V4) {
  const [ip, bits] = cidr.split("/");
  blockList.addSubnet(ip!, Number(bits), "ipv4");
}
for (const cidr of RANGES_V6) {
  const [ip, bits] = cidr.split("/");
  blockList.addSubnet(ip!, Number(bits), "ipv6");
}

/** True when the address belongs to Cloudflare's edge (IPv4-mapped IPv6 addresses included). */
export function isCloudflareIp(raw: string | null | undefined): boolean {
  const ip = raw?.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  if (!ip) return false;
  const family = net.isIP(ip);
  if (family === 4) return blockList.check(ip, "ipv4");
  if (family === 6) return blockList.check(ip, "ipv6");
  return false;
}
