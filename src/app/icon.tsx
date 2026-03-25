import { ImageResponse } from "next/og";

export const size = {
  width: 32,
  height: 32,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#161616",
          borderRadius: 8,
          padding: 7,
        }}
      >
        <div
          style={{
            display: "flex",
            width: 18,
            flexDirection: "column",
            gap: 3,
          }}
        >
          <div
            style={{
              display: "flex",
              background: "#f5f5f5",
              height: 5,
              borderRadius: 999,
            }}
          />
          <div
            style={{
              display: "flex",
              width: 14,
              background: "#f5f5f5",
              opacity: 0.8,
              height: 5,
              borderRadius: 999,
            }}
          />
          <div
            style={{
              display: "flex",
              width: 11,
              background: "#f5f5f5",
              opacity: 0.6,
              height: 5,
              borderRadius: 999,
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
