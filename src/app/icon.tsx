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
          background: "#101010",
          borderRadius: 10,
          padding: 5,
        }}
      >
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            gap: 3,
          }}
        >
          <div
            style={{
              display: "flex",
              flex: 1,
              background: "#f5f5f5",
              borderRadius: 4,
            }}
          />
          <div
            style={{
              display: "flex",
              flex: 1,
              background: "#d4d4d4",
              borderRadius: 4,
            }}
          />
          <div
            style={{
              display: "flex",
              flex: 1,
              background: "#737373",
              borderRadius: 4,
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
