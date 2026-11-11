import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Monta PC 3D",
  description: "Planejamento de montagem de PC com revisão de compatibilidade, preço com fonte, 3D e FPS estimado.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
