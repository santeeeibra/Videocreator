import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export const Scene = ({ text, brand }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();

  // Fade-in de 0.3 s y fade-out de 0.3 s (sin imágenes ni efectos externos).
  const fade = Math.round(fps * 0.3);
  const opacity = interpolate(
    frame,
    [0, fade, durationInFrames - fade, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.backgroundColor,
        justifyContent: "center",
        alignItems: "center",
        padding: 90,
      }}
    >
      <div
        style={{
          opacity,
          color: brand.textColor,
          fontFamily: brand.fontFamily,
          fontWeight: brand.fontWeight,
          fontSize: brand.fontSize,
          lineHeight: 1.25,
          textAlign: "center",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
