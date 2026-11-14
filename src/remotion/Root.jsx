import React from "react";
import { Composition } from "remotion";
import { Scene } from "./Scene.jsx";

export const FPS = 30;

// Props por defecto (solo para el preview en Studio). El render real los
// recibe de scripts/render-scene.mjs vía --props.
const defaultProps = {
  text: "Escena de prueba",
  brand: {
    backgroundColor: "#000000",
    textColor: "#ffffff",
    fontFamily: "Arial, sans-serif",
    fontWeight: 800,
    fontSize: 84,
  },
  durationInFrames: 90,
};

export const Root = () => (
  <Composition
    id="Escena"
    component={Scene}
    width={1080}
    height={1920}
    fps={FPS}
    durationInFrames={defaultProps.durationInFrames}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: props.durationInFrames,
    })}
  />
);
