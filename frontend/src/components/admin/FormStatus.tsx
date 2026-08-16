import type { ReactNode } from "react";

type Props = {
  tone: "error" | "success" | "info";
  children: ReactNode;
};

export default function FormStatus({ tone, children }: Props) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`form-status form-status-${tone}`}>
      {children}
    </p>
  );
}
