import { ImageResponse } from "next/og";
import { BRAND_COLOR } from "@/lib/branding";

/**
 * Renders a store icon as a PNG.
 *
 * Everything that produces an icon goes through here — `app/icon.tsx` for the
 * browser tab and `app/api/branding/[asset]/route.ts` for the PWA icons and the
 * logo — so the uploaded and the generated icon can't end up looking like two
 * different products.
 *
 * **Why PNG and not SVG.** An SVG favicon is smaller and sharper and needs no
 * image library at all, which was the first attempt. Safari only learned to
 * read them in 16.4, and the PWA install instructions in Settings name iOS
 * explicitly, so a shop on an older iPad would get no icon. `next/og` is
 * already part of Next, so a PNG costs a dependency the project has anyway.
 */

/**
 * The fallback icon: the store's first character, white on a teal disc.
 *
 * This is what a shop sees before anyone uploads anything, which makes it the
 * icon most installs will actually carry — so it is a deliberate mark rather
 * than a placeholder. A circle inset from a transparent square, because the
 * manifest declares its icons `purpose: "any maskable"`: Android crops a
 * maskable icon to whatever shape the launcher uses, and art that runs to the
 * edge loses its edges. The disc sits inside the safe zone, so it survives a
 * circle, a squircle or a rounded square untouched.
 */
export function renderInitialIcon(initial: string, size: number): ImageResponse {
  // Proportional to the canvas, so 64px and 512px are the same picture at two
  // scales rather than two differently-weighted ones.
  const inset = size * 0.06;
  const diameter = size - inset * 2;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        }}
      >
        <div
          style={{
            width: diameter,
            height: diameter,
            borderRadius: "50%",
            background: BRAND_COLOR,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            // 0.58 of the disc: big enough to read at 16px in a browser tab,
            // small enough that a wide letter like W keeps its margins.
            fontSize: diameter * 0.58,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {initial}
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}

/**
 * An uploaded image, re-drawn onto a square canvas of the requested size.
 *
 * The upload is not resized on the way in — the original bytes are what is
 * stored — so this is where a 900×300 logo becomes something that can be used
 * as an icon. `objectFit: contain` letterboxes rather than crops, because
 * cropping a shop's logo to a square is a decision the shop did not make.
 *
 * Passing the stored data URL straight to `<img>` is deliberate: satori reads
 * data URLs directly, so no fetch and no temporary file is involved.
 */
export function renderUploadedIcon(dataUrl: string, size: number): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUrl} alt="" width={size} height={size} style={{ objectFit: "contain" }} />
      </div>
    ),
    { width: size, height: size },
  );
}
