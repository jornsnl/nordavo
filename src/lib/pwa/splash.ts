import devices from "./splash-devices.json";

/**
 * iOS launch screens for the home screen app. iOS picks the image whose
 * media query matches the device exactly; without one it shows a white
 * screen while the app starts. Images: public/splash, made by
 * scripts/generate-splash.py from the same device list.
 */
export const appleStartupImages = devices.map((d) => ({
  url: `/splash/splash-${d.width * d.ratio}x${d.height * d.ratio}.png`,
  media: `(device-width: ${d.width}px) and (device-height: ${d.height}px) and (-webkit-device-pixel-ratio: ${d.ratio}) and (orientation: portrait)`,
}));
