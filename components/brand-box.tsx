import type { BuyerId } from "@/lib/domain";
import { useId } from "react";
export function BrandBox({ brand, shared = false, compact = false }: { brand: BuyerId; shared?: boolean; compact?: boolean }) {
  const black = brand === "luma";
  const base = black && !shared ? "#24262e" : "#cfad85";
  const top = black && !shared ? "#373a44" : "#e8cfaa";
  const side = black && !shared ? "#171a24" : "#af875b";
  const id = useId();
  return (
    <svg className={`brand-box ${compact ? "compact" : ""}`} viewBox="0 0 320 240" role="img" aria-label={`${brand === "luma" ? "LUMA" : brand === "juniper" ? "JUNIPER" : "FORMA"} branded ${shared && black ? "kraft box with a black sleeve" : black ? "black box" : "kraft box"}`}>
      <defs>
        <filter id={`${id}-shadow`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8" /></filter>
        <linearGradient id={`${id}-top`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={top} /><stop offset="1" stopColor={base} /></linearGradient>
      </defs>
      <ellipse cx="162" cy="204" rx="104" ry="14" fill="#1e2337" opacity=".13" filter={`url(#${id}-shadow)`} />
      <path d="M47 92 176 53 278 103 149 151Z" fill={`url(#${id}-top)`} stroke={base} strokeWidth="1.5" />
      <path d="M47 92 149 143 149 207 47 155Z" fill={base} />
      <path d="M149 143 278 103 278 166 149 207Z" fill={side} />
      <path d="M47 96 149 147 278 107" fill="none" stroke={black && !shared ? "#10131c" : "#9d7853"} opacity=".45" />
      {brand === "luma" && <>
        {shared && <>
        <path d="M77 83 179 134 244 114 142 63Z" fill="#252b3a" /><path d="M77 83 179 134 179 198 149 207 77 171Z" fill="#202638" /><path d="M179 134 244 114 244 177 179 198Z" fill="#151d2d" />
        </>}
        <g transform={shared ? "matrix(.85 .425 -.7 .21 147 94)" : "matrix(.85 .425 -.7 .21 160 94)"} fill="#f3eadc">
          <text x="0" y="0" textAnchor="middle" fontFamily="Georgia, serif" fontSize="26" letterSpacing="5">LUMA</text>
          <text x="0" y="15" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="6.5" letterSpacing="4">EVERYDAY OBJECTS</text>
        </g>
      </>}
      {brand === "juniper" && <g transform="matrix(.85 .425 -.8 .24 157 91)">
        <rect x="-48" y="-30" width="96" height="68" rx="2" fill="#3f5a46" />
        <path d="M0 -22 -9 -9 -4 -9 -13 3 13 3 4 -9 9 -9Z" fill="#ebe7d5" /><path d="M0 3v7" stroke="#ebe7d5" strokeWidth="2" />
        <text x="0" y="22" textAnchor="middle" fontFamily="Georgia, serif" fontSize="12" letterSpacing="1.3" fill="#f8f4e9">JUNIPER</text>
        <text x="0" y="31" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="4.5" letterSpacing="1.6" fill="#f8f4e9">MADE WITH CARE</text>
      </g>}
      {brand === "forma" && <g transform="matrix(.85 .425 -.8 .24 157 92)">
        <rect x="-45" y="-28" width="90" height="62" fill="#e8eeff" />
        <path d="M-16 -19H16V-10H-6V-3H12V6H-6V18H-16Z" fill="#365be4" />
        <text x="0" y="28" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="8" fontWeight="bold" letterSpacing="4" fill="#365be4">FORMA</text>
      </g>}
      <path d="M47 92 176 53 278 103" fill="none" stroke="#fff" opacity=".22" strokeWidth="1" />
    </svg>
  );
}
