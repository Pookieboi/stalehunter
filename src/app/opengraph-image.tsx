import { ImageResponse } from "next/og";

export const alt = "Stale Hunter: every AI learns from Wikipedia. Some of it stopped being true.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Social preview card for the demo link (Devpost, X, LinkedIn, WhatsApp).
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: "#0a0b0e",
          backgroundImage: "radial-gradient(circle at 10% 0%, rgba(220,38,38,0.4), rgba(10,11,14,0) 55%)",
          color: "#ecebe6",
          fontFamily: "serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 34, fontFamily: "sans-serif" }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "#dc2626", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34 }}>
            ⌕
          </div>
          Stale Hunter
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 70, lineHeight: 1.08 }}>
          <div>Every AI learns from Wikipedia.</div>
          <div style={{ color: "#f87171", fontStyle: "italic" }}>Some of it stopped being true.</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 26, color: "#a8a29e", fontFamily: "sans-serif" }}>
          <span>Finds outdated facts · drafts sourced fixes · two models must agree</span>
          <span style={{ color: "#a3e635" }}>NVIDIA Nemotron on Nebius</span>
        </div>
      </div>
    ),
    size,
  );
}
